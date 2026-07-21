#!/usr/bin/env python3
"""Build cpi_fy.json: CPI-U July-June fiscal-year averages from FRED."""
import csv, json, urllib.request

URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS"
raw = urllib.request.urlopen(URL).read().decode()
cpi = {}
for row in csv.DictReader(raw.splitlines()):
    v = row["CPIAUCNS"].strip()
    if v:
        cpi[row["observation_date"][:7]] = float(v)

fy = {}
for y in range(1992, 2035):
    try:
        ms = [f"{y-1}-{m:02d}" for m in range(7, 13)] + \
             [f"{y}-{m:02d}" for m in range(1, 7)]
        fy[y] = round(sum(cpi[m] for m in ms) / 12, 3)
    except KeyError:
        pass

json.dump({"series": "CPI-U (BLS), July-June fiscal-year averages",
           "values": fy}, open("cpi_fy.json", "w"), indent=0)
print(f"cpi_fy.json: FY{min(fy)}-FY{max(fy)}")
