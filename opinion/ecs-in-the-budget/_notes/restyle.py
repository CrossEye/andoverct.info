"""Presentation pass over the ECS-split model workbook.

Reads the clean workbook, then:
  * moves every memo/notes column into keyed footnote rows beneath the block
    the note belongs to (key = block letter + running number, e.g. B2), leaving
    only the key in a narrow Note column;
  * shifts every formula, page break and row height to match the inserted rows;
  * drops the one-sided "Net Local Cost by Entity" block from MillRate;
  * italicises and indents the "less:" / "plus:" labels;
  * fixes clipped header rows, sets US Letter landscape, adds page footers.

Writes stage.xlsx (no cached values); the caller converts it through
LibreOffice to recalculate, then verify.py checks every value against the
original.
"""
import copy
import re
import sys
from collections import OrderedDict

import openpyxl
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.formula import Tokenizer
from openpyxl.styles import Alignment, Font
from openpyxl.worksheet.pagebreak import Break, RowBreak

SRC, OUT = sys.argv[1], sys.argv[2]

wb = openpyxl.load_workbook(SRC, rich_text=True)
B, M, N = wb["Budget"], wb["MillRate"], wb["NetLocal"]

REF_RE = re.compile(r"^(?:(?P<sheet>'[^']+'|[A-Za-z0-9_.]+)!)?(?P<ref>\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)$")
ROW_RE = re.compile(r"(\$?[A-Z]{1,3}\$?)(\d+)")


def is_blank(ws, r, ncols):
    return all(ws.cell(r, c).value in (None, "") for c in range(1, ncols + 1))


# ---------------------------------------------------------------------------
# 1. MillRate: drop the Net Local block (rows 24-31); nothing references it.
# ---------------------------------------------------------------------------
for r in range(24, M.max_row + 1):
    for c in range(1, M.max_column + 1):
        assert not (isinstance(M.cell(r, c).value, str) and M.cell(r, c).value.startswith("=")) or r >= 24
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for cell in row:
            v = cell.value
            if isinstance(v, str) and v.startswith("=") and "MillRate!" in v:
                for m_ in re.finditer(r"MillRate!\$?[A-Z]+\$?(\d+)", v):
                    assert int(m_.group(1)) < 24, (ws.title, cell.coordinate, v)
M.delete_rows(24, M.max_row - 23)
for r in list(M.row_dimensions):
    if r >= 24:
        del M.row_dimensions[r]

# ---------------------------------------------------------------------------
# 2. Collect notes and decide where each block's footnotes go.
#    notes[sheet] = OrderedDict(after_row -> [(row, col, text), ...])
# ---------------------------------------------------------------------------
def budget_block_end(r):
    if 46 <= r <= 64:          # EDUCATION incl. allocation basis: one block
        return 64
    e = r
    while not is_blank(B, e + 1, 8):
        e += 1
    return e


def collect(ws, col, first_row, block_end, ncols, last_row=None):
    out = OrderedDict()
    for r in range(first_row, (last_row or ws.max_row) + 1):
        v = ws.cell(r, col).value
        if v in (None, ""):
            continue
        out.setdefault(block_end(r), []).append((r, col, str(v)))
    return OrderedDict(sorted(out.items()))


def netlocal_block_end(r):
    for s, e in [(4, 13), (15, 26), (30, 38)]:
        if s <= r <= e:
            return e
    raise ValueError(r)


notes = {
    "Budget": collect(B, 9, 5, budget_block_end, 8),
    "MillRate": collect(M, 5, 5, lambda r: 16, 7, last_row=16),
    "NetLocal": collect(N, 4, 4, netlocal_block_end, 3),
}
assert None not in notes["MillRate"]

# Row maps: new(r) = r + number of note rows inserted above r.
def make_map(plan):
    def new(r):
        return r + sum(len(uniq_texts(v)) for k, v in plan.items() if k < r)
    return new


def uniq_texts(entries):
    seen = OrderedDict()
    for _, _, t in entries:
        seen.setdefault(t, True)
    return list(seen)


maps = {name: make_map(plan) for name, plan in notes.items()}

# Rewrite the few notes that quote row numbers, using the final row numbers.
def final_budget_text(r, text):
    nb = maps["Budget"]
    if text.startswith("See allocation basis"):
        return f"See the allocation basis at rows {nb(59)}-{nb(64)}"
    if text.startswith("See EDUCATION section"):
        return f"Allocated to RHAM and AES in the EDUCATION section, rows {nb(48)} and {nb(52)}"
    return text


for k, entries in notes["Budget"].items():
    notes["Budget"][k] = [(r, c, final_budget_text(r, t)) for r, c, t in entries]
for k, entries in notes["NetLocal"].items():
    notes["NetLocal"][k] = [
        (r, c, re.sub(r"\(Budget rows \d+-\d+\)", f"(Budget rows {maps['Budget'](59)}-{maps['Budget'](64)})", t))
        for r, c, t in entries
    ]

# ---------------------------------------------------------------------------
# 3. Shift every formula in every sheet to the post-insertion rows.
# ---------------------------------------------------------------------------
def shift_formula(f, this_sheet):
    tok = Tokenizer(f)
    parts = []
    for t in tok.items:
        if t.type == "OPERAND" and t.subtype == "RANGE":
            m = REF_RE.match(t.value)
            assert m, (this_sheet, f, t.value)
            sheet = (m.group("sheet") or this_sheet).strip("'")
            mp = maps[sheet]
            ref = ROW_RE.sub(lambda g: g.group(1) + str(mp(int(g.group(2)))), m.group("ref"))
            parts.append((m.group("sheet") + "!" if m.group("sheet") else "") + ref)
        else:
            parts.append(t.value)
    return "=" + "".join(parts)


for ws in wb.worksheets:
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and cell.value.startswith("="):
                cell.value = shift_formula(cell.value, ws.title)

# ---------------------------------------------------------------------------
# 4. Insert the footnote rows (bottom-up), remap heights and page breaks.
# ---------------------------------------------------------------------------
NOTE_FONT = Font(name="Arial", size=9, italic=True, color=copy.copy(B["I82"].font.color))
KEY_FONT = Font(name="Arial", size=9, italic=False, color=copy.copy(B["I82"].font.color))
key_cols = {"Budget": 9, "MillRate": 5, "NetLocal": 4}
key_align = {"Budget": "center", "MillRate": "left", "NetLocal": "center"}

for ws in wb.worksheets:
    plan = notes[ws.title]
    new = maps[ws.title]
    heights = {r: d.height for r, d in ws.row_dimensions.items()}
    breaks = [b.id for b in ws.row_breaks.brk]
    inserted = set()
    letters = iter("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    letter_of = {k: next(letters) for k in plan}          # in sheet order
    for after_row in sorted(plan, reverse=True):
        entries = plan[after_row]
        texts = uniq_texts(entries)
        key_of = {t: f"{letter_of[after_row]}{i + 1}" for i, t in enumerate(texts)}
        ws.insert_rows(after_row + 1, len(texts))
        for i, t in enumerate(texts):
            r = after_row + 1 + i
            inserted.add(new(after_row) + 1 + i)
            c = ws.cell(r, 1, f"{key_of[t]}   {t}")
            c.font = copy.copy(NOTE_FONT)
            c.alignment = Alignment(horizontal="left", vertical="center", indent=1, wrap_text=False)
        for r, col, t in entries:          # these rows are above the insertion: unmoved
            cell = ws.cell(r, col, key_of[t])
            cell.font = copy.copy(KEY_FONT)
            cell.alignment = Alignment(horizontal=key_align[ws.title], vertical="center", indent=1 if ws.title == "MillRate" else 0)
    for r in list(ws.row_dimensions):
        del ws.row_dimensions[r]
    for r, h in heights.items():
        if h is not None:
            ws.row_dimensions[new(r)].height = h
    for r in inserted:
        ws.row_dimensions[r].height = 14
    ws.row_breaks = RowBreak()
    for b in breaks:
        ws.row_breaks.append(Break(id=new(b)))

B.print_title_rows = "1:4"

# ---------------------------------------------------------------------------
# 5. "less:" / "plus:" labels: italic lead word, indented.
# ---------------------------------------------------------------------------
LEAD = re.compile(r"^(less|plus):\s*(.*)$", re.I)
for ws in wb.worksheets:
    for r in range(1, ws.max_row + 1):
        cell = ws.cell(r, 1)
        v = cell.value
        if isinstance(v, str) and LEAD.match(v):
            lead, rest = LEAD.match(v).groups()
            f = cell.font
            lead_font = InlineFont(rFont=f.name, sz=f.sz, b=f.b, i=True, color=copy.copy(f.color))
            rest_font = InlineFont(rFont=f.name, sz=f.sz, b=f.b, i=False, color=copy.copy(f.color))
            cell.value = CellRichText(TextBlock(lead_font, f"{lead}:"), TextBlock(rest_font, " " + rest))
            al = copy.copy(cell.alignment)
            cell.alignment = Alignment(horizontal="left", vertical=al.vertical, indent=2, wrap_text=al.wrap_text)

# ---------------------------------------------------------------------------
# 6. Columns, headers, page setup, footers.
# ---------------------------------------------------------------------------
def set_widths(ws, spec):
    for k in list(ws.column_dimensions):
        del ws.column_dimensions[k]
    for col, w in spec.items():
        ws.column_dimensions[col].width = w


set_widths(B, {"A": 42, **{c: 14 for c in "BCDEFG"}, "H": 10, "I": 6})
set_widths(M, {"A": 40, **{c: 15 for c in "BCDEF"}, "G": 13})
set_widths(N, {"A": 46, "B": 18, "C": 18, "D": 6})

B["I4"].value = "Note"
nm = maps["MillRate"]
M.row_dimensions[4].height = 42          # three wrapped lines of 10pt bold
M.row_dimensions[nm(19)].height = 28     # two wrapped lines
M.row_dimensions[nm(20)].height = 15     # stray tall data row
for ws in wb.worksheets:
    ws.row_dimensions[1].height = 18     # 13pt title was clipped at 15.75
for r in (4, nm(19)):
    for c in range(1, 8):
        cell = M.cell(r, c)
        if cell.value not in (None, ""):
            al = cell.alignment
            cell.alignment = Alignment(horizontal=al.horizontal, vertical="center", wrap_text=True)

LABELS = {"Budget": "Budget detail", "MillRate": "Taxation / Mill Rate", "NetLocal": "Net Local Cost"}
for ws in wb.worksheets:
    ws.page_setup.paperSize = ws.PAPERSIZE_LETTER
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.top, ws.page_margins.bottom = 0.6, 0.7
    ws.page_margins.header, ws.page_margins.footer = 0.3, 0.3
    ws.oddFooter.left.text = f'&"Arial"&8Town of Andover · FY 2026-27 budget (6.2.26) · {LABELS[ws.title]}'
    ws.oddFooter.right.text = '&"Arial"&8Page &P of &N'
    ws.oddFooter.center.text = ""

wb.save(OUT)

# Row maps for verify.py
import json
plan_out = {name: {str(k): len(uniq_texts(v)) for k, v in plan.items()} for name, plan in notes.items()}
json.dump(plan_out, open(OUT + ".plan.json", "w"), indent=1)
print("wrote", OUT)
for name, plan in notes.items():
    print(f"  {name}: {sum(len(uniq_texts(v)) for v in plan.values())} note rows in {len(plan)} blocks")
