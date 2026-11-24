# Small SF — offline mirror

A complete offline copy of the Small SF source snapshot and all three DZI tile pyramids. This repository is a fallback, not a GitHub Pages site: the published site limit is 1 GB and the tile data alone is 2.9 GB.

## What is here

- `smallsf/` — the full site snapshot: code, JSON/bin data, `depthfine/`, `serve.py`, and the three local tile pyramids.
- `smallsf/map_files/` — illustrated city, DZI levels 0–17, 12,620 tiles plus `preview.webp`.
- `smallsf/photo_files/` — aerial base, 1,035 tiles.
- `smallsf/far_files/` — Bay Area distant view, 174 tiles.

Total: 14,538 files / 3.19 GB (tiles 2.90 GB).

## Run it offline

```powershell
cd smallsf
python serve.py 8787
# http://127.0.0.1:8787/
```

`serve.py` serves local tiles first and only proxies to `tiles.smallsf.com` when a local tile is missing. The realtime `/api/*` layers still need the original server; the map, zoom, terrain, buildings, landmarks, simulated traffic and lighting work without it.

## Fallback URLs for the live games page

If `tiles.smallsf.com` fails, point the `tiles` fields in `map.json`, `photo.json` and `far.json` at these raw bases:

- `https://raw.githubusercontent.com/bear20252026/smallsf-offline/main/smallsf/map_files/`
- `https://raw.githubusercontent.com/bear20252026/smallsf-offline/main/smallsf/photo_files/`
- `https://raw.githubusercontent.com/bear20252026/smallsf-offline/main/smallsf/far_files/`

The live `bear20252026/games` page still uses the external service for now; this repository only registers the fallback.

## Upload shape

The tile levels are committed in batches so no push exceeds GitHub's 2 GB push limit. The 9,394 files in `map_files/17` are split across commits; the final tree keeps the standard DZI `level/x_y.webp` layout.
