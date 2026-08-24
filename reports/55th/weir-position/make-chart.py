"""Draw weir-position-chart.svg from district-lean-vs-conservatism.csv.

    python make-chart.py

Scatter of the 151 districts: x = two-party Democratic share (partisan lean),
y = the representative's W-NOMINATE coordinate (higher = more conservative).
The most conservative members are darkened, the 55th District is marked, and
a least-squares trend line shows what a district's lean would predict.
Palette follows the site's bluegold theme.
"""
import csv, os

HERE = os.path.dirname(os.path.abspath(__file__))
rows = [r for r in csv.DictReader(open(os.path.join(HERE, "district-lean-vs-conservatism.csv"), encoding="utf-8")) if r["coord1D"]]
pts = [(float(r["dem_share"]), float(r["coord1D"]), r) for r in rows]

W, H = 785, 568
L, R, T, B = 70, 24, 40, 62
pw, ph = W - L - R, H - T - B
xmin, xmax = 0.30, 0.95
ymin, ymax = -1.08, 1.08
X = lambda v: L + (v - xmin) / (xmax - xmin) * pw
Y = lambda v: T + (ymax - v) / (ymax - ymin) * ph

# trend line
n = len(pts); mx = sum(p[0] for p in pts) / n; my = sum(p[1] for p in pts) / n
b = sum((p[0] - mx) * (p[1] - my) for p in pts) / sum((p[0] - mx) ** 2 for p in pts); a = my - b * mx

top = sorted(pts, key=lambda p: -p[1])[:11]
topset = {p[2]["district"] for p in top}
weir = next(p for p in pts if p[2]["district"] == "55")

s = []
s.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif">')
s.append(f'<rect width="{W}" height="{H}" fill="#ffffff"/>')
# grid
for v in (0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
    s.append(f'<line x1="{X(v):.1f}" y1="{T}" x2="{X(v):.1f}" y2="{T+ph}" stroke="{"#cfd6df" if v == 0.5 else "#eef2f7"}" stroke-width="{1.2 if v == 0.5 else 0.8}"/>')
    s.append(f'<text x="{X(v):.1f}" y="{T+ph+18}" text-anchor="middle" font-size="11" fill="#5b6775">{int(v*100)}%</text>')
for v in (-1, -0.5, 0, 0.5, 1):
    s.append(f'<line x1="{L}" y1="{Y(v):.1f}" x2="{L+pw}" y2="{Y(v):.1f}" stroke="#eef2f7" stroke-width="0.8"/>')
    s.append(f'<text x="{L-8}" y="{Y(v)+4:.1f}" text-anchor="end" font-size="11" fill="#5b6775">{v:+.1f}</text>')
s.append(f'<rect x="{L}" y="{T}" width="{pw}" height="{ph}" fill="none" stroke="#d7dde5" stroke-width="0.8"/>')
# trend, clipped to the plot area
tx = [v for v in (xmin, xmax, (ymin - a) / b, (ymax - a) / b) if xmin <= v <= xmax and ymin <= a + b * v <= ymax]
tx0, tx1 = min(tx), max(tx)
s.append(f'<line x1="{X(tx0):.1f}" y1="{Y(a+b*tx0):.1f}" x2="{X(tx1):.1f}" y2="{Y(a+b*tx1):.1f}" stroke="#e8a800" stroke-width="2.2"/>')
# points
for x, y, r in pts:
    if r["district"] == "55": continue
    if r["district"] in topset:
        s.append(f'<circle cx="{X(x):.1f}" cy="{Y(y):.1f}" r="4" fill="#2b3744" stroke="#2b3744" stroke-width="0.8"><title>{r["legislator"]} ({r["party"]}-{r["district"]}): lean {x:.1%} D, coord {y:+.2f}, rank {r["cons_rank"]}</title></circle>')
    else:
        s.append(f'<circle cx="{X(x):.1f}" cy="{Y(y):.1f}" r="3.3" fill="#5b6775" fill-opacity="0.62" stroke="#ffffff" stroke-opacity="0.62" stroke-width="0.5"><title>{r["legislator"]} ({r["party"]}-{r["district"]}): lean {x:.1%} D, coord {y:+.2f}, rank {r["cons_rank"]}</title></circle>')
wx, wy = X(weir[0]), Y(weir[1])
s.append(f'<circle cx="{wx:.1f}" cy="{wy:.1f}" r="6" fill="#0f2a4a" stroke="#ffffff" stroke-width="0.8"><title>Steve Weir (R-55): lean {weir[0]:.1%} D, coord {weir[1]:+.2f}, rank {weir[2]["cons_rank"]}</title></circle>')
s.append(f'<line x1="{wx+7:.1f}" y1="{wy-7:.1f}" x2="{wx+60:.1f}" y2="{wy-52:.1f}" stroke="#0f2a4a" stroke-width="0.9" stroke-linecap="round"/>')
s.append(f'<text x="{wx+64:.1f}" y="{wy-56:.1f}" font-size="12.5" font-weight="700" fill="#0f2a4a">Weir · 55th District</text>')
s.append(f'<text x="{wx+64:.1f}" y="{wy-41:.1f}" font-size="11" fill="#2b3744">leans {weir[0]:.1%} Democratic; {weir[2]["cons_rank"]}th most conservative record</text>')
# legend
lx, ly = L + 14, T + ph - 52  # bottom-left corner is empty
s.append(f'<circle cx="{lx}" cy="{ly}" r="4" fill="#2b3744"/><text x="{lx+10}" y="{ly+4}" font-size="11" fill="#2b3744">11 most conservative members</text>')
s.append(f'<circle cx="{lx}" cy="{ly+18}" r="3.3" fill="#5b6775" fill-opacity="0.62"/><text x="{lx+10}" y="{ly+22}" font-size="11" fill="#2b3744">all other districts</text>')
s.append(f'<line x1="{lx-5}" y1="{ly+36}" x2="{lx+5}" y2="{ly+36}" stroke="#e8a800" stroke-width="2.2"/><text x="{lx+10}" y="{ly+40}" font-size="11" fill="#2b3744">trend: what a district\'s lean would predict</text>')
# axis titles
s.append(f'<text x="{L+pw/2:.1f}" y="{H-14}" text-anchor="middle" font-size="12" fill="#19222e">District partisan lean — two-party Democratic share, 2012–2024 top-of-ticket races (more Democratic →)</text>')
s.append(f'<text transform="translate(18,{T+ph/2:.1f}) rotate(-90)" text-anchor="middle" font-size="12" fill="#19222e">Representative\'s W-NOMINATE coordinate, 2025–2026 (higher = more conservative)</text>')
s.append(f'<text x="{X(0.5)+4:.1f}" y="{T+ph-6}" font-size="10.5" fill="#aab6c4">even</text>')
s.append('</svg>')
open(os.path.join(HERE, "weir-position-chart.svg"), "w", encoding="utf-8").write("\n".join(s) + "\n")
print(f"chart: {len(pts)} districts, trend slope {b:.2f}, Weir at ({weir[0]:.3f}, {weir[1]:.3f})")
