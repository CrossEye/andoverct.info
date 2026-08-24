"""Rebuild district-lean-vs-conservatism.csv for the weir-position report.

Joins each district's partisan lean (dem_share / rep_share, unchanged from the
previous build; derived from geocorr-town-to-district.csv and 2012-2024
top-of-ticket results) to the current-term W-NOMINATE ranking
(ct-house-conservatism-ranking-25-26.csv, produced by scale-ct-house.R).

The seat holder for each district is the member of the 2026 roster
(WeirVotes/reports/rosters/2026.json) with the most recorded votes; the
ranking is keyed by the printed grid name that roster records.

    python merge-lean.py            # writes district-lean-vs-conservatism.csv
                                    # and prints the figures the report cites
"""
import csv, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROSTER = os.path.join(HERE, "..", "..", "..", "..", "WeirVotes", "reports", "rosters", "2026.json")
LEAN = os.path.join(HERE, "district-lean-vs-conservatism.csv")
RANK = os.path.join(HERE, "ct-house-conservatism-ranking-25-26.csv")

lean = {r["district"]: r for r in csv.DictReader(open(LEAN, encoding="utf-8"))}
rank = {r["legislator"]: r for r in csv.DictReader(open(RANK, encoding="utf-8"))}
roster = json.load(open(ROSTER, encoding="utf-8"))

# seat holder per district = most votes in 2026
holder = {}
for m in roster:
    d = str(int(m["district"]))
    if d not in holder or m["votes"] > holder[d]["votes"]:
        holder[d] = m

def label(m):
    return max(m["printedNames"], key=len)

out = []
missing = []
for d in sorted(lean, key=int):
    m = holder.get(d)
    if not m:
        missing.append(d); continue
    lab = label(m)
    rr = rank.get(lab)
    row = dict(lean[d])
    row["legislator"] = m["fullName"].replace('"', "")
    row["party"] = m["party"]
    row["coord1D"] = f'{float(rr["coord1D"]):.4f}' if rr else ""
    row["cons_rank"] = rr["rank"] if rr else ""
    if not rr: missing.append(f"{d}:{lab} (not ranked)")
    out.append(row)

with open(LEAN, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["district", "legislator", "party", "dem_share", "rep_share", "coord1D", "cons_rank"])
    w.writeheader(); w.writerows(out)
print(f"wrote {len(out)} districts; unresolved: {missing}")

# ---- figures the report cites ----
weir = next(r for r in out if r["district"] == "55")
wd = float(weir["dem_share"]); wc = float(weir["coord1D"])
ranked = [r for r in out if r["coord1D"]]
more_r = sum(1 for r in out if float(r["dem_share"]) < wd)
print(f"55th dem_share {wd:.4f}; districts more R-leaning than the 55th: {more_r} of {len(out)}; more D-leaning: {len(out)-1-more_r}")
r_in_d = [r for r in ranked if r["party"] == "R" and float(r["dem_share"]) > 0.5]
print(f"Republicans in D-leaning seats: {len(r_in_d)}; more conservative than Weir: {[r['legislator'] for r in r_in_d if float(r['coord1D']) > wc]}")
# neighbours on the scale (full ranking, both parties)
allrank = sorted(rank.values(), key=lambda r: int(r["rank"]))
i = [r["legislator"] for r in allrank].index("WEIR")
print("neighbours:", [r["legislator"] for r in allrank[max(0, i-2):i]], "|WEIR|", [r["legislator"] for r in allrank[i+1:i+3]])
# gap from the lean-predicted position: simple linear fit coord ~ dem_share over ranked districts
xs = [float(r["dem_share"]) for r in ranked]; ys = [float(r["coord1D"]) for r in ranked]
n = len(xs); mx = sum(xs)/n; my = sum(ys)/n
b = sum((x-mx)*(y-my) for x, y in zip(xs, ys)) / sum((x-mx)**2 for x in xs); a = my - b*mx
resid = sorted(((float(r["coord1D"]) - (a + b*float(r["dem_share"]))), r["district"], r["legislator"]) for r in ranked)
print("largest positive residuals (record more conservative than lean predicts):", [(round(g, 3), d, l) for g, d, l in resid[-5:][::-1]])
