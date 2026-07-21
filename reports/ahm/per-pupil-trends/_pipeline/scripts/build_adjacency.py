#!/usr/bin/env python3
"""Build adjacency.json: the land-adjacency graph between CT towns.

Two towns are adjacent when they share a boundary on dry land. TIGER COUSUB
boundaries follow river centerlines, so raw shared-boundary tests would call
Glastonbury-Rocky Hill neighbors; the report's rings do not. Method (same
rule the block memberships were built with): take each pair's shared boundary
linework and subtract TIGER AREAWATER; the pair is adjacent when more than
DRY_MIN meters of shared boundary survive. Genuine dry-land quirks (the
Wethersfield-Glastonbury old river channel) survive; centerline-only
"borders" do not.

Requires: shapely, pyshp (no GDAL). Inputs in the working directory:
  tl_2023_09_cousub.zip and tl_2023_09XXX_areawater.zip (all nine planning
  regions), from Census TIGER 2023.

Writes adjacency.json: {town: [sorted neighbor names]}.
"""
import glob
import io
import json
import math
import sys
import zipfile

import shapefile
from shapely.geometry import shape
from shapely.strtree import STRtree

DRY_MIN_M = 25.0  # meters of dry shared boundary required for adjacency


def read_zip_shapes(path):
    with zipfile.ZipFile(path) as z:
        base = next(n[:-4] for n in z.namelist() if n.endswith(".shp"))
        r = shapefile.Reader(
            shp=io.BytesIO(z.read(base + ".shp")),
            dbf=io.BytesIO(z.read(base + ".dbf")),
            shx=io.BytesIO(z.read(base + ".shx")),
        )
        fields = [f[0] for f in r.fields[1:]]
        for sr in r.iterShapeRecords():
            yield dict(zip(fields, sr.record)), shape(sr.shape.__geo_interface__)


def main():
    towns = {}
    for rec, geom in read_zip_shapes("tl_2023_09_cousub.zip"):
        if rec["NAME"] == "County subdivisions not defined":
            continue
        towns[rec["NAME"]] = geom

    water = [g for path in sorted(glob.glob("tl_2023_09*_areawater.zip"))
             for _, g in read_zip_shapes(path)]
    wtree = STRtree(water)

    # meters per degree at CT's latitude, for measuring lon/lat linework
    lat = 41.6
    m_lon = 111320.0 * math.cos(math.radians(lat))
    m_lat = 110950.0

    def meters(line):
        total = 0.0
        segs = getattr(line, "geoms", [line])
        for seg in segs:
            cs = list(seg.coords)
            for (x0, y0), (x1, y1) in zip(cs, cs[1:]):
                total += math.hypot((x1 - x0) * m_lon, (y1 - y0) * m_lat)
        return total

    names = sorted(towns)
    adjacency = {n: [] for n in names}
    for i, a in enumerate(names):
        ga = towns[a]
        for b in names[i + 1:]:
            gb = towns[b]
            if not ga.envelope.intersects(gb.envelope):
                continue
            sharedline = ga.boundary.intersection(gb.boundary)
            if sharedline.is_empty or meters(sharedline) < DRY_MIN_M:
                continue
            dry = sharedline
            for wi in wtree.query(sharedline):
                dry = dry.difference(water[wi])
                if dry.is_empty:
                    break
            if not dry.is_empty and meters(dry) >= DRY_MIN_M:
                adjacency[a].append(b)
                adjacency[b].append(a)

    for n in adjacency:
        adjacency[n].sort()
    with open("adjacency.json", "w") as f:
        json.dump(adjacency, f, indent=0, sort_keys=True)
    pairs = sum(len(v) for v in adjacency.values()) // 2
    print(f"adjacency.json written: {len(names)} towns, {pairs} adjacent pairs")


if __name__ == "__main__":
    sys.exit(main())
