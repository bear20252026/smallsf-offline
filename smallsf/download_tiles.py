#!/usr/bin/env python3
"""Mirror the three DZI tile pyramids of smallsf.com into this folder.

Creates  map_files/  photo_files/  far_files/  with the standard Deep Zoom
layout  <level>/<x>_<y>.webp  so serve.py can hand them out without touching
the network. Safe to re-run: existing tiles are skipped.

    python download_tiles.py [threads]
"""
import http.client
import math
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

HOST = "tiles.smallsf.com"
ROOT = os.path.dirname(os.path.abspath(__file__))
TILE = 1024
PYRAMIDS = [
    ("mwsvzjkk", "map_files", 124560, 78480),
    ("mwcwcj3d", "photo_files", 32768, 24576),
    ("mwcw736q", "far_files", 12288, 10240),
]

_local = threading.local()


def connection():
    c = getattr(_local, "c", None)
    if c is None:
        c = http.client.HTTPSConnection(HOST, timeout=40)
        _local.c = c
    return c


def drop_connection():
    c = getattr(_local, "c", None)
    if c is not None:
        try:
            c.close()
        except Exception:
            pass
    _local.c = None


def fetch(path):
    """Return bytes, None for 404, or b'' when every retry failed."""
    for attempt in range(4):
        try:
            c = connection()
            c.request("GET", path, headers={"User-Agent": "smallsf-mirror"})
            r = c.getresponse()
            body = r.read()
            if r.status == 200:
                return body
            if r.status == 404:
                return None
            time.sleep(1.0 + attempt)
        except Exception:
            drop_connection()
            time.sleep(0.8 + attempt)
    return b""


def plan():
    jobs = []
    for ver, name, w, h in PYRAMIDS:
        maxl = math.ceil(math.log2(max(w, h)))
        for lvl in range(maxl + 1):
            lw = math.ceil(w / 2 ** (maxl - lvl))
            lh = math.ceil(h / 2 ** (maxl - lvl))
            for x in range(math.ceil(lw / TILE)):
                for y in range(math.ceil(lh / TILE)):
                    jobs.append((ver, name, lvl, x, y))
    return jobs


def main():
    threads = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    jobs = plan()
    total = len(jobs)
    print(f"{total} tiles to consider; {threads} threads", flush=True)

    done = [0]
    got = [0]
    skipped = [0]
    failed = [0]
    size = [0]
    lock = threading.Lock()
    started = time.time()

    def work(job):
        ver, name, lvl, x, y = job
        out = os.path.join(ROOT, name, str(lvl), f"{x}_{y}.webp")
        with lock:
            done[0] += 1
            n = done[0]
        if os.path.exists(out) and os.path.getsize(out) > 0:
            with lock:
                got[0] += 1
            return
        path = f"/t/{ver}/{name}/{lvl}/{x}_{y}.webp"
        body = fetch(path)
        if body is None:
            with lock:
                skipped[0] += 1
            return
        if body == b"":
            with lock:
                failed[0] += 1
            return
        os.makedirs(os.path.dirname(out), exist_ok=True)
        tmp = out + ".part"
        with open(tmp, "wb") as fh:
            fh.write(body)
        os.replace(tmp, out)
        with lock:
            got[0] += 1
            size[0] += len(body)
        if n % 400 == 0:
            el = time.time() - started
            print(
                f"  {n}/{total}  {size[0]/1e6:.0f} MB  {n/el:.1f} tiles/s", flush=True
            )

    with ThreadPoolExecutor(max_workers=threads) as pool:
        list(pool.map(work, jobs))

    el = time.time() - started
    print(
        f"finished: {got[0]} ok ({size[0]/1e6:.0f} MB), {skipped[0]} missing, "
        f"{failed[0]} failed, {el:.0f}s",
        flush=True,
    )


if __name__ == "__main__":
    main()
