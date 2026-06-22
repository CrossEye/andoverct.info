#!/usr/bin/env python3
"""
Build script for civic-report skill.

Generates HTML and PDF versions of a civic/community/municipal analytical
report from a markdown source. The HTML uses a clean, professional layout
driven by CSS custom properties (a "theme"). The default theme is "bluegold",
matching the andoverct.info reports: cool blue-gray paper, a navy banner with
a gold underline, navy serif display headings over a sans body, gold accent
rules, blue links, and green confirmation checkmarks, with right-aligned
numeric tables and hover-reveal anchor links. A theme is just the block of
:root custom properties at the top of SHARED_CSS; to retheme, override only
the variables you want to change. The PDF is generated from the same HTML via
WeasyPrint with print-specific CSS.

To use:
1. Copy this file into the report folder.
2. Edit the REPORT METADATA block below.
3. Run: python3 build.py
"""

import re
import sys
from pathlib import Path

import markdown
from weasyprint import HTML, CSS

# ============================================================================
# REPORT METADATA — EDIT PER REPORT
# ============================================================================

# File paths (relative to this script's location)
MD_FILENAME   = "report.md"
HTML_FILENAME = "index.html"
PDF_FILENAME  = "report.pdf"

# The public web URL where this report folder lives. MUST end with /.
# Used as WeasyPrint base_url so PDF link annotations resolve to web URLs
# rather than file:// paths on the build machine.
PUBLIC_URL = "http://andoverct.info/reports/55th/weir-position/"

# Page title (browser tab) — usually "Title — Subtitle" form
PAGE_TITLE = "Where Weir Sits in the House — CT 55th House District"

# H1 displayed at the top of the rendered report
REPORT_TITLE = "Where Weir Sits in the House"

# Subtitle line beneath the H1 — separators are middle-dots (·)
REPORT_SUBTITLE = "Connecticut's 55th House District · Voting record 2023–2026 · Where Rep. Steve Weir falls on the ideological spectrum of the House, and how the 55th's lean compares"

# Attribution line beneath the subtitle (raw HTML allowed for the email link)
REPORT_ATTRIBUTION = (
    'A personal report by Scott Sauyet · '
    '<a href="mailto:scott@sauyet.com">scott@sauyet.com</a> · '
    'Not an official town document'
)

# Banner shown at top of HTML view (above the title block)
BANNER_LEFT  = '<span class="crumbs"><a href="http://andoverct.info/">Home</a><span class="sep">&rsaquo;</span><a href="http://andoverct.info/reports/">Reports</a><span class="sep">&rsaquo;</span><a href="http://andoverct.info/reports/55th/">55th District</a><span class="sep">&rsaquo;</span><span class="current">Where Weir Sits</span></span>'
BANNER_RIGHT = ""

# Footer shown at bottom of HTML view (below the report content)
FOOTER_HTML = (
    'Personal work of <a href="mailto:scott@sauyet.com">Scott Sauyet</a> · '
    'Compiled June 11, 2026<br>'
    'Data from the Connecticut General Assembly, the Connecticut Secretary of the State, and U.S. Census geography. Not an official town document.'
)

# Footer URL shown at the bottom of every PDF page (no http:// prefix)
PDF_PAGE_FOOTER = "andoverct.info/reports/55th/weir-position/"

# Author/attribution shown at the bottom-LEFT of every PDF page
# (sibling of the page-number "Page N of M" in the bottom-center).
# Keep short — about 50 characters max.
PDF_PAGE_AUTHOR = "Personal work of Scott Sauyet · scott@sauyet.com"

# Section labels for H2 headings — each H2 in the markdown gets a small
# uppercase label rendered above it. Substring matches against the
# lowercased H2 text. Order matters: more-specific keys first.
# Set value to "" (empty string) to suppress the label for that H2.
SECTION_LABELS = [
    ("overview",                       "Introduction"),
    ("note on methodology",            "Methodology"),
    ("part 1",                         "Background"),
    ("part 2",                         "Findings"),
    ("part 3",                         "Analysis"),
    ("summary table",                  "At a glance"),
    ("key observations",               "Analysis"),
    ("what this report does not show", "Caveats"),
    ("sources",                        "Documentation"),
    ("data and methods",               "Reproducibility"),
    ("methodology notes",              "Technical notes"),
    ("other formats",                  "Download"),
]

# Other Formats card list. Use 3 cards for HTML/Markdown/PDF, 4 if there's
# a data file (e.g., Excel workbook). Each card is a dict with
# icon (emoji), title, href (relative URL), and desc (one sentence).
OTHER_FORMATS_CARDS = [
    {"icon": "🌐", "title": "HTML",     "href": "./",
     "desc": "Interactive version with formatted tables; best for on-screen reading and sharing."},
    {"icon": "📄", "title": "Markdown", "href": MD_FILENAME,
     "desc": "Plain-text version; readable in any editor, ideal for copying into other documents."},
]

# ============================================================================
# Derived paths (don't edit — derived from filenames above)
# ============================================================================

HERE = Path(__file__).resolve().parent
MD_PATH   = HERE / MD_FILENAME
HTML_PATH = HERE / HTML_FILENAME
PDF_PATH  = HERE / PDF_FILENAME


# ----------------------------------------------------------------------------
# Markdown → HTML body
# ----------------------------------------------------------------------------
def markdown_to_body(md_text: str) -> str:
    """Convert markdown to HTML body (no <html> wrapper). Tables, fenced code,
    smart typography, and footnotes all enabled."""
    md = markdown.Markdown(
        extensions=[
            "tables",
            "fenced_code",
            "footnotes",
            "smarty",
            "attr_list",
            "md_in_html",
            "sane_lists",
        ]
    )
    return md.convert(md_text)


# ----------------------------------------------------------------------------
# Extract title, methodology header, and main content from the rendered HTML
# ----------------------------------------------------------------------------
def split_report(html_body: str) -> tuple[str, str, str]:
    """Pull the H1 title and the italicized methodology header off the top of
    the rendered HTML, returning (title, header_paragraph, rest).

    If multiple italicized paragraphs appear at the top, the methodology header
    is the longest one — short italic lines (like personal-attribution lines)
    are skipped and removed from the output, since the HTML/PDF templates add
    their own attribution treatment elsewhere."""
    # Title is the first <h1>
    h1_match = re.search(r"<h1>(.*?)</h1>", html_body, re.DOTALL)
    title = h1_match.group(1).strip() if h1_match else "Report"

    # Find italicized paragraphs at the top of the document (consecutive,
    # separated only by whitespace). Pick the longest one as the methodology
    # header; everything else gets discarded.
    rest_after_h1 = html_body[h1_match.end():] if h1_match else html_body
    leading_em_pattern = re.compile(
        r'^\s*(?:<p><em>(.*?)</em></p>\s*)+',
        re.DOTALL,
    )
    block_match = leading_em_pattern.match(rest_after_h1)
    if block_match:
        # Find every <p><em>...</em></p> in the leading block and pick the
        # longest one as the methodology header.
        all_em = re.findall(
            r"<p><em>(.*?)</em></p>", block_match.group(0), re.DOTALL
        )
        header_html = max(all_em, key=len).strip() if all_em else ""
        rest = rest_after_h1[block_match.end():]
    else:
        header_html = ""
        rest = rest_after_h1

    return title, header_html, rest


# ----------------------------------------------------------------------------
# CSS — shared between HTML and PDF, with print-specific overrides
# ----------------------------------------------------------------------------
SHARED_CSS = r"""
/* Default civic-report theme.
 *
 * A theme is just this set of CSS custom properties. To experiment, copy this
 * file to _build/themes/<name>.css, change what you like, and point at it from
 * _build/report.config.json ({"theme":"<name>"}) for all reports, or from a
 * single report's front matter (theme: <name>). A non-default theme is layered
 * ON TOP of this one, so it only needs to list the variables it changes.
 *
 * Scope: colors, fonts, and small size/width/gap tweaks — not layout changes.
 */
:root {
  /* ---- Palette ---- */
  --bg:             #fafaf7;   /* page background */
  --bg-page:        #ffffff;   /* the white content card */
  --bg-soft:        #f5f3ed;   /* callouts, table headers, inline code */
  --ink:            #1a1a1a;   /* body text, main headings */
  --ink-soft:       #333333;   /* blockquote / methodology text */
  --ink-mute:       #5a5a5a;   /* subtitle, card descriptions */
  --ink-faint:      #888888;   /* attribution, footer, captions */
  --rule:           #e0ddd5;   /* hairline borders */
  --accent:         #b8a878;   /* gold accent rules */
  --accent-2:       #2c3e50;   /* slate: h3, table-header & code text */
  --banner-bg:      #2c3e50;   /* top banner background */
  --banner-ink:     #ecf0f1;   /* top banner text */
  --crumb-link:       #b9c4cf; /* breadcrumb links in the banner */
  --crumb-link-hover: #ffffff;
  --crumb-current:    #ffffff; /* deepest crumb (current page), not a link */
  --link:           #1a5490;
  --link-hover:     #0d3a6b;
  --link-underline: #c5d3e2;
  --anchor:         #b8b3a4;   /* the ¶ header anchor */
  --anchor-hover:   #6c7480;
  --confirm:        #5a8a5a;   /* green ✓ confirmation mark */
  --confirm-strong: #2e7d32;

  /* ---- Fonts ---- */
  --font-serif: Georgia, "Times New Roman", serif;
  --font-sans:  -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  --font-mono:  "SF Mono", Monaco, Menlo, Consolas, monospace;

  /* ---- Sizes (small tweaks only; no layout restructuring) ---- */
  --base-size:  11pt;    /* body text */
  --measure:    780px;   /* content column width */
  --gutter:     30px;    /* horizontal padding / banner & footer gaps */
  --title-size: 28pt;
  --h2-size:    18pt;
  --h3-size:    13pt;
}

/* bluegold — mirrors the light-mode look of the 55th campaign site
 * (C:\Users\scott\Dev\Andover\55th, e.g. localhost:8080/reports): cool
 * blue-gray paper, a dark navy banner with a gold underline, navy serif
 * headings over a sans body, gold accent rules, and blue links.
 *
 * Note the deliberate font swap: base.css uses --font-serif for body text and
 * --font-sans for headings/labels, so to match the campaign look (sans body,
 * serif display) we put the SANS stack in --font-serif and the SERIF stack in
 * --font-sans.
 *
 * Layered on default.css. Uses --banner-border (in base.css) for the gold rule
 * under the banner. */
:root {
  /* Palette */
  --bg:             #f4f6f9;
  --bg-page:        #ffffff;
  --bg-soft:        #eef4fb;   /* blue-050 tint for callouts / table headers */
  --rule:           #e3e8ef;   /* hairlines */
  --ink:            #19222e;
  --ink-soft:       #2b3744;
  --ink-mute:       #5b6775;
  --ink-faint:      #8a94a1;
  --accent:         #e8a800;   /* signature gold rules */
  --accent-2:       #0f2a4a;   /* blue-900: headings, table-header & code text */
  --banner-bg:      linear-gradient(180deg, #0f2a4a, #143862);
  --banner-border:  3px solid #e8a800;
  --banner-ink:     #dde8f5;   /* blue-100 */
  --crumb-link:       #e8a800; /* gold breadcrumb links */
  --crumb-link-hover: #ffffff; /* hover to white + underline */
  --crumb-current:    #ffffff; /* current page, not a link */
  --link:           #245c95;   /* blue-600 */
  --link-hover:     #1c4e80;   /* blue-700 */
  --link-underline: #cfe0f2;
  --confirm:        #2f8f5b;
  --confirm-strong: #1f7d49;

  /* Type: sans body + serif display headings (see note above) */
  --font-serif: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-sans:  Georgia, "Times New Roman", serif;

  --measure: 860px;
}

/* Structural base styles for civic reports — theme-independent.
 * Colors, fonts, and sizes come from the active theme (CSS custom properties
 * in _build/themes/<name>.css), which is loaded BEFORE this file. */

/* ---- Reset & base ---- */
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
    font-family: var(--font-serif);
    font-size: var(--base-size);
    line-height: 1.55;
    color: var(--ink);
    background: var(--bg);
    margin: 0;
    padding: 0;
}

/* ---- Layout ---- */
.page-banner {
    background: var(--banner-bg);
    color: var(--banner-ink);
    border-bottom: var(--banner-border, none);
    padding: 14px 0;
    font-family: var(--font-sans);
    font-size: 9.5pt;
    letter-spacing: 0.04em;
}
.page-banner-inner {
    max-width: var(--measure);
    margin: 0 auto;
    padding: 0 var(--gutter);
}
.page-banner a { color: inherit; text-decoration: none; }
.page-banner a:hover { text-decoration: underline; }

/* ---- Breadcrumb (in the banner) ---- */
.page-banner .crumbs a {
    color: var(--crumb-link, var(--banner-ink));
    border-bottom: none;
}
.page-banner .crumbs a:hover {
    color: var(--crumb-link-hover, #fff);
    text-decoration: underline;
}
.page-banner .crumbs .sep {
    color: var(--banner-ink);
    opacity: 0.5;
    margin: 0 0.45em;
}
.page-banner .crumbs .current {
    color: var(--crumb-current, #fff);
}

.container {
    max-width: var(--measure);
    margin: 0 auto;
    padding: 40px var(--gutter) 60px;
    background: var(--bg-page);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.04);
}

/* ---- Title block ---- */
.report-title {
    font-family: var(--font-sans);
    font-size: var(--title-size);
    font-weight: 700;
    line-height: 1.15;
    margin: 0 0 8px 0;
    color: var(--ink);
    letter-spacing: -0.01em;
}
.report-subtitle {
    font-family: var(--font-sans);
    font-size: 13pt;
    color: var(--ink-mute);
    margin: 0 0 8px 0;
    font-weight: 400;
}
.report-attribution {
    font-family: var(--font-sans);
    font-size: 9.5pt;
    color: var(--ink-faint);
    margin: 0 0 24px 0;
    font-weight: 400;
    letter-spacing: 0.01em;
}
.report-attribution a {
    color: var(--ink-faint);
    border-bottom: 1px solid var(--rule);
}
.report-attribution a:hover {
    color: var(--link);
    border-bottom-color: var(--link);
}
.report-header-rule {
    border: 0;
    border-top: 2px solid var(--ink);
    margin: 0 0 24px 0;
}
.methodology-header {
    font-style: italic;
    font-size: 10.5pt;
    color: var(--ink-soft);
    background: var(--bg-soft);
    border-left: 3px solid var(--accent);
    padding: 16px 20px;
    margin: 0 0 36px 0;
    line-height: 1.55;
}

/* ---- Section labels (small uppercase tags above h2) ---- */
.section-label {
    font-family: var(--font-sans);
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ink-faint);
    margin: 36px 0 4px 0;
    padding-top: 16px;
    border-top: 1px solid var(--rule);
    page-break-after: avoid;
    break-after: avoid;
}

/* ---- Headings ---- */
h2 {
    font-family: var(--font-sans);
    font-size: var(--h2-size);
    font-weight: 700;
    margin: 0 0 18px 0;
    color: var(--ink);
    line-height: 1.25;
    page-break-after: avoid;
    break-after: avoid;
    position: relative;
    scroll-margin-top: 16px;
}
h3 {
    font-family: var(--font-sans);
    font-size: var(--h3-size);
    font-weight: 600;
    margin: 28px 0 10px 0;
    color: var(--accent-2);
    line-height: 1.3;
    page-break-after: avoid;
    break-after: avoid;
    position: relative;
    scroll-margin-top: 16px;
}

/* ---- Header anchor links (HTML only; hidden in print) ---- */
.header-anchor {
    display: inline-block;
    margin-left: 0.4em;
    padding: 0 0.2em;
    color: var(--anchor);
    text-decoration: none;
    opacity: 0;
    transition: opacity 0.15s ease, color 0.15s ease;
    font-weight: 400;
    font-size: 0.85em;
    vertical-align: baseline;
    cursor: pointer;
    user-select: none;
}
h2:hover .header-anchor,
h3:hover .header-anchor,
.header-anchor:focus {
    opacity: 1;
}
.header-anchor:hover {
    color: var(--anchor-hover);
}
.header-anchor.copied {
    color: var(--confirm-strong);
    opacity: 1;
}
.header-anchor.copied::after {
    content: " copied";
    font-size: 0.85em;
    font-style: italic;
    color: var(--confirm-strong);
}
@media print {
    .header-anchor {
        display: none;
    }
}

/* ---- Body text ---- */
p {
    margin: 0 0 14px 0;
    orphans: 3;
    widows: 3;
}
p.intro-table {
    page-break-after: avoid;
    break-after: avoid;
}
strong { font-weight: 700; color: var(--ink); }
em { font-style: italic; }

/* ---- Links ---- */
a {
    color: var(--link);
    text-decoration: none;
    border-bottom: 1px solid var(--link-underline);
    overflow-wrap: break-word;
}
a:hover {
    color: var(--link-hover);
    border-bottom-color: var(--link-hover);
}

/* ---- Lists ---- */
ul, ol {
    margin: 0 0 14px 0;
    padding-left: 24px;
}
li {
    margin: 0 0 6px 0;
    line-height: 1.55;
}

/* ---- Tables ---- */
table {
    width: 100%;
    border-collapse: collapse;
    margin: 14px 0 22px 0;
    font-size: 10pt;
    page-break-inside: avoid;
    break-inside: avoid;
    page-break-before: avoid;
    break-before: avoid;
}
th, td {
    padding: 8px 10px;
    text-align: left;
    border-bottom: 1px solid var(--rule);
    vertical-align: top;
}
th {
    background: var(--bg-soft);
    font-family: var(--font-sans);
    font-weight: 600;
    font-size: 9.5pt;
    color: var(--accent-2);
    border-bottom: 2px solid var(--accent);
}
tbody tr:hover { background: var(--bg); }

td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

tbody tr:last-child td {
    border-bottom: 2px solid var(--accent);
}

/* ---- Blockquotes (source notes, verbatim quotes) ---- */
blockquote {
    margin: 14px 0 18px 0;
    padding: 14px 20px;
    background: var(--bg-soft);
    border-left: 3px solid var(--accent);
    font-size: 10.5pt;
    color: var(--ink-soft);
    page-break-inside: avoid;
    break-inside: avoid;
}
blockquote p { margin: 0 0 8px 0; }
blockquote p:last-child { margin-bottom: 0; }
blockquote ol, blockquote ul {
    margin: 8px 0;
}

/* ---- HR ---- */
hr {
    border: 0;
    border-top: 1px solid var(--rule);
    margin: 32px 0;
}

/* ---- Inline code ---- */
code {
    font-family: var(--font-mono);
    font-size: 9.5pt;
    background: var(--bg-soft);
    padding: 2px 5px;
    border-radius: 3px;
    color: var(--accent-2);
    overflow-wrap: break-word;
}

/* ---- Other Formats footer ---- */
.formats-section {
    margin-top: 40px;
    padding-top: 24px;
    border-top: 2px solid var(--ink);
}
.format-cards {
    display: grid;
    gap: 12px;
    margin: 18px 0;
    page-break-inside: avoid;
    break-inside: avoid;
}
.format-cards.cols-3 { grid-template-columns: repeat(3, 1fr); }
.format-cards.cols-4 { grid-template-columns: repeat(4, 1fr); }
@media screen and (max-width: 700px) {
    .format-cards.cols-3,
    .format-cards.cols-4 { grid-template-columns: repeat(2, 1fr); }
}
.format-card {
    border: 1px solid var(--rule);
    background: var(--bg);
    padding: 14px;
    text-align: left;
    border-radius: 4px;
    page-break-inside: avoid;
}
.format-card-icon { font-size: 18pt; margin-bottom: 4px; }
.format-card-title {
    font-family: var(--font-sans);
    font-weight: 700;
    font-size: 10.5pt;
    margin-bottom: 4px;
}
.format-card-desc { font-size: 9pt; color: var(--ink-mute); line-height: 1.4; }
.format-card a { display: block; }

/* ---- Footer ---- */
.page-footer {
    max-width: var(--measure);
    margin: 32px auto 60px;
    padding: 24px var(--gutter);
    text-align: center;
    color: var(--ink-faint);
    font-size: 9.5pt;
    font-family: var(--font-sans);
    border-top: 1px solid var(--rule);
}

/* ---- Confirmation glyphs ---- */
h3 .conf-mark {
    color: var(--confirm);
    font-size: 11pt;
    margin-right: 4px;
}

/* ---- Banner link hover (gold against the dark blue banner) ---- */
.page-banner a {
    color: inherit;
    text-decoration: none;
    border-bottom: none;
}
.page-banner a:hover {
    color: #f0d68a;
    text-decoration: underline;
    text-decoration-color: #f0d68a;
    border-bottom: none;
}

/* ---- Bill references: subtle hover-only links to the CT General Assembly
   bill-status page. Default state matches surrounding prose; hover reveals a
   dotted underline. ---- */
a.bill-ref {
    color: inherit;
    text-decoration: none;
    border-bottom: none;
    cursor: pointer;
}
a.bill-ref:hover {
    color: #1d4e89;
    border-bottom: 1px dotted #1d4e89;
}

/* In print, suppress the automatic "(url)" annotation after bill links so the
   dense vote tables stay readable. */
@media print {
    a.bill-ref::after { content: ""; }
}
"""

PRINT_CSS = """
@page {
    size: Letter;
    margin: 0.75in 0.75in 0.95in 0.75in;

    @bottom-left {
        content: "__PDF_PAGE_AUTHOR__";
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        font-size: 8pt;
        color: #888;
    }
    @bottom-center {
        content: "Page " counter(page) " of " counter(pages);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        font-size: 8.5pt;
        color: #888;
    }
    @bottom-right {
        content: "__PDF_PAGE_FOOTER__";
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        font-size: 8pt;
        color: #aaa;
    }
}
@page :first {
    @bottom-left { content: ""; }
    @bottom-center { content: ""; }
    @bottom-right { content: ""; }
}

@media print {
    body { background: #fff; font-size: 10.5pt; }
    .page-banner, .page-footer { display: none; }
    .container {
        max-width: none;
        padding: 0;
        margin: 0;
        box-shadow: none;
    }
    a { color: #1a5490; border-bottom: none; }
    /* Print URLs after links to external sites only (skip internal hash/fragment refs) */
    a[href^="http"]::after {
        content: " (" attr(href) ")";
        font-size: 8.5pt;
        color: #888;
        word-break: break-all;
    }
    /* Don't print URL after links inside the formats footer (it's redundant) */
    .format-cards a::after { content: ""; }

    /* Avoid awkward breaks */
    h2, h3 { page-break-after: avoid; break-after: avoid; }
    table, blockquote { page-break-inside: avoid; break-inside: avoid; }

    /* Don't force page breaks on Parts; let the text flow naturally. The
       page-break-inside:avoid rules on tables and blockquotes will keep
       those elements intact, and the orphans/widows settings will minimize
       awkward column breaks. */

    /* Tighten table fonts on print so wide tables fit */
    table { font-size: 9.5pt; }
    th, td { padding: 6px 8px; }
}
"""


# ----------------------------------------------------------------------------
# Post-processing: add section labels above each h2, mark numeric columns,
# enhance the Other Formats section with cards
# ----------------------------------------------------------------------------
def section_label_for(heading_text: str) -> str:
    """Map an h2 heading to a small uppercase section label by looking up
    the heading text in SECTION_LABELS (defined in metadata block).
    Returns empty string for headings that should not get a label."""
    h = heading_text.lower()
    for substring, label in SECTION_LABELS:
        if substring in h:
            return label
    return ""


def add_section_labels(html_body: str) -> str:
    """Insert <p class='section-label'>...</p> before each <h2>."""
    def repl(m):
        heading = m.group(1)
        label = section_label_for(heading)
        h2 = f"<h2>{heading}</h2>"
        if label:
            return f'<p class="section-label">{label}</p>\n{h2}'
        return h2

    return re.sub(r"<h2>(.*?)</h2>", repl, html_body, flags=re.DOTALL)


def add_part_break_class(html_body: str) -> str:
    """Mark the section label preceding each Part heading as a page-break
    anchor, so the label and the h2 stay together on the new page."""
    # Find every section-label paragraph that immediately precedes an h2
    # whose heading text starts with "Part N".
    pattern = re.compile(
        r'(<p class="section-label">[^<]*</p>)\s*(<h2>(\s*Part\s+\d[^<]*)</h2>)',
        re.DOTALL,
    )

    def repl(m):
        label = m.group(1).replace(
            'class="section-label"',
            'class="section-label before-part"',
        )
        return f"{label}\n{m.group(2)}"

    return pattern.sub(repl, html_body)


def slugify(text: str) -> str:
    """Convert heading text to a URL-safe fragment ID.

    Steps: decode HTML entities, strip inline HTML tags, drop trailing
    confirmation markers (the ✓ symbol and any italicised "Confirmed..."
    annotation that follows), lowercase, replace non-alphanumeric runs with
    hyphens, and trim leading/trailing hyphens. The result matches the
    convention used by GitHub and most static site generators."""
    import html as _html
    # Decode HTML entities (&rsquo; -> ', &amp; -> &, etc.)
    text = _html.unescape(text)
    # Strip HTML tags
    text = re.sub(r"<[^>]+>", "", text)
    # Trim trailing confirmation markers: anything from ✓ or "Confirmed" onward
    text = re.split(r"\s*\u2713\s*|\s+Confirmed\b", text)[0]
    # Lowercase
    text = text.lower()
    # Replace non-alphanumeric (including unicode dashes) runs with single hyphen
    text = re.sub(r"[^a-z0-9]+", "-", text)
    # Trim leading/trailing hyphens
    text = text.strip("-")
    return text


def add_header_anchors(html_body: str) -> str:
    """Add id attributes and hover-anchor links to all h2 and h3 headings.
    Only run for the HTML output, not the PDF (which doesn't need anchors).

    Each heading gets an id derived from its text content, plus a small
    anchor link (¶) that becomes visible on hover. Clicking the anchor
    copies the fragment URL to the clipboard."""
    used_ids = set()

    def make_unique(slug):
        """Ensure id uniqueness by appending -2, -3, etc. on collision."""
        if slug not in used_ids:
            used_ids.add(slug)
            return slug
        i = 2
        while f"{slug}-{i}" in used_ids:
            i += 1
        unique = f"{slug}-{i}"
        used_ids.add(unique)
        return unique

    def repl(m):
        tag = m.group(1)        # 'h2' or 'h3'
        content = m.group(2)    # inner HTML
        slug = slugify(content)
        if not slug:
            return m.group(0)   # empty heading, leave alone
        unique = make_unique(slug)
        anchor = f'<a class="header-anchor" href="#{unique}" aria-label="Link to this section">¶</a>'
        return f'<{tag} id="{unique}">{content}{anchor}</{tag}>'

    return re.sub(r"<(h[23])>(.*?)</\1>", repl, html_body, flags=re.DOTALL)


def keep_intro_with_table(html_body: str) -> str:
    """A paragraph that immediately precedes a table is almost always an
    introduction to that table. Mark such paragraphs so they don't get
    separated from the table by a page break."""
    # <p>...</p> followed by optional whitespace then <table
    pattern = re.compile(
        r'<p>([^<]*(?:<(?!/?p>)[^<]*)*)</p>(\s*)(<table)',
        re.DOTALL,
    )
    return pattern.sub(r'<p class="intro-table">\1</p>\2\3', html_body)


NUM_RE = re.compile(
    # Single number with optional approximate-marker (~), optional sign
    # (ASCII -, Unicode −, +, or open paren for accounting negatives),
    # optional currency ($), then digits, optional decimal, optional close
    # paren or %, optional per-unit suffix.
    r"^\s*~?[\-−\+\(]?\$?[\d,]+(?:\.\d+)?[\)\%]?(?:\s*/\s*\w+)?\s*$"
    # Number followed by a unit word (e.g. "20 students")
    r"|^\s*[\d,]+(?:\.\d+)?[\)\%]?\s*[a-zA-Z]+\s*$"
    # Single number with K/M/% suffix
    r"|^\s*~?[\-−\+\(]?\$?[\d,]+(?:\.\d+)?(?:K|M|%)?\s*$"
    # Range expression with en-dash, em-dash, hyphen, or Unicode minus.
    # Both endpoints are number-shaped; either side may itself be signed.
    r"|^\s*~?[\-−\+\(]?\$?[\d,]+(?:\.\d+)?[\)\%]?\s*[\-–—]\s*~?[\-−\+\(]?\$?[\d,]+(?:\.\d+)?[\)\%]?\s*$"
)


def mark_numeric_cells(html_body: str) -> str:
    """Add class='num' to <td> cells that look purely numeric, so they
    right-align with tabular figures."""
    def cell_repl(m):
        opening = m.group(1)
        content = m.group(2)
        # Strip simple inline formatting to test the underlying text
        text = re.sub(r"<[^>]+>", "", content).strip()
        if NUM_RE.match(text):
            if "class=" in opening:
                return f"<td{opening.replace(opening.strip().split('<td')[1] if '<td' in opening else '', '')} class=\"num\">{content}</td>"
            return f"<td class=\"num\">{content}</td>"
        return m.group(0)

    # Simpler: just match <td>...</td> with no existing class
    def simple_repl(m):
        content = m.group(1)
        text = re.sub(r"<[^>]+>", "", content).strip()
        if NUM_RE.match(text):
            return f'<td class="num">{content}</td>'
        return m.group(0)

    return re.sub(r"<td>(.*?)</td>", simple_repl, html_body, flags=re.DOTALL)


def confirm_marks(html_body: str) -> str:
    """Wrap any \u2713 confirmation marker in h3 headings with a styled span
    so it renders in green in the HTML/PDF output. The markdown source
    contains the actual Unicode character; this function adds the styling."""
    def repl(m):
        head = m.group(1)
        head = re.sub(
            r"\s*\u2713\s*",
            ' <span class="conf-mark">\u2713</span> ',
            head,
        )
        return f"<h3>{head.strip()}</h3>"

    return re.sub(r"<h3>(.*?)</h3>", repl, html_body, flags=re.DOTALL)


def restore_typography(html_body: str) -> str:
    """The markdown source uses ASCII characters (* for multiplication, ~= for
    approximately equal) so the .md file reads cleanly in any viewer. In the
    rendered HTML/PDF, restore the proper Unicode typography for nicer output.

    Note: the smarty extension already handles -- to em-dashes and - in number
    ranges (like FY 2024-25) to en-dashes. This function handles only the math
    symbols that smarty doesn't know about."""
    # Multiplication: $260,000 * 30% -> $260,000 × 30%
    # Match digit/comma/period sequences (with optional $ or %) on either side
    html_body = re.sub(
        r"(\$?[\d,.]+(?:%|/\w+)?)\s+\*\s+(\$?[\d,.]+(?:%|/\w+)?)",
        "\\1 \u00D7 \\2",
        html_body,
    )
    # Approximately-equal: ~= becomes ≈
    html_body = html_body.replace("~=", "\u2248")
    return html_body


def replace_other_formats_section(html_body: str, title: str) -> str:
    """Replace the markdown content in the Other formats section with styled
    cards generated from OTHER_FORMATS_CARDS metadata. Matches case-
    insensitively on 'Other formats' / 'Other Formats'."""
    pattern = re.compile(
        r'(<p class="section-label">[^<]*</p>\s*)?<h2>Other [Ff]ormats</h2>(.*?)(?=<h2|\Z)',
        re.DOTALL,
    )
    m = pattern.search(html_body)
    if not m:
        return html_body

    n = len(OTHER_FORMATS_CARDS)
    cols_class = f"cols-{n}" if n in (3, 4) else ""

    intro_word = {3: "three", 4: "four"}.get(n, str(n))

    cards_html_parts = [
        '\n<p class="section-label">Download</p>',
        '<h2>Other Formats</h2>',
        f'<p>This report is available in {intro_word} formats, all located alongside this page:</p>',
        '',
        f'<div class="format-cards {cols_class}">',
    ]
    for card in OTHER_FORMATS_CARDS:
        cards_html_parts.append(
            '  <div class="format-card">\n'
            f'    <div class="format-card-icon">{card["icon"]}</div>\n'
            f'    <div class="format-card-title"><a href="{card["href"]}">{card["title"]}</a></div>\n'
            f'    <div class="format-card-desc">{card["desc"]}</div>\n'
            '  </div>'
        )
    cards_html_parts.append('</div>\n')
    cards_html = '\n'.join(cards_html_parts)

    return html_body[:m.start()] + cards_html + html_body[m.end():]


# ----------------------------------------------------------------------------
# Build the full HTML document
# ----------------------------------------------------------------------------
def build_html(md_text: str, *, for_pdf: bool = False) -> str:
    body_html = markdown_to_body(md_text)
    title, header_html, rest = split_report(body_html)

    # Strip raw HTML title from rest (the h1 was already stripped by split_report)
    rest = add_section_labels(rest)
    rest = add_part_break_class(rest)
    rest = keep_intro_with_table(rest)
    rest = mark_numeric_cells(rest)
    rest = confirm_marks(rest)
    rest = restore_typography(rest)
    rest = replace_other_formats_section(rest, title)
    # Add header anchors only for HTML; PDFs don't need them
    if not for_pdf:
        rest = add_header_anchors(rest)

    # Inject the configured PDF page footer texts into the print CSS
    print_css = (PRINT_CSS
                 .replace("__PDF_PAGE_FOOTER__", PDF_PAGE_FOOTER)
                 .replace("__PDF_PAGE_AUTHOR__", PDF_PAGE_AUTHOR))

    css = SHARED_CSS + (print_css if for_pdf else "")

    if for_pdf:
        # PDF: no banner, no footer — just the report content
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{PAGE_TITLE}</title>
<style>{css}</style>
</head>
<body>
<div class="container">
<h1 class="report-title">{REPORT_TITLE}</h1>
<p class="report-subtitle">{REPORT_SUBTITLE}</p>
<p class="report-attribution">{REPORT_ATTRIBUTION}</p>
<hr class="report-header-rule">
<p class="methodology-header">{header_html}</p>
{rest}
</div>
</body>
</html>"""
    else:
        # HTML: includes banner and footer
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{PAGE_TITLE}</title>
<style>{css}</style>
</head>
<body>
<div class="page-banner">
  <div class="page-banner-inner">
    <span>{BANNER_LEFT}</span>
    <span>{BANNER_RIGHT}</span>
  </div>
</div>
<div class="container">
<h1 class="report-title">{REPORT_TITLE}</h1>
<p class="report-subtitle">{REPORT_SUBTITLE}</p>
<p class="report-attribution">{REPORT_ATTRIBUTION}</p>
<hr class="report-header-rule">
<p class="methodology-header">{header_html}</p>
{rest}
</div>
<div class="page-footer">
{FOOTER_HTML} ·
<a href="{PUBLIC_URL}">{PDF_PAGE_FOOTER}</a>
</div>
<script>
// Copy section URL to clipboard when a header anchor is clicked.
// The default anchor behavior (navigating to the section) still happens;
// this additionally copies the absolute URL with fragment to the clipboard
// for easy sharing.
document.addEventListener('click', function(e) {{
    const anchor = e.target.closest('.header-anchor');
    if (!anchor) return;
    const heading = anchor.parentElement;
    const id = heading.id;
    if (!id) return;
    const url = window.location.origin + window.location.pathname + '#' + id;
    if (navigator.clipboard && navigator.clipboard.writeText) {{
        navigator.clipboard.writeText(url).then(function() {{
            anchor.classList.add('copied');
            setTimeout(function() {{ anchor.classList.remove('copied'); }}, 1400);
        }}).catch(function() {{
            // Clipboard write failed; navigation still happens via default behavior
        }});
    }}
}});
</script>
</body>
</html>"""


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main():
    md_text = MD_PATH.read_text(encoding="utf-8")

    # HTML version
    html_doc = build_html(md_text, for_pdf=False)
    HTML_PATH.write_text(html_doc, encoding="utf-8")
    print(f"Wrote {HTML_PATH} ({len(html_doc):,} chars)")

    # PDF version. Use the public web URL as base_url so that relative links
    # (e.g., to source PDFs in the same folder) resolve to web URLs in the
    # PDF's link annotations, not file:// paths on the build machine.
    pdf_html = build_html(md_text, for_pdf=True)
    HTML(string=pdf_html, base_url=PUBLIC_URL).write_pdf(str(PDF_PATH))
    pdf_size = PDF_PATH.stat().st_size
    print(f"Wrote {PDF_PATH} ({pdf_size:,} bytes)")


if __name__ == "__main__":
    main()
