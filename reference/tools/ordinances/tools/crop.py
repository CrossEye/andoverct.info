"""
Verification helper: crop the scan around a phrase so a reading can be checked
against the original.

    python crop.py "67|sufficient acts|p67-facts" "9|make inspections|p9-gap|1|4"

Each argument is  printed-page|phrase|name[|lines-above|lines-below].  The
phrase is located through the TSV word positions from ocr.py, and the crop is
written to _work/crops/<name>.png.
"""
import csv, sys
from collections import defaultdict
from pathlib import Path
import fitz

HERE = Path(__file__).resolve().parent
PDF = HERE.parent / '24_ordinance.pdf'
WORK = HERE / '_work'
PRINTED_OFFSET = 5        # printed page N is PDF page N + 5
LINE_PX = 68              # one text line at 300 dpi

def crop(printed, phrase, name, above=1, below=2):
    n = printed + PRINTED_OFFSET
    rows = [r for r in csv.DictReader(open(WORK / 'tsv' / f'p{n:03d}.tsv', encoding='utf-8'), delimiter='\t', quoting=csv.QUOTE_NONE)
            if r['level'] == '5' and r['text'].strip()]
    lines = defaultdict(list)
    for r in rows: lines[(r['block_num'], r['par_num'], r['line_num'])].append(r)
    hits = [ws for ws in lines.values() if phrase.lower() in ' '.join(w['text'] for w in ws).lower()]
    if not hits:
        print('NOT FOUND', printed, phrase); return
    ws = hits[0]
    top = min(int(w['top']) for w in ws); bot = max(int(w['top']) + int(w['height']) for w in ws)
    y0 = max(0, top - above * LINE_PX - 10) * 72 / 300
    y1 = min(3300, bot + below * LINE_PX + 10) * 72 / 300
    (WORK / 'crops').mkdir(parents=True, exist_ok=True)
    fitz.open(PDF)[n - 1].get_pixmap(dpi=110, clip=fitz.Rect(40, y0, 580, y1)).save(WORK / 'crops' / f'{name}.png')
    print('ok', name)

if __name__ == '__main__':
    for spec in sys.argv[1:]:
        p, phrase, name, *rest = spec.split('|')
        crop(int(p), phrase, name, *(int(x) for x in rest))
