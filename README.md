# Colorado 14ers

A personal progress tracker for Colorado's 58 named fourteeners.

The standalone app pairs a real Leaflet terrain map and expandable peak records with an aerial, USGS 3DEP-based terrain view of the statewide challenge.

## Local preview

```sh
python3 -m http.server 8001
```

Open <http://localhost:8001/?widget=ribbon-lab>.

## Data

- `peaks.json` holds the peak catalog and locations.
- `summits.json` is the personal summit log.
- `assets/usgs-colorado-dem.tiff` is the local elevation grid used by the terrain view.

The app is static HTML, CSS, and JavaScript—there is no build step.
