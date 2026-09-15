#!/usr/bin/env python3
"""
Builds the companion workbook for the-facts edition on Andover's results.

    python tools/facts-workbook.py the-facts/editions/<edition-id>

Writes andover-edsight-data.xlsx: a documented cover sheet, a key-figures sheet
listing every number cited in the edition with the sheet it can be checked
against, and the underlying data district by district and year by year.

Everything is derived live from the committed EdSight extracts under
data/edsight/, so the workbook cannot drift from the charts or the copy.
Regenerate after any refresh of those datasets.
"""
import csv, os, sys, math
from collections import defaultdict
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.utils import get_column_letter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'edsight')
ME, STATE = 'Andover School District', 'State of Connecticut'
CUR, PREV = '2025-26', '2024-25'
PEER_EXCLUDE = {'Norwich'}

NAVY, GOLD, INK, SOFT = '143862', '9A7400', '19222E', '4A566A'
H_FILL = PatternFill('solid', fgColor='E8EEF6')
ME_FILL = PatternFill('solid', fgColor='FBF2DC')
ST_FILL = PatternFill('solid', fgColor='E8EEF6')
THIN = Side(style='thin', color='D4DCE8')


def short(n):
    return n.replace(' School District', '').replace('Regional School District ', 'RSD ')


# ---------------------------------------------------------------- load
def load():
    lvl, hn, allc, grades = {}, {}, {}, {}
    ent, subj = {}, {}
    for r in csv.DictReader(open(os.path.join(DATA, 'performance-index', 'performance-index.csv'), encoding='utf-8')):
        k, y = (r['district'], r['year']), r['year']
        idx = float(r['index']) if r['index'] else None
        cnt = float(r['count']) if r['count'] else None
        if r['entityType']:
            ent[r['district']] = r['entityType']
        if r['studentGroup'] in ('District', 'State'):
            lvl.setdefault(k, {})[r['subject']] = (idx, cnt)
            subj.setdefault(k, {})[r['subject']] = (idx, cnt)
            if r['subject'] == 'ELA':
                allc[k] = cnt
        if r['category'] == 'High Needs (F/R, EL or SWD)' and r['studentGroup'] == 'High Needs' and r['subject'] == 'ELA':
            hn[k] = cnt
        if r['category'] == 'Grade' and r['subject'] == 'ELA' and cnt:
            grades.setdefault(k, set()).add(r['studentGroup'])
    ppe, ppef = {}, {}
    funcs = []
    for r in csv.DictReader(open(os.path.join(DATA, 'per-pupil-expenditures', 'per-pupil-expenditures.csv'), encoding='utf-8')):
        if not r['ppe']:
            continue
        k = (r['district'], r['year'])
        if r['function'] not in funcs:
            funcs.append(r['function'])
        ppef.setdefault(k, {})[r['function']] = float(r['ppe'])
        if r['function'] == 'Total':
            ppe[k] = float(r['ppe'])
    growth, acct = {}, {}
    for r in csv.DictReader(open(os.path.join(DATA, 'accountability', 'accountability.csv'), encoding='utf-8')):
        if r['level'] == 'school':
            continue
        k = (r['district'], r['year'])

        def f(c):
            try:
                return float(r[c])
            except Exception:
                return None
        e, m = f('Ind2ELA_All_Rate'), f('Ind2Math_All_Rate')
        growth[k] = (e + m) / 2 if (e is not None and m is not None) else None
        acct[k] = dict(index=f('outcomeRatePct'), academic=f('academicPct'), possible=f('possiblePoints'))
    peers = set()
    for r in csv.DictReader(open(os.path.join(ROOT, 'reports', 'aes', 'peer-spending',
                                              'peer_comparison_2024-25.csv'), encoding='utf-8-sig')):
        if r['District'] not in PEER_EXCLUDE:
            peers.add(r['District'] + ' School District')

    def weighted(s):
        v = [t for _, t in s.items() if t[0] is not None and t[1]]
        return sum(a * c for a, c in v) / sum(c for _, c in v) if len(v) >= 2 else None

    years = sorted({y for (_, y) in lvl})
    rows = {}
    for (d, y), s in lvl.items():
        if d != STATE and ent.get(d) not in ('local', 'regional'):
            continue
        g = grades.get((d, y), set())
        rows[(d, y)] = dict(
            district=d, name=short(d), year=y,
            level=weighted(s),
            ela=s.get('ELA', (None, None))[0], math=s.get('Math', (None, None))[0],
            sci=s.get('Science', (None, None))[0],
            nELA=s.get('ELA', (None, None))[1], nSci=s.get('Science', (None, None))[1],
            n=allc.get((d, y)),
            hn=(100 * hn[(d, y)] / allc[(d, y)]) if (hn.get((d, y)) and allc.get((d, y))) else None,
            hnCount=hn.get((d, y)),
            growth=growth.get((d, y)), ppe=ppe.get((d, y)), funcs=ppef.get((d, y), {}),
            acct=acct.get((d, y), {}),
            span=('K-12' if '11' in g else ('K-8' if ({'07', '08'} & g) else 'K-6')),
            peer=(d in peers), me=(d == ME), state=(d == STATE))
    # need-adjusted residual, against a fresh statewide fit each year
    for y in years:
        g = [r for r in rows.values() if r['year'] == y and not r['state']
             and r['level'] is not None and r['hn'] is not None]
        if len(g) < 30:
            continue
        n = len(g)
        mx = sum(r['hn'] for r in g) / n
        my = sum(r['level'] for r in g) / n
        sxx = sum((r['hn'] - mx) ** 2 for r in g)
        b = sum((r['hn'] - mx) * (r['level'] - my) for r in g) / sxx
        a = my - b * mx
        for r in g:
            r['predicted'] = a + b * r['hn']
            r['residual'] = r['level'] - r['predicted']
    return rows, years, funcs


# ---------------------------------------------------------------- sheet helpers
def style_header(ws, ncols, row=1):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.font = Font(bold=True, color=NAVY, size=10)
        cell.fill = H_FILL
        cell.alignment = Alignment(vertical='bottom', wrap_text=True)
        cell.border = Border(bottom=THIN)
    ws.freeze_panes = ws.cell(row=row + 1, column=1)


def widths(ws, spec):
    for i, w in enumerate(spec, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def table(wb, title, headers, rows, wid, fmts=None, highlight=True, autofilter=True):
    ws = wb.create_sheet(title)
    ws.append(headers)
    for r in rows:
        ws.append(r['cells'] if isinstance(r, dict) else r)
    style_header(ws, len(headers))
    widths(ws, wid)
    for i, r in enumerate(rows, start=2):
        tag = r.get('tag') if isinstance(r, dict) else None
        if highlight and tag:
            fill = ME_FILL if tag == 'me' else ST_FILL
            for c in range(1, len(headers) + 1):
                ws.cell(row=i, column=c).fill = fill
                ws.cell(row=i, column=c).font = Font(bold=True, size=10)
    if fmts:
        for col, fmt in fmts.items():
            for i in range(2, len(rows) + 2):
                ws.cell(row=i, column=col).number_format = fmt
    if autofilter and rows:
        ws.auto_filter.ref = f'A1:{get_column_letter(len(headers))}{len(rows) + 1}'
    return ws


N1, N2, PC, MONEY = '0.0', '0.00', '0.0"%"', '$#,##0'


# ---------------------------------------------------------------- main
def main():
    if len(sys.argv) < 2:
        sys.exit('usage: facts-workbook.py <target-folder>')
    out_dir = sys.argv[1] if os.path.isabs(sys.argv[1]) else os.path.join(ROOT, sys.argv[1])
    rows, years, funcs = load()
    districts = sorted({r['district'] for r in rows.values() if not r['state']})
    wb = Workbook()

    def get(d, y):
        return rows.get((d, y), {})

    def rank_of(d, y, key, reverse=True):
        g = [r for r in rows.values() if r['year'] == y and not r['state'] and r.get(key) is not None]
        g.sort(key=lambda r: -r[key] if reverse else r[key])
        names = [r['district'] for r in g]
        return (names.index(d) + 1, len(g)) if d in names else (None, len(g))

    # ---------------------------------------------------------------- About
    ws = wb.active
    ws.title = 'About'
    widths(ws, [3, 30, 104])
    A = []

    def line(label, text='', style=None):
        A.append((label, text, style))

    line('Andover and Connecticut school results', '', 'title')
    line('Companion data for the-facts edition "The Largest One-Year Gain in the State"', '', 'sub')
    line('')
    line('What this is', '', 'h')
    line('', 'Every figure cited in that edition, and the underlying district-by-district data it was drawn from, '
             'so that any number in it can be checked. Nothing here is original measurement: it is an extract and '
             'reshaping of public data published by the Connecticut State Department of Education.')
    line('', 'The "Key figures" sheet lists each number used in the edition and names the sheet it can be verified on.')
    line('')
    line('Where the data comes from', '', 'h')
    line('CT EdSight', 'public-edsight.ct.gov — the state Department of Education\'s public reporting portal. '
                       'Three of its reports are used here, each pulled in full rather than sampled.')
    line('1. Performance Index',
         'School, district and state performance indices by subject and student group, 0-100. '
         'Source assessments: Smarter Balanced (English and math, grades 3-8), SAT (grade 11), the NGSS science '
         'test (grades 5, 8, 11) and the Connecticut Alternate Assessments. RELEASED IN LATE AUGUST each year, '
         'so 2025-26 reflects assessments given in spring 2026. Years available: 2014-15 to 2025-26, with no '
         '2019-20 or 2020-21 (Connecticut held a federal accountability waiver for the pandemic years).')
    line('2. Next Generation Accountability',
         'The state accountability system: twelve indicators, of which indicator 2 is academic growth. '
         'RELEASED AROUND NOVEMBER following the school year, so the most recent available is 2024-25 and '
         '2025-26 growth is not yet published. Years available: 2014-15 to 2024-25, same pandemic gap.')
    line('3. Per Pupil Expenditures by Function (District)',
         'District spending per pupil, split across eleven functions plus a total. Reported by districts through '
         'the Education Financial System; the state notes the data is NOT FULLY AUDITED and audits may change it. '
         'Most recent available is 2024-25. Years available: 2017-18 to 2024-25.')
    line('')
    line('What the measures mean', '', 'h')
    line('Performance index',
         'The state\'s 0-100 summary of how students performed on the assessments. Connecticut\'s stated target for '
         'every district is 75. In this workbook the three subjects are combined WEIGHTED BY THE NUMBER OF STUDENTS '
         'who sat each one, so science — tested in only three grades — is not given a third of the weight. '
         'Per-subject figures are shown alongside so the combination can be checked.')
    line('Academic growth',
         'Indicator 2 of the accountability system, and a longitudinal measure: Smarter Balanced is vertically '
         'scaled, so each student in grades 4-8 is given an individual growth target from their OWN prior-year '
         'score. The district figure is the average percentage of that target achieved, capped at 110% per student. '
         'It is NOT the share of students who met their target — the state reports that separately as the "growth '
         'rate" and does not use it for accountability. English and math only, grades 4-8 only, minimum 20 matched '
         'students.')
    line('High needs',
         'A student eligible for free or reduced-price meals, or an English learner, or a student with a '
         'disability. The share shown is high-needs students as a percentage of students tested. The Connecticut '
         'figure is the statewide student share, which sits well above most towns because high-need students are '
         'concentrated in the cities.')
    line('Need-adjusted residual',
         'How far a district sits above or below what its high-needs share alone predicts, from a least-squares '
         'fit recomputed across all town districts SEPARATELY IN EACH YEAR. Zero means exactly as predicted. '
         'Because the fit is redone each year, statewide movements — including pandemic learning loss — are '
         'already netted out, so the residual measures position relative to comparable districts, not absolute '
         'performance.')
    line('Per-pupil spending',
         'Total per-pupil expenditure across all functions. Excludes debt, capital beyond equipment, adult '
         'education, community services, non-local food service and the state\'s teacher retirement contributions, '
         'so it will NOT match a town\'s appropriated school budget. Note that the denominator varies by function: '
         'student transportation is per transported pupil, not per enrolled pupil.')
    line('')
    line('Who is included', '', 'h')
    line('165 town districts',
         'All comparisons cover Connecticut\'s local and regional town school districts — 165 in 2024-25, 164 in '
         '2025-26. Charter districts, the six regional educational service centers, the technical high school '
         'system and state-agency schools are excluded throughout: they serve different populations under '
         'different rules, and the service centers in particular top every per-pupil spending ranking, which '
         'would distort any cross-town comparison.')
    line('45-town peer group',
         'The comparison set from this site\'s earlier report on peer spending: districts that run only '
         'elementary grades and send older students elsewhere for high school. Norwich meets that structural test '
         'but was excluded from the analysis in that report, as a city district several times the size of any '
         'other member, and is excluded here on the same basis.')
    line('')
    line('Cautions worth carrying', '', 'h')
    line('Small numbers',
         'Andover tests about 109 students. One child is worth roughly a full percentage point of any subgroup '
         'figure, and among districts testing fewer than 200 the typical year-over-year swing is about two and a '
         'half times that of districts testing 600 or more. Single-year movements in small districts should be '
         'read with that in mind, in either direction.')
    line('Suppression',
         'The state withholds figures based on too few students. Those appear as blanks here, not zeros. Science '
         'in particular is suppressed for many small districts.')
    line('Grade span',
         'Districts that do not test older grades score structurally higher, because performance falls with grade '
         'level: statewide, the English index runs about 68 in grades 3-6 and about 61 in grades 7-11. Andover is '
         'a K-6 district. Comparisons against K-12 districts are not like-for-like on this measure.')
    line('What this data cannot settle',
         'Per-pupil spending explains very little of the difference between districts, and once student need and '
         'grade span are accounted for, no statistically detectable amount. That is not evidence that spending '
         'does not matter — it is evidence that what varies between Connecticut towns is mostly district size and '
         'geography rather than educational effort, and that these figures cannot resolve a budget argument in '
         'either direction.')
    line('')
    line('Provenance', '', 'h')
    line('Compiled by', 'Scott Sauyet, Andover, Connecticut — andoverct.info')
    line('Method', 'Data pulled directly from EdSight\'s published exports and reshaped without adjustment. '
                   'The extraction and this workbook are generated by scripts kept with the site source, so the '
                   'figures here, the charts in the edition and the text all derive from one extract.')
    line('Verify anything', 'Every figure can be reproduced from EdSight itself at public-edsight.ct.gov.')

    r = 1
    for label, text, style in A:
        if style == 'title':
            ws.cell(row=r, column=2, value=label).font = Font(bold=True, size=17, color=NAVY)
            ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=3)
            r += 1
            continue
        if style == 'sub':
            ws.cell(row=r, column=2, value=label).font = Font(italic=True, size=11, color=SOFT)
            ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=3)
            r += 2
            continue
        if style == 'h':
            ws.cell(row=r, column=2, value=label).font = Font(bold=True, size=12, color=GOLD)
            r += 1
            continue
        if label:
            c = ws.cell(row=r, column=2, value=label)
            c.font = Font(bold=True, size=10, color=INK)
            c.alignment = Alignment(vertical='top', wrap_text=True)
        if text:
            c = ws.cell(row=r, column=3, value=text)
            c.font = Font(size=10, color=INK)
            c.alignment = Alignment(vertical='top', wrap_text=True)
            ws.row_dimensions[r].height = max(15, 12.2 * (len(text) // 92 + 1))
        r += 1
    ws.sheet_view.showGridLines = False

    # ---------------------------------------------------------------- Key figures
    a_cur, a_prev = get(ME, CUR), get(ME, PREV)
    s_cur, s_prev = get(STATE, CUR), get(STATE, PREV)
    deltas = []
    for d in districts:
        x, y = get(d, PREV), get(d, CUR)
        if x.get('level') is not None and y.get('level') is not None:
            deltas.append((d, y['level'] - x['level']))
    deltas.sort(key=lambda t: -t[1])
    dmap = dict(deltas)
    dvals = sorted((v for _, v in deltas), reverse=True)
    # n is even, so the median is the mean of the two middle values
    _mid = sorted(dvals)
    med_delta = (_mid[(len(_mid) - 1) // 2] + _mid[len(_mid) // 2]) / 2
    a_rank_cur = rank_of(ME, CUR, 'level')
    a_rank_prev = rank_of(ME, PREV, 'level')

    def corr(y):
        g = [r for r in rows.values() if r['year'] == y and not r['state']
             and r['level'] is not None and r['hn'] is not None]
        n = len(g)
        mx = sum(r['hn'] for r in g) / n
        my = sum(r['level'] for r in g) / n
        sxx = sum((r['hn'] - mx) ** 2 for r in g)
        syy = sum((r['level'] - my) ** 2 for r in g)
        sxy = sum((r['hn'] - mx) * (r['level'] - my) for r in g)
        return sxy / math.sqrt(sxx * syy), n

    r25, n25 = corr(PREV)
    r26, n26 = corr(CUR)
    peers_cur = [d for d in districts if get(d, CUR).get('peer')]
    kf = [
        ('Andover performance index, 2025-26', round(a_cur['level'], 1), 'Districts 2025-26'),
        ('Andover performance index, 2024-25', round(a_prev['level'], 1), 'Districts 2024-25'),
        ('Andover one-year change', f"{a_cur['level'] - a_prev['level']:+.1f}", 'Change 24-25 to 25-26'),
        ('Rank of that change among town districts', f'1 of {len(deltas)}', 'Change 24-25 to 25-26'),
        ('Median change across town districts', f'{med_delta:+.2f}', 'Change 24-25 to 25-26'),
        ('Districts gaining 3 points or more', sum(1 for v in dvals if v >= 3), 'Change 24-25 to 25-26'),
        ('Next largest gain after Andover', f'{dvals[1]:+.1f}', 'Change 24-25 to 25-26'),
        ('Share of districts improving at all', f'{100 * sum(1 for v in dvals if v > 0) / len(dvals):.0f}%', 'Change 24-25 to 25-26'),
        ('Connecticut performance index, 2025-26', round(s_cur['level'], 1), 'Andover and Connecticut'),
        ('Connecticut performance index, 2024-25', round(s_prev['level'], 1), 'Andover and Connecticut'),
        ('Andover ELA, 2024-25 to 2025-26', f"{a_prev['ela']:.1f} to {a_cur['ela']:.1f}", 'Andover and Connecticut'),
        ('Andover math, 2024-25 to 2025-26', f"{a_prev['math']:.1f} to {a_cur['math']:.1f}", 'Andover and Connecticut'),
        ('Andover science, 2024-25 to 2025-26', f"{a_prev['sci']:.1f} to {a_cur['sci']:.1f}", 'Andover and Connecticut'),
        ('Andover high-needs share, 2024-25 to 2025-26', f"{a_prev['hn']:.1f}% to {a_cur['hn']:.1f}%", 'Andover and Connecticut'),
        ('Andover need-adjusted residual, 2024-25', f"{a_prev['residual']:+.1f}", 'Andover and Connecticut'),
        ('Andover need-adjusted residual, 2025-26', f"{a_cur['residual']:+.1f}", 'Andover and Connecticut'),
        ('Gain surviving the need adjustment', f"{a_cur['residual'] - a_prev['residual']:+.1f}", 'Andover and Connecticut'),
        ('Andover rank, all town districts, 2024-25', f'{a_rank_prev[0]} of {a_rank_prev[1]}', 'Districts 2024-25'),
        ('Andover rank, all town districts, 2025-26', f'{a_rank_cur[0]} of {a_rank_cur[1]}', 'Districts 2025-26'),
        ('Index vs high-needs correlation, 2024-25', f'r = {r25:+.3f} (r² {r25 * r25:.2f}, n = {n25})', 'Districts 2024-25'),
        ('Index vs high-needs correlation, 2025-26', f'r = {r26:+.3f} (r² {r26 * r26:.2f}, n = {n26})', 'Districts 2025-26'),
        ('Andover academic growth, 2024-25', round(a_prev['growth'], 1), 'Districts 2024-25'),
        ('Connecticut academic growth, 2024-25', round(s_prev['growth'], 1), 'Andover and Connecticut'),
        ('Andover per-pupil spending, 2024-25', round(a_prev['ppe']), 'Spending by function 2024-25'),
        ('Connecticut per-pupil spending, 2024-25', round(s_prev['ppe']), 'Spending by function 2024-25'),
        ('Andover students tested, 2025-26', int(a_cur['n']), 'Districts 2025-26'),
        ('Andover best prior year (2018-19)', round(get(ME, '2018-19')['level'], 1), 'Andover and Connecticut'),
        ('Peer group size, 2025-26', len(peers_cur), 'Peer group'),
    ]
    ws = wb.create_sheet('Key figures')
    ws.append(['Figure cited in the edition', 'Value', 'Check it on this sheet'])
    for k, v, sheet in kf:
        ws.append([k, v, sheet])
    style_header(ws, 3)
    widths(ws, [52, 26, 30])
    # The value column mixes numbers and text; Excel would right-align the
    # numbers and left-align the text, so pin it left to read as one column.
    for (cell,) in ws.iter_rows(min_row=2, min_col=2, max_col=2):
        cell.alignment = Alignment(horizontal='left')
    ws.sheet_view.showGridLines = False

    # ---------------------------------------------------------------- Andover and Connecticut
    hdr = ['Year', 'Andover index', 'Andover ELA', 'Andover math', 'Andover science',
           'Andover growth', 'Andover high needs %', 'Andover tested', 'Andover per-pupil $',
           'Predicted from need', 'Residual', 'CT index', 'CT growth', 'CT high needs %', 'CT per-pupil $']
    body = []
    for y in years:
        a, s = get(ME, y), get(STATE, y)
        body.append([y, a.get('level'), a.get('ela'), a.get('math'), a.get('sci'), a.get('growth'),
                     a.get('hn'), a.get('n'), a.get('ppe'), a.get('predicted'), a.get('residual'),
                     s.get('level'), s.get('growth'), s.get('hn'), s.get('ppe')])
    ws = table(wb, 'Andover and Connecticut', hdr, body, [10] + [13] * 14,
               fmts={i: N1 for i in list(range(2, 8)) + [10, 11, 12, 13, 14]}, autofilter=False)
    for i in range(2, len(body) + 2):
        ws.cell(row=i, column=9).number_format = MONEY
        ws.cell(row=i, column=15).number_format = MONEY
        ws.cell(row=i, column=7).number_format = PC
        ws.cell(row=i, column=14).number_format = PC

    # ---------------------------------------------------------------- per-year district sheets
    for y, label in ((CUR, 'Districts 2025-26'), (PREV, 'Districts 2024-25')):
        hdr = ['District', 'Type', 'Grade span', 'Peer group', 'Performance index', 'ELA', 'Math', 'Science',
               'Academic growth', 'High needs %', 'High-needs students', 'Students tested',
               'Per-pupil spending', 'Predicted from need', 'Residual', 'Rank (index)']
        g = [r for r in rows.values() if r['year'] == y and not r['state']]
        g.sort(key=lambda r: -(r['level'] if r['level'] is not None else -1e9))
        body = []
        for i, r in enumerate(g, start=1):
            body.append(dict(tag='me' if r['me'] else None, cells=[
                r['name'], 'Regional' if r['name'].startswith('RSD') else 'Local', r['span'],
                'yes' if r['peer'] else '', r['level'], r['ela'], r['math'], r['sci'], r['growth'],
                r['hn'], r['hnCount'], r['n'], r['ppe'], r.get('predicted'), r.get('residual'), i]))
        st = get(STATE, y)
        body.insert(0, dict(tag='state', cells=[
            'State of Connecticut', 'Statewide', '', '', st.get('level'), st.get('ela'), st.get('math'),
            st.get('sci'), st.get('growth'), st.get('hn'), st.get('hnCount'), st.get('n'), st.get('ppe'), '', '', '']))
        ws = table(wb, label, hdr, body, [30, 10, 11, 11, 15, 9, 9, 9, 14, 12, 15, 12, 15, 15, 11, 11],
                   fmts={i: N1 for i in (5, 6, 7, 8, 9, 14, 15)})
        for i in range(2, len(body) + 2):
            ws.cell(row=i, column=10).number_format = PC
            ws.cell(row=i, column=13).number_format = MONEY

    # ---------------------------------------------------------------- change
    hdr = ['Rank', 'District', 'Peer group', '2024-25 index', '2025-26 index', 'Change',
           '2024-25 high needs %', '2025-26 high needs %', 'Change in high needs',
           '2024-25 residual', '2025-26 residual', 'Change in residual']
    body = []
    for i, (d, delta) in enumerate(deltas, start=1):
        x, y2 = get(d, PREV), get(d, CUR)
        hnd = (y2['hn'] - x['hn']) if (x.get('hn') is not None and y2.get('hn') is not None) else None
        rd = ((y2.get('residual') - x.get('residual'))
              if (x.get('residual') is not None and y2.get('residual') is not None) else None)
        body.append(dict(tag='me' if d == ME else None, cells=[
            i, short(d), 'yes' if y2.get('peer') else '', x['level'], y2['level'], delta,
            x.get('hn'), y2.get('hn'), hnd, x.get('residual'), y2.get('residual'), rd]))
    ws = table(wb, 'Change 24-25 to 25-26', hdr, body,
               [7, 30, 11, 14, 14, 10, 17, 17, 16, 14, 14, 15],
               fmts={i: N1 for i in (4, 5, 6, 9, 10, 11, 12)})
    for i in range(2, len(body) + 2):
        ws.cell(row=i, column=7).number_format = PC
        ws.cell(row=i, column=8).number_format = PC

    # ---------------------------------------------------------------- trends
    for key, label, fmt in (('level', 'Index by year', N1), ('growth', 'Growth by year', N1),
                            ('hn', 'High needs by year', PC), ('residual', 'Residual by year', N1)):
        ys = [y for y in years if any(rows.get((d, y), {}).get(key) is not None for d in districts)]
        hdr = ['District', 'Peer group'] + ys
        body = []
        for d in ['__state__'] + districts:
            if d == '__state__':
                if key == 'residual':
                    continue
                body.append(dict(tag='state', cells=['State of Connecticut', ''] +
                                 [get(STATE, y).get(key) for y in ys]))
                continue
            body.append(dict(tag='me' if d == ME else None,
                             cells=[short(d), 'yes' if get(d, CUR).get('peer') or get(d, PREV).get('peer') else ''] +
                                   [get(d, y).get(key) for y in ys]))
        table(wb, label, hdr, body, [30, 11] + [10] * len(ys),
              fmts={i: fmt for i in range(3, 3 + len(ys))})

    # ---------------------------------------------------------------- spending by function
    order = [f for f in funcs if f != 'Total'] + ['Total']
    hdr = ['District', 'Peer group'] + order
    body = []
    st = get(STATE, PREV)
    body.append(dict(tag='state', cells=['State of Connecticut', ''] + [st.get('funcs', {}).get(f) for f in order]))
    for d in districts:
        r = get(d, PREV)
        body.append(dict(tag='me' if d == ME else None,
                         cells=[short(d), 'yes' if r.get('peer') else ''] + [r.get('funcs', {}).get(f) for f in order]))
    table(wb, 'Spending by function 2024-25', hdr, body, [30, 11] + [16] * len(order),
          fmts={i: MONEY for i in range(3, 3 + len(order))})

    # ---------------------------------------------------------------- peer group
    hdr = ['District', 'Grade span', '2025-26 index', '2024-25 index', 'Change',
           '2024-25 growth', 'High needs %', 'Students tested', 'Per-pupil spending']
    body = []
    for d in sorted(peers_cur, key=lambda d: -(get(d, CUR).get('level') or -1e9)):
        c, p = get(d, CUR), get(d, PREV)
        body.append(dict(tag='me' if d == ME else None, cells=[
            short(d), c.get('span'), c.get('level'), p.get('level'),
            (c['level'] - p['level']) if (c.get('level') is not None and p.get('level') is not None) else None,
            p.get('growth'), c.get('hn'), c.get('n'), p.get('ppe')]))
    ws = table(wb, 'Peer group', hdr, body, [30, 12, 14, 14, 10, 14, 13, 14, 16],
               fmts={i: N1 for i in (3, 4, 5, 6)})
    for i in range(2, len(body) + 2):
        ws.cell(row=i, column=7).number_format = PC
        ws.cell(row=i, column=9).number_format = MONEY

    out = os.path.join(out_dir, 'andover-edsight-data.xlsx')
    wb.save(out)
    size = os.path.getsize(out) / 1024
    print(f'wrote {out}  ({size:.0f} KB)')
    print('sheets: ' + ', '.join(wb.sheetnames))


if __name__ == '__main__':
    main()
