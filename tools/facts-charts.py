#!/usr/bin/env python3
"""
Static chart generator for the-facts editions built on CT EdSight data.

    python tools/facts-charts.py the-facts/editions/<edition-id>

Reads the three committed EdSight datasets under data/edsight/ and writes
self-contained SVGs into the target folder, plus PNGs for social posting.
Every SVG carries its own title, key and source line so it reads correctly
lifted out of the page and dropped into a Facebook post.

Palette is the-facts' own bluegold, validated against its cream surface
(#f4f6f9): Andover gold #9a7400 (3.98:1), peer group #2f6db5 (4.88:1),
Connecticut navy #143862 (10.95:1), other districts #7a8699 (3.40:1).

Charts whose titles say "same scale" are drawn on a shared axis range so the
year-over-year comparison is honest — do not let them autoscale separately.

PNG rendering needs Chrome; pass --no-png to skip it.
"""
import csv, json, os, subprocess, sys, math
from collections import defaultdict

try:
    from PIL import ImageFont
except ImportError:
    ImageFont = None

_FONTS = {}


def text_width(s, size, bold=False):
    """Advance width of a string in Georgia at `size` px.

    Measured from the actual font file so legend items can be spaced by a
    constant gap between the end of one label and the next marker. Falls back
    to a per-character estimate where the font or Pillow is unavailable.
    """
    path = r'C:\Windows\Fonts\georgia' + ('b' if bold else '') + '.ttf'
    key = (path, round(size))
    if key not in _FONTS:
        try:
            _FONTS[key] = ImageFont.truetype(path, int(round(size))) if ImageFont else None
        except Exception:
            _FONTS[key] = None
    f = _FONTS[key]
    return f.getlength(s) if f else len(s) * size * 0.52

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'edsight')

ME = 'Andover School District'
STATE = 'State of Connecticut'
CUR, PREV = '2025-26', '2024-25'

C_ME, C_PEER, C_CT, C_OTHER = '#9a7400', '#2f6db5', '#143862', '#7a8699'
C_INK, C_SOFT, C_FAINT = '#19222e', '#4a566a', '#7a8699'
C_BG, C_GRID, C_AXIS, C_GOLD = '#f4f6f9', '#dde4ee', '#c2ccda', '#e8a800'
SERIF = "Georgia, 'Times New Roman', serif"

# The 46-town comparison group, less Norwich (urban, several times the size of
# any other member). All 45 are K-6 or K-8 with no high school of their own.
PEER_EXCLUDE = {'Norwich'}


def esc(s):
    return (str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


# ---------------------------------------------------------------- data
def load():
    lvl, hn, allc, peers = {}, {}, {}, set()
    ent = {}
    for r in csv.DictReader(open(os.path.join(DATA, 'performance-index', 'performance-index.csv'), encoding='utf-8')):
        k = (r['district'], r['year'])
        idx = float(r['index']) if r['index'] else None
        cnt = float(r['count']) if r['count'] else None
        if r['entityType']:
            ent[r['district']] = r['entityType']
        if r['studentGroup'] in ('District', 'State'):
            lvl.setdefault(k, {})[r['subject']] = (idx, cnt)
            if r['subject'] == 'ELA':
                allc[k] = cnt
        if r['category'] == 'High Needs (F/R, EL or SWD)' and r['studentGroup'] == 'High Needs' and r['subject'] == 'ELA':
            hn[k] = cnt
    ppe = {}
    for r in csv.DictReader(open(os.path.join(DATA, 'per-pupil-expenditures', 'per-pupil-expenditures.csv'), encoding='utf-8')):
        if r['function'] == 'Total' and r['ppe']:
            ppe[(r['district'], r['year'])] = float(r['ppe'])
    growth = {}
    for r in csv.DictReader(open(os.path.join(DATA, 'accountability', 'accountability.csv'), encoding='utf-8')):
        if r['level'] == 'school':
            continue
        try:
            g = (float(r['Ind2ELA_All_Rate']) + float(r['Ind2Math_All_Rate'])) / 2
        except Exception:
            g = None
        growth[(r['district'], r['year'])] = g

    src = os.path.join(ROOT, 'reports', 'aes', 'peer-spending', 'peer_comparison_2024-25.csv')
    for r in csv.DictReader(open(src, encoding='utf-8-sig')):
        if r['District'] not in PEER_EXCLUDE:
            peers.add(r['District'] + ' School District')

    def weighted(subs):
        v = [t for s, t in subs.items() if t[0] is not None and t[1]]
        return sum(a * c for a, c in v) / sum(c for _, c in v) if len(v) >= 2 else None

    years = defaultdict(list)
    state = {}
    for (d, y), subs in lvl.items():
        rec = dict(name=d.replace(' School District', '').replace('Regional School District ', 'RSD '),
                   level=weighted(subs), growth=growth.get((d, y)), ppe=ppe.get((d, y)),
                   hn=(100 * hn[(d, y)] / allc[(d, y)]) if (hn.get((d, y)) and allc.get((d, y))) else None,
                   n=allc.get((d, y)), peer=d in peers, me=(d == ME))
        if d == STATE:
            state[y] = rec
        elif ent.get(d) in ('local', 'regional'):
            years[y].append(rec)
    return years, state


# ---------------------------------------------------------------- svg helpers
def nice_ticks(lo, hi, count=6):
    raw = (hi - lo) / count
    mag = 10 ** math.floor(math.log10(raw)) if raw > 0 else 1
    step = next((m * mag for m in (1, 2, 2.5, 5, 10) if m * mag >= raw), 10 * mag)
    t, out = math.ceil(lo / step) * step, []
    while t <= hi + 1e-9:
        out.append(round(t, 10))
        t += step
    return out


def chrome():
    for p in (r'C:\Program Files\Google\Chrome\Application\chrome.exe',
              r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'):
        if os.path.exists(p):
            return p
    return None


class Svg:
    """Minimal SVG builder: a title block, a plot area, a key and a source line."""

    def __init__(self, title, subtitle, w=1000, plot_h=430, source=''):
        self.w, self.parts = w, []
        self.title, self.subtitle, self.source = title, subtitle, source
        self.key_items = []
        self.key_y = 96 if subtitle else 70      # baseline of the key row
        self.head_h = self.key_y + 26            # plot area starts here
        self.plot_h = plot_h
        self.h = self.head_h + plot_h + 46

    def add(self, s):
        self.parts.append(s)

    def text(self, x, y, s, size=14, fill=C_SOFT, anchor='start', weight='normal', style='normal', family=SERIF):
        self.add(f'<text x="{x:.1f}" y="{y:.1f}" font-family="{family}" font-size="{size}" '
                 f'fill="{fill}" text-anchor="{anchor}" font-weight="{weight}" font-style="{style}">{esc(s)}</text>')

    def line(self, x1, y1, x2, y2, stroke, width=1, opacity=1, cap='butt'):
        self.add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{stroke}" '
                 f'stroke-width="{width}" stroke-opacity="{opacity}" stroke-linecap="{cap}"/>')

    def circle(self, cx, cy, r, fill, opacity=1, stroke=None, sw=0):
        st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ''
        self.add(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" fill="{fill}" fill-opacity="{opacity}"{st}/>')

    def diamond(self, cx, cy, r, fill, stroke, sw=2.5):
        self.add(f'<rect x="{cx - r:.1f}" y="{cy - r:.1f}" width="{2 * r}" height="{2 * r}" fill="{fill}" '
                 f'stroke="{stroke}" stroke-width="{sw}" transform="rotate(45 {cx:.1f} {cy:.1f})"/>')

    def key(self, items):
        self.key_items = items

    def render(self):
        out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
               f'width="{self.w}" height="{self.h}" role="img">',
               f'<rect width="{self.w}" height="{self.h}" fill="{C_BG}"/>',
               f'<rect x="0" y="0" width="{self.w}" height="4" fill="{C_GOLD}"/>']
        head = [f'<text x="34" y="46" font-family="{SERIF}" font-size="25" font-weight="bold" fill="{C_143}">{esc(self.title)}</text>']
        if self.subtitle:
            head.append(f'<text x="34" y="72" font-family="{SERIF}" font-size="15.5" font-style="italic" '
                        f'fill="{C_SOFT}">{esc(self.subtitle)}</text>')
        # key row: one constant gap between the end of a label and the next marker
        GAP, LEAD = 28, 16
        kx, ky = 34, self.key_y
        for shape, colour, label in self.key_items:
            if shape == 'bar':
                head.append(f'<rect x="{kx}" y="{ky - 9}" width="3.5" height="12" fill="{colour}"/>')
            elif shape == 'dia':
                head.append(f'<rect x="{kx - 1}" y="{ky - 8}" width="9" height="9" fill="{colour}" '
                            f'transform="rotate(45 {kx + 3.5} {ky - 3.5})"/>')
            elif shape == 'line':
                head.append(f'<rect x="{kx}" y="{ky - 5}" width="16" height="2" fill="{colour}"/>')
            else:
                head.append(f'<circle cx="{kx + 4}" cy="{ky - 4}" r="5" fill="{colour}"/>')
            head.append(f'<text x="{kx + LEAD}" y="{ky}" font-family="{SERIF}" font-size="13.5" fill="{C_SOFT}">{esc(label)}</text>')
            kx += LEAD + text_width(label, 13.5) + GAP
        out += head + self.parts
        if self.source:
            out.append(f'<text x="34" y="{self.h - 14}" font-family="{SERIF}" font-size="12" font-style="italic" '
                       f'fill="{C_FAINT}">{esc(self.source)}</text>')
        out.append('</svg>')
        return '\n'.join(out)


C_143 = C_CT  # heading ink for titles


# ---------------------------------------------------------------- charts
def strip_chart(rows, state_v, key_field, title, subtitle, xlab, fmt, source, xd=None, reffmt=None):
    pts = [r for r in rows if r[key_field] is not None]
    vs = [r[key_field] for r in pts]
    if xd is None:
        pad = (max(vs) - min(vs)) * 0.05
        xd = (min(vs) - pad, max(vs) + pad)
    s = Svg(title, subtitle, plot_h=260, source=source)
    L, R = 46, s.w - 34
    top = s.head_h + 26
    axis_y = top + 150

    def X(v):
        return L + (v - xd[0]) / (xd[1] - xd[0]) * (R - L)

    for t in nice_ticks(*xd, 7):
        if not xd[0] <= t <= xd[1]:
            continue
        s.line(X(t), top, X(t), axis_y, C_GRID)
        s.text(X(t), axis_y + 21, fmt(t), 13, C_FAINT, 'middle')
    s.line(L, axis_y, R, axis_y, C_AXIS)
    rf = reffmt or fmt
    me = next((r for r in pts if r['me']), None)
    for v, colour, name in ((state_v, C_CT, 'Connecticut'), (me and me[key_field], C_ME, 'Andover')):
        if v is None:
            continue
        s.line(X(v), top - 4, X(v), axis_y, colour, 2.5, cap='round')
        lbl = f'{name} {rf(v)}'
        s.text(min(max(X(v), L + len(lbl) * 3.8), R - len(lbl) * 3.8), top - 12, lbl, 14, colour, 'middle', 'bold')
    used = []
    for r in sorted(pts, key=lambda r: (r['me'], r['peer'])):
        px = X(r[key_field])
        row = 0
        while any(abs(u[0] - px) < 9 and u[1] == row for u in used):
            row += 1
        used.append((px, row))
        cy = axis_y - 13 - (row % 8) * 13
        if r['me']:
            s.circle(px, cy, 8, C_ME, 1, C_BG, 2.5)
        elif r['peer']:
            s.circle(px, cy, 5, C_PEER, 0.95)
        else:
            s.circle(px, cy, 4.4, C_OTHER, 0.5)
    s.text((L + R) / 2, s.head_h + 252, xlab, 14, C_SOFT, 'middle')
    s.key([('bar', C_ME, 'Andover'), ('bar', C_CT, 'Connecticut'),
           ('', C_PEER, '45-town peer group \u2014 small districts, no high school'),
           ('', C_OTHER, 'Other town district')])
    return s.render(), xd


def scatter_chart(rows, state_pt, xk, yk, title, subtitle, xlab, ylab, xfmt, yfmt, source, xd=None, yd=None):
    pts = [r for r in rows if r[xk] is not None and r[yk] is not None]
    xs, ys = [r[xk] for r in pts], [r[yk] for r in pts]
    sx = state_pt.get(xk) if state_pt else None
    sy = state_pt.get(yk) if state_pt else None
    if xd is None:
        xr = max(xs) - min(xs)
        hi = max(max(xs), sx if sx is not None else -1e9)
        xd = (min(xs) - xr * 0.05, hi + xr * 0.07)
    if yd is None:
        yr = max(ys) - min(ys)
        yd = (min(ys) - yr * 0.08, max(ys) + yr * 0.13)
    s = Svg(title, subtitle, plot_h=470, source=source)
    L, R = 72, s.w - 34
    T = s.head_h + 34
    B = T + 390

    def X(v):
        return L + (v - xd[0]) / (xd[1] - xd[0]) * (R - L)

    def Y(v):
        return B - (v - yd[0]) / (yd[1] - yd[0]) * (B - T)

    for t in nice_ticks(*yd, 5):
        if not yd[0] <= t <= yd[1]:
            continue
        s.line(L, Y(t), R, Y(t), C_GRID)
        s.text(L - 10, Y(t) + 5, yfmt(t), 13, C_FAINT, 'end')
    for t in nice_ticks(*xd, 6):
        if not xd[0] <= t <= xd[1]:
            continue
        s.text(X(t), B + 22, xfmt(t), 13, C_FAINT, 'middle')
    s.line(L, B, R, B, C_AXIS)
    s.text((L + R) / 2, B + 46, xlab, 14, C_SOFT, 'middle')
    s.add(f'<text x="22" y="{(T + B) / 2:.1f}" font-family="{SERIF}" font-size="14" fill="{C_SOFT}" '
          f'text-anchor="middle" transform="rotate(-90 22 {(T + B) / 2:.1f})">{esc(ylab)}</text>')

    me = next((r for r in pts if r['me']), None)
    refs = [(sx, C_CT, 'Connecticut'), (me and me[xk], C_ME, 'Andover')]
    refs = [(v, c, n) for v, c, n in refs if v is not None and xd[0] <= v <= xd[1]]
    refs.sort(key=lambda t: t[0])
    texts = [f'{n} {xfmt(v)}' for v, _, n in refs]
    collide = len(refs) == 2 and X(refs[1][0]) - len(texts[1]) * 3.6 < X(refs[0][0]) + len(texts[0]) * 3.6 + 8
    for i, (v, colour, name) in enumerate(refs):
        s.line(X(v), T - 4, X(v), B, colour, 2.5, 0.85, cap='round')
        ty = T - 26 if (collide and i == 0) else T - 11
        s.text(min(max(X(v), L + len(texts[i]) * 3.6), R - len(texts[i]) * 3.6), ty, texts[i], 14, colour, 'middle', 'bold')

    n = len(pts)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    syy = sum((y - my) ** 2 for y in ys)
    if sxx and syy:
        b = sxy / sxx
        a = my - b * mx
        r = sxy / math.sqrt(sxx * syy)
        s.line(X(xd[0]), Y(a + b * xd[0]), X(xd[1]), Y(a + b * xd[1]), C_SOFT, 2, 0.6, cap='round')
        # SVG collapses runs of whitespace, so separate the parts explicitly
        lbl = f'r = {"+" if r >= 0 else "\u2212"}{abs(r):.3f}  \u00b7  r\u00b2 = {r * r:.2f}  \u00b7  n = {n}'
        cx = R - len(lbl) * 3.4
        fy = Y(a + b * ((cx - L) / (R - L) * (xd[1] - xd[0]) + xd[0]))
        if fy > T + 30:
            s.line(cx, T + 20, cx, fy - 6, C_SOFT, 1, 0.45)
        s.text(R, T + 14, lbl, 13.5, C_SOFT, 'end')

    for r in sorted(pts, key=lambda r: (r['me'], r['peer'])):
        if r['me']:
            s.circle(X(r[xk]), Y(r[yk]), 8.5, C_ME, 1, C_BG, 2.5)
        elif r['peer']:
            s.circle(X(r[xk]), Y(r[yk]), 5.4, C_PEER, 0.95)
        else:
            s.circle(X(r[xk]), Y(r[yk]), 4.5, C_OTHER, 0.5)
    if sx is not None and sy is not None:
        s.diamond(X(sx), Y(sy), 7, C_CT, C_BG)
    s.key([('', C_ME, 'Andover'), ('dia', C_CT, 'Connecticut'),
           ('', C_PEER, '45-town peer group \u2014 small districts, no high school'),
           ('', C_OTHER, 'Other town district')])
    return s.render(), xd, yd


def change_chart(rows_prev, rows_cur, title, subtitle, source):
    prev = {r['name']: r for r in rows_prev}
    deltas = []
    for r in rows_cur:
        p = prev.get(r['name'])
        if p and p['level'] is not None and r['level'] is not None:
            deltas.append((r['name'], r['level'] - p['level'], r['peer'], r['me']))
    deltas.sort(key=lambda t: -t[1])
    s = Svg(title, subtitle, plot_h=400, source=source)
    L, R = 72, s.w - 34
    T = s.head_h + 30
    B = T + 320
    lo = min(d for _, d, _, _ in deltas)
    hi = max(d for _, d, _, _ in deltas)
    pad = (hi - lo) * 0.08
    yd = (lo - pad, hi + pad * 2.2)   # headroom for the Andover callout

    def Y(v):
        return B - (v - yd[0]) / (yd[1] - yd[0]) * (B - T)
    for t in nice_ticks(*yd, 6):
        if not yd[0] <= t <= yd[1]:
            continue
        s.line(L, Y(t), R, Y(t), C_GRID)
        s.text(L - 8, Y(t) + 5, (f'{t:+.0f}' if abs(t - round(t)) < 1e-9 else f'{t:+.1f}'), 13, C_FAINT, 'end')
    s.line(L, Y(0), R, Y(0), C_AXIS, 1.5)
    bw = (R - L) / len(deltas)
    for i, (name, d, peer, me) in enumerate(deltas):
        x = L + i * bw
        colour = C_ME if me else (C_PEER if peer else C_OTHER)
        op = 1 if me else (0.9 if peer else 0.45)
        y0, y1 = Y(0), Y(d)
        s.add(f'<rect x="{x + 0.6:.1f}" y="{min(y0, y1):.1f}" width="{max(bw - 1.2, 1.2):.1f}" '
              f'height="{max(abs(y1 - y0), 1):.1f}" fill="{colour}" fill-opacity="{op}"/>')
        if me:
            lbl = f'Andover {d:+.1f}'
            lx = min(max(x + bw / 2, L + len(lbl) * 4.2), R - len(lbl) * 4.2)
            s.text(lx, Y(d) - 14, lbl, 15, C_ME, 'middle', 'bold')
            s.line(x + bw / 2, Y(d) - 10, x + bw / 2, Y(d) - 2, C_ME, 2)
    s.text((L + R) / 2, B + 40, 'Each bar is one of Connecticut\u2019s 164 town districts, ranked by change', 14, C_SOFT, 'middle')
    s.add(f'<text x="24" y="{(T + B) / 2:.1f}" font-family="{SERIF}" font-size="14" fill="{C_SOFT}" '
          f'text-anchor="middle" transform="rotate(-90 24 {(T + B) / 2:.1f})">Change in performance index</text>')
    s.key([('', C_ME, 'Andover'), ('', C_PEER, '45-town peer group'), ('', C_OTHER, 'Other town district')])
    return s.render()


# ---------------------------------------------------------------- main
def main():
    if len(sys.argv) < 2:
        sys.exit('usage: facts-charts.py <target-folder> [--no-png]')
    out_dir = os.path.join(ROOT, sys.argv[1]) if not os.path.isabs(sys.argv[1]) else sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    years, state = load()
    cur, prev = years[CUR], years[PREV]
    SRC_PI = 'Source: CT EdSight, Performance Index. Chart: andoverct.info'
    SRC_PI_HN = 'Source: CT EdSight, Performance Index (subgroup counts). Chart: andoverct.info'
    SRC_NGA = 'Source: CT EdSight, Next Generation Accountability. Chart: andoverct.info'
    SRC_BOTH = 'Sources: CT EdSight, Performance Index and Per Pupil Expenditures by Function. Chart: andoverct.info'
    SRC_G_HN = 'Sources: CT EdSight, Next Generation Accountability and Performance Index. Chart: andoverct.info'
    SRC_G_PPE = 'Sources: CT EdSight, Next Generation Accountability and Per Pupil Expenditures. Chart: andoverct.info'

    files = {}
    # headline pair — one shared x-scale so the two years are comparable
    lv = [r['level'] for r in cur + prev if r['level'] is not None]
    pad = (max(lv) - min(lv)) * 0.05
    shared = (min(lv) - pad, max(lv) + pad)
    for yr, rows, tag in ((PREV, prev, 'index-2024-25'), (CUR, cur, 'index-2025-26')):
        svg, _ = strip_chart(rows, state[yr]['level'], 'level',
                             f'Performance index, {yr}',
                             'Every Connecticut town district. Same scale in both years.',
                             'Performance index (0\u2013100)', lambda v: f'{v:.0f}', SRC_PI, xd=shared,
                             reffmt=lambda v: f'{v:.1f}')
        files[tag] = svg

    files['change-2025-26'] = change_chart(
        prev, cur, 'Change in performance index, 2024-25 to 2025-26',
        'Andover posted the largest single-year gain of any town district in the state.', SRC_PI)

    # high-needs pair — shared scales on both axes
    hns = [r['hn'] for r in cur + prev if r['hn'] is not None] + [state[CUR]['hn'], state[PREV]['hn']]
    lvs = [r['level'] for r in cur + prev if r['level'] is not None]
    xd_hn = (min(hns) - 3, max(hns) + 3)
    yd_hn = (min(lvs) - 3, max(lvs) + 4)
    for yr, rows, tag in ((PREV, prev, 'highneeds-2024-25'), (CUR, cur, 'highneeds-2025-26')):
        svg, _, _ = scatter_chart(rows, state[yr], 'hn', 'level',
                                  f'Performance and student need, {yr}',
                                  'Student need explains most of the difference between districts. Same scale in both years.',
                                  'High-needs share of students', 'Performance index',
                                  lambda v: f'{v:.0f}%', lambda v: f'{v:.0f}', SRC_PI_HN, xd=xd_hn, yd=yd_hn)
        files[tag] = svg

    # the 2024-25 six-chart set (two of them are the headline charts above)
    svg, _ = strip_chart(prev, state[PREV]['growth'], 'growth', f'Academic growth, {PREV}',
                         'Average share of each student\u2019s individual growth target achieved.',
                         'Average % of growth target achieved', lambda v: f'{v:.0f}', SRC_NGA,
                         reffmt=lambda v: f'{v:.1f}')
    files['growth-2024-25'] = svg
    svg, _, _ = scatter_chart(prev, state[PREV], 'ppe', 'level', f'Performance and spending, {PREV}',
                              'Per-pupil spending explains very little of the difference between districts.',
                              'Total per-pupil spending', 'Performance index',
                              lambda v: f'${v:,.0f}', lambda v: f'{v:.0f}', SRC_BOTH)
    files['level-spending-2024-25'] = svg
    svg, _, _ = scatter_chart(prev, state[PREV], 'ppe', 'growth', f'Growth and spending, {PREV}',
                              'The same picture for growth.',
                              'Total per-pupil spending', 'Average % of growth target achieved',
                              lambda v: f'${v:,.0f}', lambda v: f'{v:.0f}', SRC_G_PPE)
    files['growth-spending-2024-25'] = svg
    svg, _, _ = scatter_chart(prev, state[PREV], 'hn', 'growth', f'Growth and student need, {PREV}',
                              'Growth tracks student need far less closely than the index does.',
                              'High-needs share of students', 'Average % of growth target achieved',
                              lambda v: f'{v:.0f}%', lambda v: f'{v:.0f}', SRC_G_HN)
    files['growth-highneeds-2024-25'] = svg

    for name, svg in files.items():
        with open(os.path.join(out_dir, name + '.svg'), 'w', encoding='utf-8') as f:
            f.write(svg)
        print('  wrote', name + '.svg')

    if '--no-png' in sys.argv:
        return
    exe = chrome()
    if not exe:
        print('  (Chrome not found — skipping PNGs)')
        return
    for name in files:
        svg_path = os.path.join(out_dir, name + '.svg')
        png = os.path.join(out_dir, name + '.png')
        head = open(svg_path, encoding='utf-8').read(400)
        w = int(head.split('width="')[1].split('"')[0])
        h = int(head.split('height="')[1].split('"')[0])
        subprocess.run([exe, '--headless', '--disable-gpu', '--hide-scrollbars',
                        f'--screenshot={png}', f'--window-size={w},{h}',
                        '--force-device-scale-factor=2', '--default-background-color=00000000',
                        'file:///' + svg_path.replace('\\', '/')],
                       capture_output=True)
        print('  wrote', name + '.png')


if __name__ == '__main__':
    main()
