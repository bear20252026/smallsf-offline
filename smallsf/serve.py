#!/usr/bin/env python3
"""Local preview server for the Small SF source snapshot.

Why this exists: smallsf.com serves its map tiles from tiles.smallsf.com, which
only sends `Access-Control-Allow-Origin: https://smallsf.com`. A plain static
server on localhost therefore cannot load a single tile — the browser blocks
every image — and the map stays black.

This server:
  * serves the snapshot directory as static files,
  * forwards /t/... to https://tiles.smallsf.com/t/... (same-origin from the
    page's point of view, so no CORS check applies),
  * rewrites the `tiles` field of map.json / photo.json / far.json on the fly to
    that local prefix, leaving the files on disk untouched.

Run:  python serve.py 8787     then open http://127.0.0.1:8787/
"""
import http.server
import json
import mimetypes
import os
import socketserver
import sys
import urllib.request
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
TILE_HOST = "https://tiles.smallsf.com"
REWRITE = ("map.json", "photo.json", "far.json")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/t/"):
            if self.local_tile(path):
                return
            return self.proxy(path)
        name = path.lstrip("/")
        if name in REWRITE:
            return self.tile_json(name)
        return super().do_GET()

    def local_tile(self, path):
        """Serve a mirrored tile from disk; False means fall through to the proxy."""
        parts = path.strip("/").split("/")
        if len(parts) < 4 or parts[0] != "t":
            return False
        if parts[2] not in ("map_files", "photo_files", "far_files"):
            return False
        if len(parts) == 4:                      # /t/<ver>/map_files/preview.webp
            file = os.path.join(ROOT, parts[2], parts[3])
        elif len(parts) == 5:                    # /t/<ver>/map_files/17/40_30.webp
            file = os.path.join(ROOT, parts[2], parts[3], parts[4])
        else:
            return False
        if not os.path.isfile(file):
            return False
        ctype = mimetypes.guess_type(file)[0] or "application/octet-stream"
        try:
            with open(file, "rb") as fh:
                body = fh.read()
        except OSError:
            return False
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.send_header("X-Tile-Src", "local")
        self.end_headers()
        self.wfile.write(body)
        return True

    def tile_json(self, name):
        file = os.path.join(ROOT, name)
        try:
            with open(file, "rb") as fh:
                data = json.load(fh)
            tiles = data.get("tiles", "")
            if tiles.startswith(TILE_HOST + "/t/"):
                data["tiles"] = tiles[len(TILE_HOST):]
            body = json.dumps(data).encode("utf-8")
        except Exception as exc:  # pragma: no cover
            return self.send_error(500, str(exc))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def proxy(self, path):
        url = TILE_HOST + path
        req = urllib.request.Request(
            url, headers={"User-Agent": "smallsf-local-preview", "Referer": "https://smallsf.com/"}
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                body = res.read()
                ctype = res.headers.get("Content-Type", "application/octet-stream")
                self.send_response(res.status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "public, max-age=86400")
                self.send_header("X-Tile-Src", "remote")
                self.end_headers()
                self.wfile.write(body)
        except Exception as exc:
            self.send_error(502, str(exc))

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.daemon_threads = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", port), Handler) as httpd:
        print(f"Small SF local preview: http://127.0.0.1:{port}/  (tiles proxied, Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
