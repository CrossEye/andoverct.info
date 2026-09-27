"""
Stage 2: turn the Tesseract TSV output from ocr.py into a structured element
list, then render it as ../24_ordinance.md, .docx and .odt.

Element kinds: title, h1, h2, h3, para, bold, note, code, table, pagemark.
The PATCHES and MERGES tables near the top carry the proofreading corrections
recorded in ../ocr-review-followup-24_ordinance.md; each must match exactly
once, and the build prints a warning if one does not.

Requires python-docx and odfpy.
"""
import csv, json, re, sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = HERE / '_work'
OUT = str(HERE.parent / '24_ordinance')
BASE_LEFT = 255      # px at 300 dpi: left edge of flush body text
UNIT = 150           # px: one indent step (0.5 in)
WRAP_RIGHT = 1900    # a line ending beyond this is "full width"

CODE_RE = re.compile(r'^(\d{2}-\d{2})\b(\s*\S{1,2})?$')
REV_RE = re.compile(r'^\(Rev\b')
MARKER_RE = re.compile(r'^(\(?([A-Za-z]|[ivx]{2,4}|\d{1,2})\s?[.)]|[•\-–])\s*\S')
KEYWORD_RE = re.compile(r'^(Passed|Published|Voted|Approved|Adopted|Ordinance (becomes|to become|passed|revisions?)|Revised|Revisions? (to|passed|of Section)|Becomes effective|Sections? [\d&, and]+ (revised|amended|passed)|Original Resolution|This ordinance shall|The effective date|Effective|Town Meeting vote|Signed at|Amendments? (to|become))\b')
CAPSCOLON_RE = re.compile(r'^[A-Z][A-Z ]{3,}:')
H2_NOCODE = ('REPEAL OF CERTAIN ORDINANCES', 'RIVERSIDE DRIVE TAX ABATEMENT RESOLUTION',
             'TAX ABATEMENT ORDINANCE REWORD', 'TAX ABATEMENT NEW SAMARITAN HOUSING',
             'THE FOLLOWING ORDINANCE THAT WAS ADOPTED', 'AMMENDMENT TO')
H3_LIST = ('ANNUAL TOWN MEETING', 'ABATEMENT SCHEDULE', 'PURPOSE', 'ASSIGNMENT OF STREET NUMBERS',
           'EFFECTIVE DATE', 'INITIAL NUMBERING', 'WORTHY OF NOTE', 'C DEFINITIONS')
H3_RE = re.compile(r'^(SECTION\s*\d+|\d{1,2}\s*[.:)])')
NOJOIN_RE = re.compile(r'^(SECTION|WHEREAS|WHEREFORE|BE IT|IT IS|\d)')

def ordinal(m):
    n = int(m.group(1))
    return m.group(1) + ('th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th'))

FIXES = [(r'\bshail\b', 'shall'), (r'\bshalt\b', 'shall'), (r'\bwiil\b', 'will'), (r'\bAil\b', 'All'),
         (r'^lt\b', 'It'), (r'^lf\b', 'If'), (r'\blt is\b', 'It is'), (r'\btess \$', 'less $'),
         (r'^"(?=[A-Z0-9])', ''), (r'^(\(?[a-z]\)|\d{1,2}\.)(?=[A-Z])', r'\1 '),
         (r'^([A-Z]\.)(?=[A-Z][a-z]{2}|[A-Z]{3})', r'\1 '),
         (r'(\d+)°', ordinal), (r'\b(July|October|January|April|March) 1[%*?]', r'\1 1st'),
         (r'\(([a-zA-Z]) \)', r'(\1)'),
         (r'(\d{4})\.([A-Z])', r'\1. \2'), (r'([a-z])\.([A-Z][a-z])', r'\1. \2'),
         (r'\s+,', ','), (r'\s+\.$', '.'),
         (r'\$500\.00, 4, Members', '$500.00.\n\n4. Members')]

# Proofreading patches, each verified against the scan (printed page in the comment).
# Each regex must match exactly once across the document; the build warns otherwise.
PATCHES = [
    (r'proper proceedings the Circuit Court', 'proper proceedings I the Circuit Court'),      # p4 (the scan really says "I")
    (r'as the case\. may require', 'as the case may require'),                                 # p8
    (r'\bandthe penalty', 'and the penalty'),                                                  # p9
    (r'this-ordinance the provision', 'this ordinance the provision'),                         # p9
    (r'Town of \S Andover', 'Town of Andover'),                                                # p9, p13 stray marks
    (r'windows Shall be not less', 'windows shall be not less'),                               # p11
    (r'reasonable \S hours', 'reasonable hours'),                                              # p12
    (r'Vinick,et al', 'Vinick, et al'),                                                        # p15
    (r'shall be\. appointed', 'shall be appointed'),                                           # p17
    (r'regulation or\. boundary', 'regulation or boundary'),                                   # p17
    (r'\banda copy', 'and a copy'),                                                            # p17
    (r'REFUSE -\S', 'REFUSE –'),                                                               # p20
    (r'ordinance Shall be fined', 'ordinance shall be fined'),                                 # p20
    (r'All moneys 5 equal', 'All moneys equal'),                                               # p21
    (r'by said\. Eastern', 'by said Eastern'),                                                 # p22
    (r'agreement with\. the New Samaritan', 'agreement with the New Samaritan'),               # p23
    (r'\(c Jof the', '(c) of the'),                                                            # p24
    (r'business may\. be located', 'business may be located'),                                 # p32
    (r'BUISSNESS AND\. FOR', 'BUISSNESS AND FOR'),                                             # p32
    (r'\(I\) YARD WASTE', '(l) YARD WASTE'),                                                   # p35
    (r'upon ail persons', 'upon all persons'),                                                 # p40
    (r'\(I\) RECYCLABLES', '(l) RECYCLABLES'),                                                 # p41
    (r'\(0\) RECYCLING BOX', '(o) RECYCLING BOX'),                                             # p41
    (r'1\) The Administrator of the Recycling\. Program', 'l) The Administrator of the Recycling Program'),  # p44
    (r'driver \S of the vehicle', 'driver of the vehicle'),                                    # p44
    (r'contrary, the\. Town', 'contrary, the Town'),                                           # p46
    (r'held in\Saccordance', 'held in accordance'),                                            # p47
    (r'May 17, 1996\.\.', 'May 17, 1996.'),                                                    # p47
    (r'tax relief: program', 'tax relief program'),                                            # p48
    (r'the taxpayer; [“”"]', 'the taxpayer;'),                                                 # p49
    (r'such unpaid: taxes', 'such unpaid taxes'),                                              # p49
    (r'or [‘’]sewer rates', 'or sewer rates'),                                                 # p51
    (r'4, Be served upon the owner', '4. Be served upon the owner'),                           # p79
    (r'9\. State that the penalties', '5. State that the penalties'),                          # p80
    (r'21 days\.after', '21 days after'),                                                      # p56
    (r'in the-ordinary course', 'in the ordinary course'),                                     # p60
    (r'following appointment\. \S$', 'following appointment.'),                                # p62
    (r'serve asa public', 'serve as a public'),                                                # p62
    (r'Code ina speech', 'Code in a speech'),                                                  # p62
    (r'or a _member of', 'or a member of'),                                                    # p64
    (r'^Financial Benefit\. No public', 'I. Financial Benefit. No public'),                    # p64 lost label
    (r'municipal [‘’]ordinance', 'municipal ordinance'),                                       # p65
    (r'certified mail\. within three', 'certified mail within three'),                         # p67
    (r'sufficient acts to constitute', 'sufficient facts to constitute'),                      # p67
    (r'^No complaint may be made under this Code', 'I. No complaint may be made under this Code'),  # p68 lost label
    (r'Town of Andover\. contract', 'Town of Andover contract'),                               # p69
    (r'entirety ina newspaper', 'entirety in a newspaper'),                                    # p72
    (r'section 7- 103', 'section 7-103'),                                                      # p75
    (r'\bdetine, prohibit', 'define, prohibit'),                                               # p77
    (r'Code 117\.2\. 1', 'Code 117.2.1'),                                                      # p78
    (r'[‘’]remedied', 'remedied'),                                                             # p85
    (r'set\. forth', 'set forth'),                                                              # p87
    (r'Penalty\. under this Ordinance', 'Penalty under this Ordinance'),                       # p91
]
# Paragraphs the OCR split in the wrong place: (end of first, start of second, replacement for the seam).
MERGES = [
    ('Section 2 of Public Act.', '90-220.', 'Section 2 of Public Act 90-220.'),                # p45-46
    ('7-148(c)', '(10) for each', '7-148(c)(10) for each'),                                     # p91
    ('12-81 (56) (a) (b)', '(c) of the Connecticut General Statutes, and for passive', '12-81 (56) (a) (b) (c) of the Connecticut General Statutes, and for passive'),  # p24
]

def is_caps(s):
    s = s.strip()
    return len(s) >= 4 and s == s.upper() and re.search(r'[A-Z]{3}', s) is not None

def fix(s):
    for a, b in FIXES:
        s = re.sub(a, b, s)
    return s

JUNK = set('|~_-),.:;\'"!][/\\`')
def clean_words(ws):
    ws = [w for w in ws if not (w['left'] < 180 and len(w['text']) <= 3)]     # punch-hole marks
    ws = [w for w in ws if w['left'] < 2350]                                 # right-edge artifacts
    ws = [w for w in ws if not set(w['text']) <= set('_~|')]                  # stray rules / bars
    while ws and set(ws[-1]['text']) <= JUNK: ws.pop()
    while ws and set(ws[0]['text']) <= JUNK: ws.pop(0)
    return ws

def read_tsv(n):
    return [r for r in csv.DictReader(open(WORK / 'tsv' / f'p{n:03d}.tsv', encoding='utf-8'), delimiter='\t', quoting=csv.QUOTE_NONE)
            if r['level'] == '5' and r['text'].strip()]

def load_page(n):
    lines = defaultdict(list)
    for r in read_tsv(n):
        lines[(int(r['block_num']), int(r['par_num']), int(r['line_num']))].append(
            {'left': int(r['left']), 'top': int(r['top']), 'w': int(r['width']), 'h': int(r['height']), 'text': r['text']})
    out = []
    for key, ws in lines.items():
        ws = clean_words(sorted(ws, key=lambda w: w['left']))
        if not ws: continue
        text = ' '.join(w['text'] for w in ws)
        if (not re.search(r'[A-Za-z0-9]', text) or len(text) == 1 or re.match(r'^\d{1,2}$', text)
                or (min(w['top'] for w in ws) > 2900 and re.match(r'^\d{1,2}\s*\S{1,2}$', text))):
            continue                                                          # junk glyphs, stray page numbers
        out.append({'key': key, 'left': ws[0]['left'], 'right': max(w['left'] + w['w'] for w in ws),
                    'top': min(w['top'] for w in ws), 'text': text})
    out.sort(key=lambda l: (l['top'], l['left']))
    return out

def starts_item(prev, l):
    t = l['text']
    if CODE_RE.match(t) or CODE_RE.match(prev['text']) or REV_RE.match(t) or REV_RE.match(prev['text']):
        return True
    if KEYWORD_RE.match(t) or CAPSCOLON_RE.match(t):
        return True
    # an outline marker starts a new item unless it is just a wrapped "(4) two / (2) means" continuation
    return bool(MARKER_RE.match(t)) and (prev['text'][-1] in '.;:,)' or prev['right'] < 2000)

def paragraphs(lines):
    """Group lines into Tesseract paragraphs, then split at outline markers / keyword lines."""
    paras = defaultdict(list)
    order = []
    for l in lines:
        k = l['key'][:2]
        if k not in paras: order.append(k)
        paras[k].append(l)
    result = []
    for k in order:
        ls = sorted(paras[k], key=lambda l: l['top'])
        cur = []
        for l in ls:
            if cur and starts_item(cur[-1], l):
                result.append(cur); cur = []
            cur.append(l)
        if cur: result.append(cur)
    result.sort(key=lambda p: (p[0]['top'], p[0]['left']))
    return result

def join_lines(ls):
    s = ''
    for l in ls:
        t = l['text'].strip()
        if not s: s = t
        elif s.endswith('-') and (t[0].islower() or t[0].isdigit()): s += t
        else: s += ' ' + t
    return s

def level_of(left):
    return max(0, min(5, int((left - BASE_LEFT + 60) / UNIT)))

def body_elements(pages):
    els = []
    for n in pages:
        els.append({'kind': 'pagemark', 'page': n - 5})
        for p in paragraphs(load_page(n)):
            text = join_lines(p)
            if CODE_RE.match(text):
                els.append({'kind': 'code', 'text': CODE_RE.match(text).group(1)})
            elif REV_RE.match(text):
                els.append({'kind': 'note', 'text': text})
            else:
                els.append({'kind': 'para', 'text': text, 'caps': all(is_caps(l['text']) for l in p),
                            'level': level_of(min(l['left'] for l in p)),
                            'last_right': p[-1]['right'], 'lines': len(p)})
    return els

def merge_breaks(els):
    """Undo spurious paragraph breaks (within and across pages)."""
    out = []
    for e in els:
        prev = next((x for x in reversed(out) if x['kind'] != 'pagemark'), None)
        if (e['kind'] == 'para' and prev and prev['kind'] == 'para' and not e['caps'] and not prev['caps']
                and (prev['text'].endswith('-')
                     or (not MARKER_RE.match(e['text']) and not KEYWORD_RE.match(e['text'])
                         and not NOJOIN_RE.match(e['text']) and not CAPSCOLON_RE.match(e['text'])
                         and (e['text'][0].islower()
                              or prev['text'].endswith(',')
                              or (prev['last_right'] > 2050 and prev['text'][-1] not in '.:;?!”"'))))):
            prev['text'] = join_lines([{'text': prev['text']}, {'text': e['text']}])
            prev['last_right'] = e['last_right']
            continue
        out.append(e)
    return out

def join_wrapped_caps(els):
    """A caps paragraph that wraps into the next caps paragraph (full-width, no terminal punctuation) is one title."""
    out = []
    for e in els:
        prev = out[-1] if out else None
        if (e['kind'] == 'para' and e['caps'] and prev and prev['kind'] == 'para' and prev['caps']
                and prev['last_right'] > WRAP_RIGHT and prev['text'][-1] not in '.:;'
                and not NOJOIN_RE.match(e['text']) and not NOJOIN_RE.match(prev['text'])):
            prev['text'] += ' ' + e['text']; prev['last_right'] = e['last_right']
            continue
        out.append(e)
    return out

def classify(els):
    """Turn caps paragraphs into headings; a caps paragraph directly above a code is that ordinance's title."""
    out = []
    first_title_seen = False
    def next_is_code(i):
        j = i + 1
        while j < len(els) and els[j]['kind'] == 'pagemark': j += 1
        return j < len(els) and els[j]['kind'] == 'code'
    for i, e in enumerate(els):
        if e['kind'] == 'para' and e['caps']:
            t = e['text']
            if next_is_code(i):
                out.append({'kind': 'h2', 'text': t}); first_title_seen = True
            elif not first_title_seen and t.startswith('ORDINANCES BY LAWS'):
                out.append({'kind': 'h1', 'text': t})
            elif t.startswith(H2_NOCODE):
                out.append({'kind': 'h2', 'text': t})
            elif H3_RE.match(t) or t.rstrip(':.').startswith(H3_LIST):
                out.append({'kind': 'h3', 'text': t})
            else:
                out.append({'kind': 'bold', 'text': t, 'level': e['level']})
        else:
            out.append(e)
    return out

def abatement_table(els):
    """The fire-department abatement schedule on printed page 55 is a real table."""
    for i, e in enumerate(els):
        if e['kind'] == 'h3' and e['text'].startswith('ABATEMENT SCHEDULE'):
            j = i + 1
            rows = [['ACTIVE YEARS', 'BASE AMOUNT', 'CERTIFIED FF1/EMT'], ['UNDER 1', '$0', '$0']]
            while j < len(els) and not (els[j]['kind'] == 'para' and els[j]['text'].startswith('Passed')):
                if els[j]['kind'] in ('para', 'bold'):
                    for m in re.finditer(r'(\d+\+?)\s+(\$[\d,]+)\s+(\$[\d,]+)', els[j]['text']):
                        rows.append(list(m.groups()))
                j += 1
            els[i + 1:j] = [{'kind': 'table', 'rows': rows}]
            return els
    return els

def apply_fixes(els):
    out = []
    for e in els:
        if 'text' not in e:
            out.append(e); continue
        e['text'] = fix(e['text'])
        parts = e['text'].split('\n\n')
        out.append(e)
        for p in parts[1:]:                      # a fix may split one paragraph into two
            e['text'] = parts[0]
            out.append({**e, 'text': p})
    return out

def apply_patches(els):
    texts = [e for e in els if 'text' in e]
    for pat, repl in PATCHES:
        rx = re.compile(pat, re.M)
        n = sum(len(rx.findall(e['text'])) for e in texts)
        if n != 1: print(f'WARNING: patch {pat!r} matched {n} times', file=sys.stderr)
        for e in texts: e['text'] = rx.sub(repl, e['text'])
    for end, start, seam in MERGES:
        done = False
        for i in range(len(els) - 1):
            a, b = els[i], els[i + 1]
            if 'text' in a and 'text' in b and a['text'].endswith(end) and b['text'].startswith(start):
                a['text'] = a['text'][:-len(end)] + seam + b['text'][len(start):]
                del els[i + 1]; done = True; break
        if not done: print(f'WARNING: merge {end!r} + {start!r} not found', file=sys.stderr)
    return els

def index_rows():
    """Pages 2-5: Tesseract lines give the entries; page-number tokens attach to the nearest entry vertically."""
    rows = []
    for n in (2, 3, 4, 5):
        words = [{'left': int(r['left']), 'top': int(r['top']), 'w': int(r['width']), 'h': int(r['height']),
                  'text': r['text'], 'key': (r['block_num'], r['par_num'], r['line_num'])} for r in read_tsv(n)]
        nums = sorted([w for w in words if w['left'] >= 1800], key=lambda w: w['left'])
        lines = defaultdict(list)
        for w in words:
            if w['left'] < 1800: lines[w['key']].append(w)
        entries = []
        for ws in lines.values():
            ws = clean_words(sorted(ws, key=lambda w: w['left']))
            if not ws: continue
            cy = sum(w['top'] + w['h'] / 2 for w in ws) / len(ws)
            entries.append({'cy': cy, 'text': ' '.join(w['text'] for w in ws), 'page': []})
        entries.sort(key=lambda e: e['cy'])
        for w in nums:
            near = min(entries, key=lambda e: abs(e['cy'] - (w['top'] + w['h'] / 2)))
            if abs(near['cy'] - (w['top'] + w['h'] / 2)) < 60: near['page'].append(w['text'])
        subject = None
        for e in entries:
            text, page = e['text'], ' '.join(e['page']).translate(str.maketrans('SilO', '5110'))
            if REV_RE.match(text) or text in ('TOWN OF ANDOVER, CONNECTICUT', 'ORDINANCE INDEX', 'PAGE'):
                continue
            if is_caps(text):
                subject = text
                if page: rows.append([subject, '', page])
            else:
                rows.append([subject or '', text, page])
    # page numbers the OCR pass did not pick up at all, read from the scan
    PATCH = {'Regulations for installations connecting with town highways': '3',
             'Connecticut Zoning Enabling Act Adopted': '1'}
    for r in rows:
        if not r[2] and r[1] in PATCH: r[2] = PATCH[r[1]]
    return rows

def build():
    body = body_elements(range(6, 98))
    body = merge_breaks(body)
    body = join_wrapped_caps(body)
    body = classify(body)
    body = abatement_table(body)
    body = apply_fixes(body)
    body = apply_patches(body)
    front = [{'kind': 'title', 'text': 'Town of Andover, Connecticut — Town Ordinances'},
             {'kind': 'para', 'text': 'Passed by Special Town Meeting April 23, 2024. Published Rivereast April 26, 2024. Effective 21 days after publication.', 'level': 0},
             {'kind': 'note', 'text': 'Text recovered by optical character recognition from the scanned Town PDF (24_ordinance.pdf, 97 pages). Spelling and wording follow the scan, including its typographical errors; OCR misreads may remain. Page markers give the printed page number used by the index.'},
             {'kind': 'h1', 'text': 'ORDINANCE INDEX'},
             {'kind': 'table', 'rows': [['Subject', 'Entry', 'Page']] + index_rows()}]
    return front + body

# ---------------------------------------------------------------- renderers

def md_escape(t):
    return t.replace('*', '\\*').replace('_', '\\_')

def render_md(els):
    """Outline items become nested list items (numeric markers as ordered items, others as bullets);
    indented plain paragraphs continue the enclosing item; anything at level 0 closes the list."""
    out = []
    stack = []            # [(level, content_offset)]
    def offset(): return sum(o for _, o in stack)
    def close(): stack.clear()
    def block(s):
        if out and out[-1] != '': out.append('')
        out.append(s)
    for e in els:
        k = e['kind']
        if k == 'title': close(); block(f'# {e["text"]}')
        elif k == 'h1': close(); block(f'# {e["text"]}')
        elif k == 'h2': close(); block(f'## {e["text"]}')
        elif k == 'h3': close(); block(f'### {e["text"]}')
        elif k == 'code': close(); block(f'**{e["text"]}**')
        elif k == 'note': close(); block(f'*{e["text"]}*')
        elif k == 'bold': close(); block(f'**{md_escape(e["text"])}**')
        elif k == 'pagemark':
            if stack: out.append(' ' * offset() + f'<!-- p. {e["page"]} -->')
            else: block(f'<!-- p. {e["page"]} -->')
        elif k == 'table':
            close()
            rows = e['rows']
            block('| ' + ' | '.join(rows[0]) + ' |')
            out.append('|' + '---|' * len(rows[0]))
            out += ['| ' + ' | '.join(md_escape(c) for c in r) + ' |' for r in rows[1:]]
        elif k == 'para':
            t = md_escape(e['text'])
            lvl = e.get('level', 0)
            m = MARKER_RE.match(e['text'])
            if m and (lvl >= 1 or stack or re.match(r'^\d', e['text'])):
                while stack and stack[-1][0] > lvl: stack.pop()
                if stack and stack[-1][0] == lvl: stack.pop()
                ind = ' ' * offset()
                marker = m.group(1)
                if re.match(r'^\d{1,2}\.$', marker):
                    line = ind + t; width = len(marker) + 1
                else:
                    line = ind + '- ' + t; width = 2
                stack.append((lvl, width))
                if out and out[-1] != '' and not out[-1].lstrip().startswith(('- ', '<!--')) and not re.match(r'^\s*\d{1,2}\. ', out[-1]):
                    out.append('')
                out.append(line)
            elif lvl >= 1 and stack:
                while stack and stack[-1][0] > lvl: stack.pop()
                block(' ' * offset() + t)
            else:
                close(); block(t)
    return '\n'.join(out) + '\n'

def render_docx(els, path):
    from docx import Document
    from docx.shared import Pt, Inches, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    doc = Document()
    st = doc.styles['Normal']; st.font.name = 'Calibri'; st.font.size = Pt(11)
    for e in els:
        k = e['kind']
        if k == 'title': doc.add_heading(e['text'], 0)
        elif k in ('h1', 'h2', 'h3'): doc.add_heading(e['text'], int(k[1]))
        elif k == 'code': doc.add_paragraph().add_run(e['text']).bold = True
        elif k == 'note': doc.add_paragraph().add_run(e['text']).italic = True
        elif k == 'bold':
            p = doc.add_paragraph(); p.add_run(e['text']).bold = True
            p.paragraph_format.left_indent = Inches(0.5 * e.get('level', 0))
        elif k == 'pagemark':
            p = doc.add_paragraph(); r = p.add_run(f'p. {e["page"]}')
            r.font.size = Pt(8); r.font.color.rgb = RGBColor(0x88, 0x88, 0x88)
            p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        elif k == 'table':
            rows = e['rows']
            t = doc.add_table(rows=len(rows), cols=len(rows[0])); t.style = 'Table Grid'
            for i, r in enumerate(rows):
                for j, c in enumerate(r):
                    cell = t.cell(i, j); cell.text = ''
                    run = cell.paragraphs[0].add_run(c); run.bold = (i == 0)
            doc.add_paragraph()
        elif k == 'para':
            p = doc.add_paragraph(e['text'])
            p.paragraph_format.left_indent = Inches(0.5 * e.get('level', 0))
    doc.save(path)

def render_odt(els, path):
    from odf.opendocument import OpenDocumentText
    from odf.style import Style, TextProperties, ParagraphProperties
    from odf.text import H, P
    from odf.table import Table, TableColumn, TableRow, TableCell
    doc = OpenDocumentText()
    def pstyle(name, indent=0, bold=False, italic=False, size=None, align=None, color=None):
        s = Style(name=name, family='paragraph')
        pp = {'marginbottom': '0.08in'}
        if indent: pp['marginleft'] = f'{0.5 * indent}in'
        if align: pp['textalign'] = align
        s.addElement(ParagraphProperties(**pp))
        tp = {}
        if bold: tp['fontweight'] = 'bold'
        if italic: tp['fontstyle'] = 'italic'
        if size: tp['fontsize'] = size
        if color: tp['color'] = color
        if tp: s.addElement(TextProperties(**tp))
        doc.automaticstyles.addElement(s)
        return s
    styles = {('para', i): pstyle(f'Ind{i}', i) for i in range(6)}
    styles.update({('bold', i): pstyle(f'Bold{i}', i, bold=True) for i in range(6)})
    s_note = pstyle('Note', italic=True)
    s_mark = pstyle('Mark', size='8pt', align='end', color='#888888')
    s_th = pstyle('TH', bold=True)
    hs = {}
    for lvl, size in ((0, '20pt'), (1, '16pt'), (2, '14pt'), (3, '12pt')):
        s = Style(name=f'H{lvl}', family='paragraph'); s.addElement(TextProperties(fontweight='bold', fontsize=size))
        s.addElement(ParagraphProperties(margintop='0.2in', marginbottom='0.08in'))
        doc.automaticstyles.addElement(s); hs[lvl] = s
    for e in els:
        k = e['kind']
        if k == 'title': doc.text.addElement(H(outlinelevel=1, stylename=hs[0], text=e['text']))
        elif k in ('h1', 'h2', 'h3'): doc.text.addElement(H(outlinelevel=int(k[1]), stylename=hs[int(k[1])], text=e['text']))
        elif k == 'code': doc.text.addElement(P(stylename=styles[('bold', 0)], text=e['text']))
        elif k == 'note': doc.text.addElement(P(stylename=s_note, text=e['text']))
        elif k == 'bold': doc.text.addElement(P(stylename=styles[('bold', e.get('level', 0))], text=e['text']))
        elif k == 'pagemark': doc.text.addElement(P(stylename=s_mark, text=f'p. {e["page"]}'))
        elif k == 'para': doc.text.addElement(P(stylename=styles[('para', e.get('level', 0))], text=e['text']))
        elif k == 'table':
            rows = e['rows']
            t = Table()
            t.addElement(TableColumn(numbercolumnsrepeated=len(rows[0])))
            for i, r in enumerate(rows):
                tr = TableRow()
                for c in r:
                    tc = TableCell(valuetype='string'); tc.addElement(P(stylename=s_th if i == 0 else styles[('para', 0)], text=c)); tr.addElement(tc)
                t.addElement(tr)
            doc.text.addElement(t)
            doc.text.addElement(P(text=''))
    doc.save(path)

if __name__ == '__main__':
    els = build()
    json.dump(els, open(WORK / 'elements.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    open(OUT + '.md', 'w', encoding='utf-8', newline='\n').write(render_md(els))
    render_docx(els, OUT + '.docx')
    render_odt(els, OUT + '.odt')
    from collections import Counter
    print(Counter(e['kind'] for e in els))
