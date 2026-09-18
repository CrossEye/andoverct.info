#!/usr/bin/env python3
"""
Square 1080x1080 grid card for social posting: English and math, spring 2025 and
spring 2026, every Connecticut town district on one axis per panel.

    python tools/facts-grid.py <out-folder>

Deliberately stripped down for a phone screen: no per-panel titles or legends
(the row and column labels carry them), no axis numbers beyond a few ticks, and
one legend at the bottom naming only Andover and Connecticut. The grey dots are
the other districts; they are the distribution, not a series anyone needs named.

All four panels share one x-scale, so the horizontal shift between columns is
the story and is honest.
"""
import csv, os, subprocess, sys, math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'edsight')
ME, STATE = 'Andover School District', 'State of Connecticut'
PREV, CUR = '2024-25', '2025-26'

C_ME, C_CT, C_OTHER = '#9a7400', '#143862', '#9aa6b6'
C_BG, C_INK, C_SOFT, C_GOLD = '#f4f6f9', '#19222e', '#4a566a', '#e8a800'
SERIF = "Georgia, 'Times New Roman', serif"
W = H = 1080


def load():
    ent, idx = {}, {}
    for r in csv.DictReader(open(os.path.join(DATA, 'performance-index', 'performance-index.csv'), encoding='utf-8')):
        if r['entityType']:
            ent[r['district']] = r['entityType']
        if r['studentGroup'] in ('District', 'State') and r['index']:
            idx[(r['district'], r['year'], r['subject'])] = float(r['index'])
    towns = [d for d, e in ent.items() if e in ('local', 'regional')]
    return towns, idx


def esc(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
    out_dir = out_dir if os.path.isabs(out_dir) else os.path.join(ROOT, out_dir)
    os.makedirs(out_dir, exist_ok=True)
    towns, idx = load()

    vals = [v for (d, y, s), v in idx.items()
            if d in towns and y in (PREV, CUR) and s in ('ELA', 'Math')]
    lo, hi = min(vals), max(vals)
    pad = (hi - lo) * 0.04
    xd = (lo - pad, hi + pad)

    L, R = 150, W - 46          # panel drawing area
    COL_W = (R - L - 58) / 2    # two columns with a gap for the arrow
    gap = 58
    rows = [('ELA', 'English', 470), ('Math', 'Math', 812)]   # y of each panel baseline

    def X(v, col):
        x0 = L + col * (COL_W + gap)
        return x0 + (v - xd[0]) / (xd[1] - xd[0]) * COL_W

    p = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">',
         f'<rect width="{W}" height="{H}" fill="{C_BG}"/>',
         f'<rect x="0" y="0" width="{W}" height="10" fill="{C_GOLD}"/>']

    def text(x, y, s, size, fill=C_SOFT, anchor='start', weight='normal', style='normal'):
        p.append(f'<text x="{x:.0f}" y="{y:.0f}" font-family="{SERIF}" font-size="{size}" fill="{fill}" '
                 f'text-anchor="{anchor}" font-weight="{weight}" font-style="{style}">{esc(s)}</text>')

    # headline
    text(W / 2, 92, 'Andover moved. Connecticut did not.', 46, C_CT, 'middle', 'bold')
    text(W / 2, 136, 'Every Connecticut town district, on the state performance index', 25, C_SOFT, 'middle', style='italic')

    # column headers, with an arrow between them
    for col, label in ((0, 'Spring 2025'), (1, 'Spring 2026')):
        text(L + col * (COL_W + gap) + COL_W / 2, 196, label, 30, C_CT, 'middle', 'bold')
    ax = L + COL_W + gap / 2
    p.append(f'<path d="M {ax - 20:.0f} 186 L {ax + 16:.0f} 186" stroke="{C_GOLD}" stroke-width="5" stroke-linecap="round"/>')
    p.append(f'<path d="M {ax + 4:.0f} 176 L {ax + 18:.0f} 186 L {ax + 4:.0f} 196 Z" fill="{C_GOLD}"/>')

    for subj, row_label, base in rows:
        text(36, base - 58, row_label, 36, C_CT, 'start', 'bold')
        for col, yr in ((0, PREV), (1, CUR)):
            # a light baseline and two ticks, enough to read position without clutter
            x0, x1 = X(xd[0], col), X(xd[1], col)
            p.append(f'<line x1="{x0:.0f}" y1="{base}" x2="{x1:.0f}" y2="{base}" stroke="#c2ccda" stroke-width="2"/>')
            for t in (50, 60, 70, 80):
                if xd[0] <= t <= xd[1]:
                    tx = X(t, col)
                    p.append(f'<line x1="{tx:.0f}" y1="{base}" x2="{tx:.0f}" y2="{base + 9}" stroke="#c2ccda" stroke-width="2"/>')
                    text(tx, base + 34, str(t), 20, '#8b97a8', 'middle')
            pts = sorted([(idx[(d, yr, subj)], d) for d in towns if (d, yr, subj) in idx])
            used = []
            for v, d in pts:
                px = X(v, col)
                r = 0
                while any(abs(u[0] - px) < 9 and u[1] == r for u in used):
                    r += 1
                used.append((px, r))
                dy = base - 14 - (r % 5) * 14
                if d == ME:
                    continue
                p.append(f'<circle cx="{px:.1f}" cy="{dy:.0f}" r="4.5" fill="{C_OTHER}" fill-opacity="0.75"/>')
            # Connecticut as a full-height rule, Andover as the one big mark
            sv = idx[(STATE, yr, subj)]
            p.append(f'<line x1="{X(sv, col):.1f}" y1="{base - 92}" x2="{X(sv, col):.1f}" y2="{base}" '
                     f'stroke="{C_CT}" stroke-width="5" stroke-linecap="round"/>')
            text(X(sv, col), base - 106, f'{sv:.1f}', 25, C_CT, 'middle', 'bold')
            av = idx[(ME, yr, subj)]
            ax_, ay = X(av, col), base - 116
            p.append(f'<line x1="{ax_:.1f}" y1="{ay + 18:.0f}" x2="{ax_:.1f}" y2="{base}" stroke="{C_ME}" stroke-width="4" stroke-linecap="round"/>')
            p.append(f'<circle cx="{ax_:.1f}" cy="{ay:.0f}" r="21" fill="{C_ME}" stroke="{C_BG}" stroke-width="5"/>')
            text(ax_, ay - 32, f'{av:.1f}', 30, C_ME, 'middle', 'bold')

    # one legend, naming only the two marks that matter
    ly = H - 68
    p.append(f'<circle cx="{W / 2 - 150:.0f}" cy="{ly - 9}" r="15" fill="{C_ME}"/>')
    text(W / 2 - 124, ly, 'Andover', 30, C_INK)
    p.append(f'<rect x="{W / 2 + 40:.0f}" y="{ly - 25}" width="6" height="32" fill="{C_CT}"/>')
    text(W / 2 + 60, ly, 'Connecticut', 30, C_INK)
    text(W / 2, H - 26, 'Source: CT EdSight  ·  andoverct.info/the-facts', 22, '#8b97a8', 'middle', style='italic')
    p.append('</svg>')

    svg = '\n'.join(p)
    base = os.path.join(out_dir, '04_grid')
    open(base + '.svg', 'w', encoding='utf-8').write(svg)
    for exe in (r'C:\Program Files\Google\Chrome\Application\chrome.exe',
                r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'):
        if os.path.exists(exe):
            subprocess.run([exe, '--headless', '--disable-gpu', '--hide-scrollbars',
                            f'--screenshot={base}.png', f'--window-size={W},{H}',
                            'file:///' + (base + '.svg').replace('\\', '/')], capture_output=True)
            break
    print('wrote', base + '.svg', 'and .png')


if __name__ == '__main__':
    main()
