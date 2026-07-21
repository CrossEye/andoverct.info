#!/usr/bin/env python3
"""Build the denormalized Connecticut statewide series (constant universe).

The universe is fixed to the districts present in the latest Census unit
file (traditional local + regional districts; the recent Census files omit
charter-school LEAs, and a shifting universe would bias the trend). For
each fiscal year, sums current elementary-secondary expenditure and fall
membership over that universe, on the NCES basis.

Year convention: Census FY (FY2023 = school year 2022-23). The Urban API
labels years by school-year START, so Urban year Y = Census FY Y+1.

Inputs: elsec23.xlsx (or newer) in cwd; Urban API over the network.
Output: ct_state.json {fy: {exp, enr}}
"""
import json, time, urllib.request
import pandas as pd

UNIT_FILE = "elsec23.xlsx"

df = pd.read_excel(UNIT_FILE)
df["NCESID"] = df["NCESID"].astype(str).str.replace(".0", "", regex=False).str.zfill(7)
universe = set(df[df["NCESID"].str.startswith("09")]["NCESID"])
print(len(universe), "units in constant universe")

def fetch(url):
    for _ in range(4):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                return json.load(r)
        except Exception:
            time.sleep(3)
    raise RuntimeError(url)

state = {}
for uy in range(2002, 2021):                       # FY2003-FY2021 vintages
    url = f"https://educationdata.urban.org/api/v1/school-districts/ccd/finance/{uy}/?fips=9"
    rows = []
    while url:
        d = fetch(url); rows += d["results"]; url = d.get("next")
    exp = enr = 0
    for r in rows:
        if str(r.get("leaid", "")).zfill(7) not in universe:
            continue
        e, m = r.get("exp_current_elsec_total"), r.get("enrollment_fall_responsible")
        if e and e > 0 and m and m > 0:
            exp += e; enr += m
    state[uy + 1] = {"exp": exp, "enr": enr}
    print("FY", uy + 1, state[uy + 1])

# Census-file years override the (preliminary) Urban vintage for the overlap
# and extend forward. NCES basis: TCURELSC minus V91 (private-school
# payments, which Census folds into instruction but NCES excludes).
for fy, fn in [(2021, "elsec21.xls"), (2022, "elsec22.xls"), (2023, "elsec23.xlsx")]:
    d2 = pd.read_excel(fn)
    d2["NCESID"] = d2["NCESID"].astype(str).str.replace(".0", "", regex=False).str.zfill(7)
    ct = d2[d2["NCESID"].isin(universe)]
    m = (ct["TCURELSC"] > 0) & (ct["V33"] > 0)
    state[fy] = {
        "exp": int(((ct.loc[m, "TCURELSC"] - ct.loc[m, "V91"].clip(lower=0)).sum()) * 1000),
        "enr": int(ct.loc[m, "V33"].sum())}
    print("FY", fy, state[fy])

json.dump({str(k): v for k, v in state.items()}, open("ct_state.json", "w"))
print("ct_state.json written")
