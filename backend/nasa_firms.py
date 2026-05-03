"""
NASA FIRMS integration.

Default behavior: load the pre-cached GeoJSON from backend/data/firms_cache.json.
This ensures demo reliability regardless of network conditions.

Live mode: set the FIRMS_MAP_KEY environment variable to a valid NASA FIRMS map key
(obtainable for free at https://firms.modaps.eosdis.nasa.gov/usfs/api/area/).
When FIRMS_MAP_KEY is set and live=True is passed, fetches VIIRS SNPP NRT hotspots
for the Salinas bounding box directly from the API.

API reference: https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{product}/{area}/{days}
"""
from __future__ import annotations
import json
import os
from pathlib import Path
from typing import List, Tuple

CACHE_FILE    = Path(__file__).parent / "data" / "firms_cache.json"
FIRMS_BASE    = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
FIRMS_PRODUCT = "VIIRS_SNPP_NRT"
FIRMS_AREA    = "-121.545,36.500,-121.515,36.530"
FIRMS_DAYS    = 1


def load_cached() -> dict:
    with open(CACHE_FILE) as f:
        return json.load(f)


def _csv_to_geojson(csv_text: str) -> dict:
    lines = csv_text.strip().splitlines()
    if len(lines) < 2:
        return {"type": "FeatureCollection", "features": []}
    headers = [h.strip() for h in lines[0].split(",")]
    features = []
    for line in lines[1:]:
        vals = line.split(",")
        if len(vals) < len(headers):
            continue
        row = dict(zip(headers, [v.strip() for v in vals]))
        try:
            lat = float(row["latitude"])
            lng = float(row["longitude"])
        except (KeyError, ValueError):
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lng, lat]},
            "properties": row,
        })
    return {"type": "FeatureCollection", "features": features}


async def fetch_live(map_key: str) -> dict:
    import httpx
    url = f"{FIRMS_BASE}/{map_key}/{FIRMS_PRODUCT}/{FIRMS_AREA}/{FIRMS_DAYS}"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return _csv_to_geojson(resp.text)


def firms_ignition_points(geojson: dict) -> List[Tuple[float, float]]:
    """Return (lat, lng) tuples from a FIRMS GeoJSON FeatureCollection."""
    points = []
    for f in geojson.get("features", []):
        coords = f.get("geometry", {}).get("coordinates", [])
        if len(coords) >= 2:
            points.append((float(coords[1]), float(coords[0])))
    return points
