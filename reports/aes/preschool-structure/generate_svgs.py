"""Generate the four SVG diagrams that recreate Dr. Bruno's whiteboards
from the May 7, 2026 AES preschool video.

Each diagram is a 2x2 grid of classrooms (A/B/C/D), each shown as a grid of
seats. Seats are color-coded:
  - blue   = Andover resident, general education
  - pink   = Andover resident, high needs (IEP / 504 / B-3 / referral)
  - green  = out-of-town, general education
  - white  = empty seat

Plus a special tuition-revenue overlay variant.

Counts come from the screenshots taken at 3:58, 4:20, 4:40, 6:28, 7:22, 9:31.
"""

import textwrap
from pathlib import Path

OUT = Path("/home/claude/preschool-structure")

# ----------------------------------------------------------------------------
# Palette — chosen to match the video (blue/pink/green) while staying
# print-friendly and adequately accessible.

C_BLUE_FILL  = "#3B82C9"   # Andover resident, gen-ed
C_BLUE_EDGE  = "#1E5A99"

C_PINK_FILL  = "#C03478"   # Andover resident, high needs
C_PINK_EDGE  = "#8B2456"

C_GREEN_FILL = "#5DA34A"   # Out-of-town, gen-ed
C_GREEN_EDGE = "#3F7330"

C_EMPTY_FILL = "#FFFFFF"   # Empty seat
C_EMPTY_EDGE = "#888888"

C_HILITE     = "#F4D35E"   # Yellow tuition-revenue rectangle
C_HILITE_EDGE= "#C9A526"

C_GRID       = "#888888"
C_TEXT       = "#222222"
C_TEXT_MUTED = "#555555"

# ----------------------------------------------------------------------------
# Layout constants

R       = 14            # seat radius
GAP     = 8             # gap between seats
CELL    = R*2 + GAP     # center-to-center spacing of seats

ROOM_W  = 280           # width of one room region
ROOM_H  = 220           # height of one room region
ROOM_PAD_X = 28         # interior left padding for the seat grid
ROOM_PAD_Y = 60         # space at top of room for the label

LEGEND_H = 60           # legend strip below the grid

# ----------------------------------------------------------------------------
# Shape primitives

def seat(cx, cy, color):
    """Render one seat as a filled circle.
    color: 'blue', 'pink', 'green', or 'empty'.
    """
    if color == "blue":
        fill, edge = C_BLUE_FILL, C_BLUE_EDGE
    elif color == "pink":
        fill, edge = C_PINK_FILL, C_PINK_EDGE
    elif color == "green":
        fill, edge = C_GREEN_FILL, C_GREEN_EDGE
    else:
        fill, edge = C_EMPTY_FILL, C_EMPTY_EDGE
    return (
        f'<circle cx="{cx}" cy="{cy}" r="{R}" '
        f'fill="{fill}" stroke="{edge}" stroke-width="1.2"/>'
    )


def room(x0, y0, label, rows, label_extra=""):
    """Render one classroom region.

    rows: list of lists; each inner list is a row of seat-color tokens.
          Tokens may be 'blue', 'pink', 'green', 'empty', or None
          (None = no seat at this position; useful for ragged rows).
    label_extra: optional text rendered to the right of the label
                 (e.g., a year-tag like "26-27").
    """
    parts = []

    # Class label
    parts.append(
        f'<text x="{x0+ROOM_PAD_X}" y="{y0+34}" '
        f'font-family="Helvetica, Arial, sans-serif" font-size="20" '
        f'font-weight="500" fill="{C_TEXT}">{label}</text>'
    )
    if label_extra:
        parts.append(
            f'<text x="{x0+ROOM_W-ROOM_PAD_X}" y="{y0+34}" '
            f'font-family="Helvetica, Arial, sans-serif" font-size="14" '
            f'font-weight="400" fill="{C_TEXT_MUTED}" '
            f'text-anchor="end">{label_extra}</text>'
        )

    # Seats
    for ri, row in enumerate(rows):
        for ci, color in enumerate(row):
            if color is None:
                continue
            cx = x0 + ROOM_PAD_X + R + ci*CELL
            cy = y0 + ROOM_PAD_Y + R + ri*CELL
            parts.append(seat(cx, cy, color))

    return "\n  ".join(parts)


def grid_lines(width, height):
    """Render the cross-shape divider lines that separate the four rooms.
    Assumes the standard LEGEND_H footer."""
    cx = width / 2
    cy = (height - LEGEND_H) / 2
    return (
        f'<line x1="{cx}" y1="20" x2="{cx}" y2="{height-LEGEND_H-20}" '
        f'stroke="{C_GRID}" stroke-width="0.8"/>'
        f'<line x1="20" y1="{cy}" x2="{width-20}" y2="{cy}" '
        f'stroke="{C_GRID}" stroke-width="0.8"/>'
    )


def grid_lines_h(width, height, ch, footer_h=80):
    """Variant that takes an explicit horizontal divider y (ch) and
    footer height — used when the diagram has a non-standard legend."""
    cx = width / 2
    return (
        f'<line x1="{cx}" y1="20" x2="{cx}" y2="{height-footer_h-20}" '
        f'stroke="{C_GRID}" stroke-width="0.8"/>'
        f'<line x1="20" y1="{ch}" x2="{width-20}" y2="{ch}" '
        f'stroke="{C_GRID}" stroke-width="0.8"/>'
    )


def legend(x0, y0, items, gap_after=20):
    """Render an inline legend.

    items: list of (color, label) tuples.
    gap_after: horizontal gap between successive (seat, label) entries.
    """
    parts = []
    cursor = x0
    for color, label in items:
        parts.append(seat(cursor + R, y0, color))
        parts.append(
            f'<text x="{cursor + 2*R + 8}" y="{y0+5}" '
            f'font-family="Helvetica, Arial, sans-serif" font-size="13" '
            f'font-weight="400" fill="{C_TEXT}">{label}</text>'
        )
        # advance: seat + 8px gap + text width estimate (7px/char) + gap
        cursor += 2*R + 8 + len(label)*7 + gap_after
    return "\n  ".join(parts)


def svg_wrap(width, height, body, title, desc):
    # No leading whitespace; explicit width/height so that downstream
    # consumers (cairosvg, browsers, WeasyPrint) all render reliably.
    # Inline style intentionally omitted — sizing is handled by the
    # consuming HTML/CSS or by the explicit width/height attributes.
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" role="img" '
        f'preserveAspectRatio="xMidYMid meet">\n'
        f'  <title>{title}</title>\n'
        f'  <desc>{desc}</desc>\n'
        f'  {body}\n'
        f'</svg>\n'
    )


# ----------------------------------------------------------------------------
# Diagram 1: blank base layout (~3:58 in video)

def diagram_blank():
    width, height = 700, 540
    cw, ch = width/2, (height - LEGEND_H)/2

    rooms_html = "\n  ".join([
        room(0,        0,        "Class A", [["empty"]*5, ["empty"]*6, ["empty"]*5]),
        room(cw,       0,        "Class B", [["empty"]*5, ["empty"]*6, ["empty"]*5]),
        room(0,        ch,       "Class C", [["empty"]*6, ["empty"]*6, ["empty"]*5]),
        room(cw,       ch,       "Class D", [["empty"]*6, ["empty"]*6, ["empty"]*6]),
    ])

    body = grid_lines(width, height) + "\n  " + rooms_html
    body += "\n  " + legend(20, height - LEGEND_H/2, [
        ("empty", "Open seat"),
    ])

    return svg_wrap(
        width, height, body,
        title="AES preschool: blank classroom layout",
        desc="Four classrooms (A, B, C, D) shown as grids of empty seats — "
             "the base layout before any students are placed."
    )


# ----------------------------------------------------------------------------
# Diagram 2: current year (25-26), Andover residents only (~4:20)

def diagram_residents_only():
    width, height = 700, 540
    cw, ch = width/2, (height - LEGEND_H)/2

    rooms_html = "\n  ".join([
        # Class A: 15 blue, 1 empty (16 seats total)
        room(0, 0, "Class A", [
            ["blue"]*5,
            ["blue"]*5 + ["empty"],
            ["blue"]*5,
        ]),
        # Class B: 12 blue, 5 empty (17 seats)
        room(cw, 0, "Class B", [
            ["blue"]*4 + ["empty"],
            ["blue"]*4 + ["empty"]*2,
            ["blue"]*4 + ["empty"],
        ]),
        # Class C: 16 blue, 1 empty (17 seats)
        room(0, ch, "Class C", [
            ["blue"]*6,
            ["blue"]*5 + ["empty"],
            ["blue"]*5,
        ]),
        # Class D: 14 blue, 4 empty (18 seats)
        room(cw, ch, "Class D", [
            ["blue"]*4 + ["empty"]*2,
            ["blue"]*5 + ["empty"],
            ["blue"]*5 + ["empty"],
        ]),
    ])

    body = grid_lines(width, height) + "\n  " + rooms_html
    body += "\n  " + legend(20, height - LEGEND_H/2, [
        ("blue", "Andover resident"),
        ("empty", "Open seat"),
    ])

    return svg_wrap(
        width, height, body,
        title="AES preschool 2025–26: Andover residents only",
        desc="Andover-resident enrollment across four classrooms. "
             "Class A: 15, Class B: 12, Class C: 16, Class D: 14. "
             "Total of 57 residents — too many to fit in three rooms."
    )


# ----------------------------------------------------------------------------
# Diagram 3: high-needs distribution (~4:40)

def diagram_high_needs():
    width, height = 700, 560
    cw, ch = width/2, (height - LEGEND_H)/2

    rooms_html = "\n  ".join([
        # Class A: 2 pink (in left column), 13 blue, 1 empty
        room(0, 0, "Class A", [
            ["pink"] + ["blue"]*4,
            ["pink"] + ["blue"]*4 + ["empty"],
            ["blue"]*5,
        ]),
        # Class B: 2 pink, 10 blue, 5 empty
        room(cw, 0, "Class B", [
            ["pink"] + ["blue"]*3 + ["empty"],
            ["pink"] + ["blue"]*3 + ["empty"]*2,
            ["blue"]*4 + ["empty"],
        ]),
        # Class C: 3 pink, 13 blue, 1 empty
        room(0, ch, "Class C", [
            ["pink"] + ["blue"]*5,
            ["pink"] + ["blue"]*4 + ["empty"],
            ["pink"] + ["blue"]*4,
        ]),
        # Class D: 2 pink, 12 blue, 4 empty
        room(cw, ch, "Class D", [
            ["pink"] + ["blue"]*3 + ["empty"]*2,
            ["pink"] + ["blue"]*4 + ["empty"],
            ["blue"]*5 + ["empty"],
        ]),
    ])

    body = grid_lines(width, height) + "\n  " + rooms_html
    body += "\n  " + legend(20, height - LEGEND_H/2, [
        ("blue", "Andover resident, gen-ed"),
        ("pink", "Andover resident, high needs"),
        ("empty", "Open seat"),
    ])

    return svg_wrap(
        width, height, body,
        title="AES preschool 2025–26: high-needs distribution",
        desc="Same residents shown with high-needs students (IEP, 504, "
             "Birth-to-Three, referral) marked in pink. "
             "Total of 9 high-needs students distributed across all four "
             "rooms — a legal requirement under federal IDEA Section 619 "
             "and state IEP/504 rules."
    )


# ----------------------------------------------------------------------------
# Diagram 4: full current year with out-of-town + tuition revenue (~7:22)

def diagram_full_with_tuition():
    width, height = 760, 660  # extra height for 2-row legend
    cw, ch = width/2, (height - 80)/2  # legend takes 80px instead of 60

    rooms_html = "\n  ".join([
        # Class A: 2 pink, 13 blue, 0 green, 1 empty (yellow box on the empty)
        room(0, 0, "Class A", [
            ["pink"] + ["blue"]*4,
            ["pink"] + ["blue"]*4 + ["empty"],
            ["blue"]*5,
        ]),
        # Class B: 2 pink, 10 blue, 3 green, 2 empty
        # Green positions: (0,4), (1,4), (2,0)
        room(cw, 0, "Class B", [
            ["pink"] + ["blue"]*3 + ["green"],
            ["pink"] + ["blue"]*3 + ["green"] + ["empty"],
            ["green"] + ["blue"]*3 + ["empty"],
        ]),
        # Class C: 3 pink, 13 blue, 1 green, 1 empty
        # Green at (0,1)
        room(0, ch, "Class C", [
            ["pink"] + ["green"] + ["blue"]*4,
            ["pink"] + ["blue"]*4 + ["empty"],
            ["pink"] + ["blue"]*4,
        ]),
        # Class D: 2 pink, 11 blue, 4 green, 3 empty
        # Greens at (0,1),(0,4),(1,1),(2,1)
        room(cw, ch, "Class D", [
            ["pink"] + ["green"] + ["blue"]*2 + ["green"] + ["empty"],
            ["pink"] + ["green"] + ["blue"]*3 + ["empty"],
            ["blue"] + ["green"] + ["blue"]*3 + ["empty"],
        ]),
    ])

    # Yellow tuition-revenue rectangles, drawn AFTER seats so they overlay.
    # We highlight the green-and-empty zones that represent paying out-of-towners
    # plus seats that could still be filled by them.

    overlays = []

    # Class A: one empty seat at (1, 5), $6,000 potential.
    # Caption goes to the RIGHT of the highlighted seat (room has slack
    # space on the right) to avoid colliding with the blue seat below it.
    ax = 0 + ROOM_PAD_X + R + 5*CELL
    ay = 0 + ROOM_PAD_Y + R + 1*CELL
    overlays.append(
        f'<rect x="{ax-R-4}" y="{ay-R-4}" width="{2*R+8}" height="{2*R+8}" '
        f'rx="4" fill="{C_HILITE}" fill-opacity="0.45" '
        f'stroke="{C_HILITE_EDGE}" stroke-width="1.2"/>'
    )
    overlays.append(
        f'<text x="{ax+R+12}" y="{ay+5}" '
        f'font-family="Helvetica, Arial, sans-serif" font-size="12" '
        f'font-weight="500" fill="{C_TEXT}" text-anchor="start">'
        f'$6,000 tuition</text>'
    )

    # Class B: column of 3 cells (rightmost): (0,4)green (1,4)green (1,5)empty
    # plus (2,4) empty — group them with one big yellow region around col 4-5, rows 0-2
    bx_left = cw + ROOM_PAD_X + R + 4*CELL - R - 4
    by_top  = 0 + ROOM_PAD_Y + R + 0*CELL - R - 4
    # span columns 4..5 = 2 cells wide minus the half-cells already in CELL spacing
    b_w = 2*CELL + 4
    b_h = 3*CELL + 4
    overlays.append(
        f'<rect x="{bx_left}" y="{by_top}" width="{b_w}" height="{b_h}" '
        f'rx="6" fill="{C_HILITE}" fill-opacity="0.4" '
        f'stroke="{C_HILITE_EDGE}" stroke-width="1.2"/>'
    )
    overlays.append(
        f'<text x="{bx_left + b_w/2}" y="{by_top + b_h + 18}" '
        f'font-family="Helvetica, Arial, sans-serif" font-size="12" '
        f'font-weight="500" fill="{C_TEXT}" text-anchor="middle">'
        f'$30,000 tuition (3 enrolled + 2 open)</text>'
    )

    # Class C: green at (0,1), empty at (1,5)
    cx_g = 0 + ROOM_PAD_X + R + 1*CELL
    cy_g = ch + ROOM_PAD_Y + R + 0*CELL
    overlays.append(
        f'<rect x="{cx_g-R-4}" y="{cy_g-R-4}" width="{2*R+8}" height="{2*R+8}" '
        f'rx="4" fill="{C_HILITE}" fill-opacity="0.45" '
        f'stroke="{C_HILITE_EDGE}" stroke-width="1.2"/>'
    )
    cx_e = 0 + ROOM_PAD_X + R + 5*CELL
    cy_e = ch + ROOM_PAD_Y + R + 1*CELL
    overlays.append(
        f'<rect x="{cx_e-R-4}" y="{cy_e-R-4}" width="{2*R+8}" height="{2*R+8}" '
        f'rx="4" fill="{C_HILITE}" fill-opacity="0.45" '
        f'stroke="{C_HILITE_EDGE}" stroke-width="1.2"/>'
    )
    # Caption: place BELOW the bottom seat row of Class C, not on top of it.
    cy_caption = ch + ROOM_PAD_Y + R + 2*CELL + R + 22
    overlays.append(
        f'<text x="{(cx_g+cx_e)/2}" y="{cy_caption}" '
        f'font-family="Helvetica, Arial, sans-serif" font-size="12" '
        f'font-weight="500" fill="{C_TEXT}" text-anchor="middle">'
        f'$12,000 tuition (1 enrolled + 1 open)</text>'
    )

    # Class D: greens at (0,1)(0,4)(1,1)(2,1) + empties at (0,5)(1,5)(2,5)
    # Highlight col 1 rows 0-2 (3 greens stacked), col 4 row 0 (1 lone green),
    # col 5 rows 0-2 (3 empties stacked).
    # Highlight col 1 rows 0..2 (the three greens stacked)
    d1x = cw + ROOM_PAD_X + R + 1*CELL - R - 4
    d1y = ch + ROOM_PAD_Y + R + 0*CELL - R - 4
    d1w = 2*R + 8
    d1h = 3*CELL + 4
    overlays.append(
        f'<rect x="{d1x}" y="{d1y}" width="{d1w}" height="{d1h}" '
        f'rx="4" fill="{C_HILITE}" fill-opacity="0.4" '
        f'stroke="{C_HILITE_EDGE}" stroke-width="1.2"/>'
    )
    # Highlight col 5 rows 0..2 (three empties stacked)
    d2x = cw + ROOM_PAD_X + R + 5*CELL - R - 4
    d2y = ch + ROOM_PAD_Y + R + 0*CELL - R - 4
    d2w = 2*R + 8
    d2h = 3*CELL + 4
    overlays.append(
        f'<rect x="{d2x}" y="{d2y}" width="{d2w}" height="{d2h}" '
        f'rx="4" fill="{C_HILITE}" fill-opacity="0.4" '
        f'stroke="{C_HILITE_EDGE}" stroke-width="1.2"/>'
    )
    # Highlight the lone green at col 4, row 0
    d3x = cw + ROOM_PAD_X + R + 4*CELL - R - 4
    d3y = ch + ROOM_PAD_Y + R + 0*CELL - R - 4
    overlays.append(
        f'<rect x="{d3x}" y="{d3y}" width="{2*R+8}" height="{2*R+8}" '
        f'rx="4" fill="{C_HILITE}" fill-opacity="0.4" '
        f'stroke="{C_HILITE_EDGE}" stroke-width="1.2"/>'
    )
    # Caption below
    overlays.append(
        f'<text x="{cw + ROOM_W/2}" y="{ch + ROOM_PAD_Y + 3*CELL + 22}" '
        f'font-family="Helvetica, Arial, sans-serif" font-size="12" '
        f'font-weight="500" fill="{C_TEXT}" text-anchor="middle">'
        f'$42,000 tuition (4 enrolled + 3 open)</text>'
    )

    body = grid_lines_h(width, height, ch) + "\n  " + rooms_html
    body += "\n  " + "\n  ".join(overlays)
    # Two-row legend so all four entries fit comfortably.
    body += "\n  " + legend(20, height - 56, [
        ("blue", "Andover resident, gen-ed"),
        ("pink", "Andover resident, high needs"),
    ], gap_after=20)
    body += "\n  " + legend(20, height - 24, [
        ("green", "Out-of-town tuition payer"),
        ("empty", "Open seat"),
    ], gap_after=20)

    return svg_wrap(
        width, height, body,
        title="AES preschool 2025–26: full enrollment with tuition revenue",
        desc="The full current-year picture with out-of-town tuition payers "
             "(green) added. Yellow boxes mark seats producing or potentially "
             "producing $6,000-per-year tuition revenue. Eight out-of-town "
             "students currently enrolled (~$48,000 revenue); seven open "
             "seats remain (~$42,000 additional possible)."
    )


# ----------------------------------------------------------------------------
# Diagram 5: next-year (26-27) projection (~9:31)

def diagram_next_year():
    width, height = 700, 540
    cw, ch = width/2, (height - LEGEND_H)/2

    rooms_html = "\n  ".join([
        # Class A: 12 blue, 1 green, 5 empty (uniform 18-seat 3x6 grid)
        room(0, 0, "Class A", [
            ["blue"]*4 + ["green"] + ["empty"],
            ["blue"]*4 + ["empty"]*2,
            ["blue"]*4 + ["empty"]*2,
        ], label_extra="2026–27"),
        # Class B: 12 blue, 1 green, 5 empty
        room(cw, 0, "Class B", [
            ["blue"]*4 + ["empty"]*2,
            ["blue"]*4 + ["empty"]*2,
            ["blue"]*3 + ["green"] + ["empty"]*2,
        ]),
        # Class C: 11 blue, 1 green, 6 empty
        room(0, ch, "Class C", [
            ["blue"]*3 + ["green"] + ["empty"]*2,
            ["blue"]*4 + ["empty"]*2,
            ["blue"]*4 + ["empty"]*2,
        ]),
        # Class D: 11 blue, 1 green, 6 empty
        room(cw, ch, "Class D", [
            ["blue"]*4 + ["empty"]*2,
            ["blue"]*4 + ["empty"]*2,
            ["blue"]*3 + ["green"] + ["empty"]*2,
        ]),
    ])

    body = grid_lines(width, height) + "\n  " + rooms_html
    body += "\n  " + legend(20, height - LEGEND_H/2, [
        ("blue", "Andover resident"),
        ("green", "Out-of-town (returning enrollee)"),
        ("empty", "Open seat"),
    ])

    return svg_wrap(
        width, height, body,
        title="AES preschool 2026–27 (projected): early enrollment snapshot",
        desc="Projected enrollment for 2026–27 as of early May 2026. "
             "46 Andover residents already enrolled, with ~9–11 more "
             "anticipated based on town birth records. 4 out-of-town "
             "returning students invited back. Pink/high-needs students "
             "are not separately marked here to protect identity at "
             "this projection stage."
    )


# ----------------------------------------------------------------------------
# Write all five SVGs.

def main():
    files = {
        "diagram-1-blank.svg":         diagram_blank(),
        "diagram-2-residents-only.svg": diagram_residents_only(),
        "diagram-3-high-needs.svg":    diagram_high_needs(),
        "diagram-4-full-tuition.svg":  diagram_full_with_tuition(),
        "diagram-5-next-year.svg":     diagram_next_year(),
    }
    for name, content in files.items():
        path = OUT / name
        path.write_text(content, encoding="utf-8")
        print(f"wrote {path}  ({len(content)} bytes)")


if __name__ == "__main__":
    main()
