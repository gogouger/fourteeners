# Colorado 14ers

A personal progress tracker for Colorado's 58 named fourteeners.

The standalone app pairs a real Leaflet terrain map and expandable peak records with a browser-rendered USGS 3DEP terrain view. The VPS serves prebuilt static terrain and imagery tiles; all 3D rendering happens in the visitor's browser.

## Local preview

```sh
python3 -m http.server 8001
```

Open <http://localhost:8001/?widget=ribbon-lab>.

## Data

- `peaks.json` holds the peak catalog and locations.
- `summits.json` is the personal summit log.
- `assets/terrain/` contains versioned USGS 3DEP Terrain-RGB tiles and matching USGS imagery for the official 14er footprint.
- `scripts/build_terrain_tiles.py` rebuilds the static package; it retains full-footprint overview tiles and high-detail neighborhoods around all 58 summits.

The app is static HTML, CSS, and JavaScript—there is no build step.
