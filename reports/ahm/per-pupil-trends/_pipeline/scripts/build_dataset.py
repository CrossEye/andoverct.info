#!/usr/bin/env python3
"""Assemble dataset.json from the collection outputs.

Inputs (cwd): town_data.json (from collect_towns.py), town_universe.json,
region_membership.csv, town_membership.csv, ct_state.json.
Output: dataset.json — the canonical layer consumed by the report
directives and the browser generator.
"""
import csv, json
from collections import defaultdict

D = json.load(open("town_data.json"))
data, town_lea = D["data"], D["town_lea"]

# reconstruct the year axis and columnar series
all_years = sorted({int(y) for t in data for y in data[t]})
yidx = {y: i for i, y in enumerate(all_years)}

reg_members, reg_grades, town_regions = defaultdict(list), {}, defaultdict(list)
for r in csv.DictReader(open("region_membership.csv")):
    reg_members[r["region"]].append(r["member_town"])
    reg_grades[r["region"]] = r["grades"]
    town_regions[r["member_town"]].append(r["region"])

NO_LOCAL = {"Durham", "Haddam", "Killingworth", "Lyme"}

units = {}
for t, series in data.items():
    is_region = t.startswith("Region")
    u = {"type": "region" if is_region else "town", "leaid": town_lea.get(t, ""),
         "enr": [None] * len(all_years), "exp": [None] * len(all_years)}
    if is_region:
        u["members"] = reg_members.get(t, []); u["grades"] = reg_grades.get(t, "")
    else:
        u["local_district"] = True
        if t in town_regions: u["regions"] = town_regions[t]
    for y, rec in series.items():
        i = yidx[int(y)]
        if rec.get("enrollment_fall") is not None: u["enr"][i] = rec["enrollment_fall"]
        if rec.get("exp_current_elsec_total") is not None:
            u["exp"][i] = rec["exp_current_elsec_total"]
    units[t] = u
for t in NO_LOCAL:
    units[t] = {"type": "town", "local_district": False,
                "regions": town_regions.get(t, []), "enr": None, "exp": None}

S = {int(k): v for k, v in json.load(open("ct_state.json")).items()}
units["Connecticut (statewide)"] = {
    "type": "state",
    "enr": [S[y]["enr"] if y in S else None for y in all_years],
    "exp": [S[y]["exp"] if y in S else None for y in all_years],
    "note": ("Constant-universe sum of traditional local and regional "
             "districts; excludes charter schools. Precomputed; not the "
             "sum of dataset units.")}

U = json.load(open("town_universe.json"))
rings = {int(k): v for k, v in U["rings"].items()}
CORE = ["Andover", "Hebron", "Marlborough"]

def block_members(k):
    towns = set(CORE)
    for j in range(1, k + 1): towns |= set(rings[j])
    regs = [rg for rg, mts in reg_members.items()
            if mts and all(m in towns for m in mts)]
    return sorted(towns) + sorted(regs)

groups = {
 "andover": {"label": "Andover (elementary district)", "members": ["Andover"]},
 "hebron": {"label": "Hebron (elementary district)", "members": ["Hebron"]},
 "marlborough": {"label": "Marlborough (elementary district)", "members": ["Marlborough"]},
 "rham": {"label": "RHAM (Regional District 8)", "members": ["Region 08 (RHAM)"]},
 "core": {"label": "Andover + Hebron + Marlborough + RHAM",
          "members": CORE + ["Region 08 (RHAM)"]},
 "block1": {"label": "Block 1: the core region and its bordering towns",
   "definition": ("Andover, Hebron, and Marlborough, RHAM, and every town "
     "sharing a land boundary with the core (TIGER 2023 boundaries, water "
     "removed), plus any regional district all of whose member towns fall inside"),
   "members": block_members(1)},
 "block2": {"label": "Block 2: through the second contiguity ring",
   "definition": "Block 1 plus all towns bordering it, plus fully contained regional districts",
   "members": block_members(2)},
 "block3": {"label": "Block 3: through the third contiguity ring",
   "definition": "Block 2 plus all towns bordering it, plus fully contained regional districts",
   "members": block_members(3)},
 "peers45": {"label": "The 45 elementary-only peer districts", "members": U["peers45"]},
 "ct_statewide": {"label": "Connecticut statewide",
   "definition": ("All traditional local and regional public school districts, "
     "held to a constant universe across the window (charter schools excluded)"),
   "members": ["Connecticut (statewide)"]},
}

basis = ("NCES/Census F-33 school district finance data, NCES basis (current "
 "elementary-secondary expenditure; includes state on-behalf teacher "
 "retirement). Enrollment is F-33 fall membership (October counts). "
 "FY2022-23 harmonized from Census unit files; verified to reconcile "
 "exactly with the NCES series on the FY2021 overlap.")

json.dump({"version": 1, "basis": basis, "years": all_years,
           "units": units, "groups": groups},
          open("dataset.json", "w"), separators=(",", ":"))
print(f"dataset.json: {len(units)} units, {len(groups)} groups, "
      f"FY{all_years[0]}-FY{all_years[-1]}")
