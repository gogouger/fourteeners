# Colorado 14ers

A personal progress tracker for Colorado's 58 named fourteeners.

The standalone app pairs a real Leaflet terrain map and expandable peak records with a browser-rendered USGS 3DEP terrain view. The VPS serves one prebuilt, geographically registered terrain scene; all 3D rendering happens in the visitor's browser.

## Local preview

```sh
python3 -m http.server 8001
```

Open <http://localhost:8001/?widget=ribbon-lab>.

## Data

- `peaks.json` holds the peak catalog and locations.
- `summits.json` is the personal summit log.
- `assets/terrain-scene/` contains the versioned USGS 3DEP heightmap, aerial texture, and registration manifest for the official 14er footprint.
- `scripts/build_terrain_scene.py` rebuilds that package from the USGS Elevation and Imagery services.

The app is static HTML, CSS, and JavaScript—there is no build step.
