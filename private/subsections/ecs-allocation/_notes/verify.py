"""Check the restyled, recalculated workbook against the original's cached values.

usage: verify.py original.xlsx final.xlsx plan.json
Every original cell value must reappear at its mapped row, bar the memo columns
that were turned into keys and the deleted MillRate block.
"""
import json
import sys

import openpyxl
from openpyxl.cell.rich_text import CellRichText

orig_path, final_path, plan_path = sys.argv[1:4]
plan = json.load(open(plan_path))

o = openpyxl.load_workbook(orig_path, data_only=True)
f = openpyxl.load_workbook(final_path, data_only=True)
ff = openpyxl.load_workbook(final_path, rich_text=True)


def mapper(name):
    rows = {int(k): n for k, n in plan[name].items()}
    return lambda r: r + sum(n for k, n in rows.items() if k < r)


def skip(name, r, c):
    if name == "Budget" and c == 9:
        return True
    if name == "MillRate" and (r >= 24 or (c == 5 and r <= 16)):
        return True
    if name == "NetLocal" and c == 4:
        return True
    return False


def norm(v):
    if isinstance(v, CellRichText):
        v = str(v)
    if isinstance(v, str):
        return " ".join(v.split())
    return v


bad, checked, errors = [], 0, []
for name in o.sheetnames:
    ows, fws = o[name], f[name]
    new = mapper(name)
    for row in ows.iter_rows():
        for cell in row:
            if cell.value is None or skip(name, cell.row, cell.column):
                continue
            target = fws.cell(new(cell.row), cell.column).value
            a, b = norm(cell.value), norm(target)
            checked += 1
            ok = (abs(a - b) < 1e-6) if isinstance(a, (int, float)) and isinstance(b, (int, float)) else a == b
            if not ok:
                bad.append((name, cell.coordinate, fws.cell(new(cell.row), cell.column).coordinate, a, b))
    for row in fws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and cell.value.startswith("#"):
                errors.append((name, cell.coordinate, cell.value))

print(f"values checked: {checked}, mismatches: {len(bad)}, error cells: {len(errors)}")
for x in bad[:15]:
    print("  MISMATCH", x)
for x in errors[:10]:
    print("  ERROR", x)

# Formula cells that still have no cached value (would print blank)
blank_formulas = 0
for ws in ff.worksheets:
    vws = f[ws.title]
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith("=") and vws[c.coordinate].value is None:
                blank_formulas += 1
print("formula cells without a cached value:", blank_formulas)

for ws in ff.worksheets:
    rich = sum(1 for row in ws.iter_rows() for c in row if isinstance(c.value, CellRichText))
    italic_lead = sum(1 for row in ws.iter_rows() for c in row
                      if isinstance(c.value, CellRichText) and any(getattr(b, "font", None) and b.font.i for b in c.value if hasattr(b, "font")))
    print(f"{ws.title}: paper={ws.page_setup.paperSize} orient={ws.page_setup.orientation} fitW={ws.page_setup.fitToWidth} "
          f"breaks={sorted(b.id for b in ws.row_breaks.brk)} titles={ws.print_title_rows} rich={rich} italicLead={italic_lead}")
    print(f"   footer L={ws.oddFooter.left.text!r} R={ws.oddFooter.right.text!r}")
    print("   widths", [(d.min, d.max, d.width) for k, d in sorted(ws.column_dimensions.items())])
    hs = {r: d.height for r, d in ws.row_dimensions.items() if d.height not in (None, 15.0)}
    print("   non-15 row heights", dict(sorted(hs.items())[:12]), "...")

sys.exit(1 if bad or errors else 0)
