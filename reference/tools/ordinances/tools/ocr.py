"""
Stage 1: OCR the scanned ordinance PDF with Tesseract.

Renders every page of ../24_ordinance.pdf at 300 dpi, deskews the pages listed
in DESKEW, and writes Tesseract's plain text and TSV (word positions) for each
page into _work/. convert.py reads the TSV files; the .txt files are only
there for grepping.

Requires Tesseract on this machine (TESSERACT env var overrides the path) and
the Python packages pymupdf, pytesseract and Pillow.
"""
import csv, math, os, statistics
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import fitz, pytesseract
from PIL import Image

HERE = Path(__file__).resolve().parent
PDF = HERE.parent / '24_ordinance.pdf'
WORK = HERE / '_work'
DESKEW = {94}              # PDF pages whose scan is tilted enough to break column detection
DPI = 300
pytesseract.pytesseract.tesseract_cmd = os.environ.get('TESSERACT', r'C:\Program Files\Tesseract-OCR\tesseract.exe')

def skew_angle(tsv):
    """Median slope of the text lines, in degrees, from a rough TSV pass."""
    rows = [r for r in csv.DictReader(tsv.splitlines(), delimiter='\t', quoting=csv.QUOTE_NONE)
            if r['level'] == '5' and r['text'].strip()]
    lines = defaultdict(list)
    for r in rows:
        lines[(r['block_num'], r['par_num'], r['line_num'])].append((int(r['left']), int(r['top']) + int(r['height'])))
    slopes = []
    for ws in lines.values():
        if len(ws) < 6: continue
        xs, ys = [w[0] for w in ws], [w[1] for w in ws]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        den = sum((x - mx) ** 2 for x in xs)
        if den: slopes.append(sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den)
    return math.degrees(math.atan(statistics.median(slopes))) if slopes else 0

def run(i):
    n = i + 1
    tsv_out, txt_out = WORK / 'tsv' / f'p{n:03d}.tsv', WORK / 'ocr' / f'p{n:03d}.txt'
    if tsv_out.exists() and txt_out.exists(): return n, 'cached'
    png = WORK / 'pages' / f'p{n:03d}.png'
    fitz.open(PDF)[i].get_pixmap(dpi=DPI).save(png)
    # Tesseract reads the rendered PNG from disk (RGB). A deskewed page is rotated in
    # grayscale and passed as an image instead; that is what the committed output was
    # built from, and feeding grayscale for every page changes a few readings.
    src, note = str(png), ''
    if n in DESKEW:
        im = Image.open(png).convert('L')
        angle = skew_angle(pytesseract.image_to_data(im, lang='eng', config='--psm 6'))
        src = im.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=255)
        note = f'deskewed {angle:.2f} deg'
    tsv_out.write_text(pytesseract.image_to_data(src, lang='eng', config='--psm 4'), encoding='utf-8')
    txt_out.write_text(pytesseract.image_to_string(src, lang='eng', config='--psm 4'), encoding='utf-8')
    return n, note

if __name__ == '__main__':
    for d in ('pages', 'tsv', 'ocr'): (WORK / d).mkdir(parents=True, exist_ok=True)
    pages = len(fitz.open(PDF))
    with ThreadPoolExecutor(6) as ex:
        for n, note in ex.map(run, range(pages)):
            print(f'page {n:3d} {note}', flush=True)
