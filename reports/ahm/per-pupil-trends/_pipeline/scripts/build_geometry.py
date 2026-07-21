#!/usr/bin/env python3
"""Build towns_xy.json: two-level pre-projected CT town geometry.

Level 1 ("coarse"): topologically simplified via mapshaper, for full-state
maps. Shared boundary arcs are simplified once so neighbors stay glued;
NEVER use shapely's per-polygon simplify() here, which creates slivers.
Level 2 ("towns"): full TIGER resolution, for zoom insets.

Requires: geopandas; npx mapshaper (npm install mapshaper).
Input: tl_2023_09_cousub.zip from Census TIGER (COUSUB, state 09).
"""
import geopandas as gpd, json, subprocess, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "tl_2023_09_cousub.zip"
t = gpd.read_file(f"zip://{SRC}")
t = t[t["NAME"] != "County subdivisions not defined"][["NAME", "geometry"]]
t = t.to_crs(26956)                      # NAD83 / Connecticut (ft-free, m)
t.to_file("/tmp/towns_full.geojson", driver="GeoJSON")
subprocess.run(["npx", "mapshaper", "/tmp/towns_full.geojson",
    "-simplify", "weighted", "8%", "keep-shapes",
    "-o", "/tmp/towns_coarse.geojson", "format=geojson"], check=True)

full = gpd.read_file("/tmp/towns_full.geojson").set_index("NAME")
coarse = gpd.read_file("/tmp/towns_coarse.geojson").set_index("NAME")
state = coarse.dissolve()

minx, miny, maxx, maxy = full.total_bounds
W = 960.0
k = W / (maxx - minx)
H = round((maxy - miny) * k, 1)
tx = lambda x: round((x - minx) * k, 1)
ty = lambda y: round((maxy - y) * k, 1)     # flip y for SVG

def rings(geom):
    gs = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
    out = []
    for g in gs:
        out.append([[tx(x), ty(y)] for x, y in g.exterior.coords])
        for hole in g.interiors:
            out.append([[tx(x), ty(y)] for x, y in hole.coords])
    return out

geo = {"viewW": W, "viewH": H,
       "coarse": {n: rings(g) for n, g in coarse.geometry.items()},
       "towns": {n: rings(g) for n, g in full.geometry.items()},
       "state": rings(state.iloc[0].geometry)}
open("towns_xy.json", "w").write(json.dumps(geo, separators=(",", ":")))
print("towns_xy.json written")
