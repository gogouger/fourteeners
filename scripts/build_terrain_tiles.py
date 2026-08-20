#!/usr/bin/env python3
"""Build static USGS terrain and imagery tiles for the Colorado 14er footprint."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import argparse
import json
import math
import time

import numpy as np
from PIL import Image

WEST, EAST, SOUTH, NORTH = -108.26, -104.79, 36.87, 40.51
MIN_ZOOM, MAX_ZOOM, TILE_SIZE = 5, 11, 512
EARTH_RADIUS = 6378137.0
ELEVATION_SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
IMAGERY_SERVICE = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export"


def mercator(lon, lat):
    x = EARTH_RADIUS * math.radians(lon)
    y = EARTH_RADIUS * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y


def tile_xy(lon, lat, zoom):
    n = 2 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


def tile_bounds(x, y, zoom):
    n = 2 ** zoom
    lon_w = x / n * 360.0 - 180.0
    lon_e = (x + 1) / n * 360.0 - 180.0
    lat_n = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    lat_s = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    min_x, min_y = mercator(lon_w, lat_s)
    max_x, max_y = mercator(lon_e, lat_n)
    return min_x, min_y, max_x, max_y


def download(service, params):
    request = Request(service + "?" + urlencode(params), headers={"User-Agent": "14ers-terrain-builder/1.0"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=90) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def build_one(output_root, zoom, x, y, tile_size=TILE_SIZE, force=False, layers=("elevation", "imagery")):
    bounds = tile_bounds(x, y, zoom)
    bbox = ",".join(f"{value:.6f}" for value in bounds)
    common = {"bbox": bbox, "bboxSR": 3857, "imageSR": 3857, "size": f"{tile_size},{tile_size}", "adjustAspectRatio": "false", "f": "image"}
    elevation_path = output_root / "elevation" / str(zoom) / str(x) / f"{y}.png"
    imagery_path = output_root / "imagery" / str(zoom) / str(x) / f"{y}.jpg"
    elevation_path.parent.mkdir(parents=True, exist_ok=True)
    imagery_path.parent.mkdir(parents=True, exist_ok=True)
    if "elevation" in layers and (force or not elevation_path.exists()):
        payload = download(ELEVATION_SERVICE, common | {"format": "tiff", "pixelType": "F32"})
        elevation = np.asarray(Image.open(BytesIO(payload)), dtype=np.float32)
        elevation = np.nan_to_num(elevation, nan=0.0, posinf=0.0, neginf=0.0)
        elevation[(elevation < -500.0) | (elevation > 10000.0)] = 0.0
        encoded = np.clip(np.rint((elevation + 32768.0) * 256.0), 0, 16777215).astype(np.uint32)
        terrain_rgb = np.stack(((encoded >> 16) & 255, (encoded >> 8) & 255, encoded & 255), axis=-1).astype(np.uint8)
        Image.fromarray(terrain_rgb, "RGB").save(elevation_path, optimize=True)
    if "imagery" in layers and (force or not imagery_path.exists()):
        payload = download(IMAGERY_SERVICE, common | {"format": "jpg", "transparent": "false"})
        Image.open(BytesIO(payload)).convert("RGB").save(imagery_path, quality=86, optimize=True, progressive=True)
    return sum(path.stat().st_size for path in (elevation_path, imagery_path) if path.exists())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("assets/terrain"))
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--max-zoom", type=int, default=MAX_ZOOM)
    parser.add_argument("--rebuild-overview", action="store_true")
    parser.add_argument("--rebuild-zoom", type=int)
    parser.add_argument("--overview-tile-size", type=int, default=512)
    parser.add_argument("--overview-layer", choices=("all", "elevation", "imagery"), default="all")
    args = parser.parse_args()
    if args.rebuild_overview or args.rebuild_zoom is not None:
        rebuild_zoom = MIN_ZOOM if args.rebuild_zoom is None else args.rebuild_zoom
        x0, y_south = tile_xy(WEST, SOUTH, rebuild_zoom)
        x1, y_north = tile_xy(EAST, NORTH, rebuild_zoom)
        overview_tiles = [(rebuild_zoom, x, y) for x in range(x0, x1 + 1) for y in range(y_north, y_south + 1)]
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            layers = ("elevation", "imagery") if args.overview_layer == "all" else (args.overview_layer,)
            futures = [pool.submit(build_one, args.output, *tile, args.overview_tile_size, True, layers) for tile in overview_tiles]
            for future in as_completed(futures):
                future.result()
        print(f"rebuilt {len(overview_tiles)} overview tile(s) at {args.overview_tile_size}px")
        return
    tiles = []
    catalog = json.loads(Path("peaks.json").read_text())
    for zoom in range(MIN_ZOOM, args.max_zoom + 1):
        if zoom == args.max_zoom:
            detail_tiles = set()
            for peak in catalog:
                x, y = tile_xy(peak["latlon"][1], peak["latlon"][0], zoom)
                for offset_x in range(-1, 2):
                    for offset_y in range(-1, 2):
                        detail_tiles.add((zoom, x + offset_x, y + offset_y))
            tiles.extend(sorted(detail_tiles))
            continue
        x0, y_south = tile_xy(WEST, SOUTH, zoom)
        x1, y_north = tile_xy(EAST, NORTH, zoom)
        for x in range(x0, x1 + 1):
            for y in range(y_north, y_south + 1):
                tiles.append((zoom, x, y))
    total = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(build_one, args.output, *tile) for tile in tiles]
        for index, future in enumerate(as_completed(futures), 1):
            total += future.result()
            if index % 25 == 0 or index == len(tiles):
                print(f"{index}/{len(tiles)} tiles · {total / 1024 / 1024:.1f} MiB")
    manifest = {
        "version": "2026-08-20-14er-footprint-v2",
        "bounds": [WEST, SOUTH, EAST, NORTH],
        "minzoom": MIN_ZOOM,
        "maxzoom": args.max_zoom,
        "tileSize": TILE_SIZE,
        "terrainEncoding": "terrarium",
        "elevationSource": "USGS 3DEP Elevation ImageServer",
        "imagerySource": "USGS Imagery Only MapServer",
        "tileCount": len(tiles),
    }
    (args.output / "terrain-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
