#!/usr/bin/env python3
"""Build one registered USGS terrain scene for the statewide 14er view."""

from io import BytesIO
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import json
import math
import time

import numpy as np
from PIL import Image

WEST, SOUTH, EAST, NORTH = -108.26, 36.87, -104.79, 40.51
EARTH_RADIUS = 6378137.0
HEIGHT_SIZE, IMAGE_SIZE, MESH_SIZE = 2048, 4096, 513
ELEVATION_SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
IMAGERY_SERVICE = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export"


def mercator(lon, lat):
    return (
        EARTH_RADIUS * math.radians(lon),
        EARTH_RADIUS * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)),
    )


def download(service, params):
    request = Request(service + "?" + urlencode(params), headers={"User-Agent": "14ers-terrain-scene-builder/1.0"})
    for attempt in range(4):
        try:
            with urlopen(request, timeout=180) as response:
                return response.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def main():
    output = Path("assets/terrain-scene")
    output.mkdir(parents=True, exist_ok=True)
    xmin, ymin = mercator(WEST, SOUTH)
    xmax, ymax = mercator(EAST, NORTH)
    bbox = ",".join(f"{value:.6f}" for value in (xmin, ymin, xmax, ymax))
    common = {"bbox": bbox, "bboxSR": 3857, "imageSR": 3857, "adjustAspectRatio": "false", "f": "image"}

    print("Downloading 2048 px USGS 3DEP heightmap…")
    elevation_bytes = download(ELEVATION_SERVICE, common | {"size": f"{HEIGHT_SIZE},{HEIGHT_SIZE}", "format": "tiff", "pixelType": "F32"})
    elevation = np.asarray(Image.open(BytesIO(elevation_bytes)), dtype=np.float32)
    valid = np.isfinite(elevation) & (elevation > -500) & (elevation < 10000)
    fill = float(np.nanmedian(elevation[valid]))
    elevation = np.where(valid, elevation, fill)
    minimum = float(np.floor(elevation.min() * 10) / 10)
    maximum = float(np.ceil(elevation.max() * 10) / 10)
    unit = 0.1
    encoded = np.clip(np.rint((elevation - minimum) / unit), 0, 65535).astype("<u2")
    encoded.tofile(output / "heightmap.bin")

    print("Downloading 4096 px USGS aerial texture…")
    imagery_bytes = download(IMAGERY_SERVICE, common | {"size": f"{IMAGE_SIZE},{IMAGE_SIZE}", "format": "jpg", "transparent": "false"})
    image = Image.open(BytesIO(imagery_bytes)).convert("RGB")
    image.save(output / "imagery.jpg", quality=92, optimize=True, progressive=True, subsampling=0)

    manifest = {
        "version": "2026-08-20-statewide-14ers-scene-v1",
        "bounds": [WEST, SOUTH, EAST, NORTH],
        "projection": "EPSG:3857",
        "heightSize": HEIGHT_SIZE,
        "imageSize": IMAGE_SIZE,
        "meshSize": MESH_SIZE,
        "minElevation": minimum,
        "maxElevation": maximum,
        "heightUnit": unit,
        "extent": [round((xmax - xmin) / 100000, 6), round((ymax - ymin) / 100000, 6)],
        "reliefScale": 0.00016,
        "elevationSource": "USGS 3DEP Elevation ImageServer",
        "imagerySource": "USGS Imagery Only MapServer",
        "buildDate": time.strftime("%Y-%m-%d"),
    }
    (output / "terrain-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
