#!/usr/bin/env node
/*
 * Unified civic-report builder.
 *
 * Regenerates index.html and the PDF for a single report from its markdown
 * source. Per-report metadata lives in YAML front matter at the top of the
 * .md file; the shared rendering engine lives here. Replaces the per-folder
 * build.py forks.
 *
 *   npm run report -- reports/aes/peer-spending/andover_peer_spending_report.md
 *   node _build/report.mjs reports/aes/peer-spending/andover_peer_spending_report.md
 *
 * Pipeline: marked (+ smartypants) renders the body; a series of regex-based
 * post-processors match the civic-report look (section labels, column-aware
 * numeric alignment, header anchors, confirmation marks, format cards). The
 * print variant is written to a temp file in the report folder and handed to
 * WeasyPrint (`python -m weasyprint`) so local images resolve and the PDF
 * keeps its paged-media footers.
 *
 * Styling is split into files under _build/: base.css (structural, theme-
 * independent) + themes/<name>.css (CSS custom properties: colors, fonts,
 * sizes). The active theme is resolved as: a report's front-matter `theme:`
 * > report.config.json {"theme":...} > "default". A non-default theme is
 * layered on top of default.css, so it only needs to list what it changes.
 *
 * Optional per-report hooks (named in front matter):
 *   callouts: true        -> wraps "➤ Update" paragraphs in .update-callout
 *   draft: true           -> injects _build/draft.css and adds data-draft="true"
 *                            to the <body>, producing a large diagonal "DRAFT"
 *                            stamp + corner badge on every HTML and PDF page
 *   extraCss: report.css  -> appended to the <style> block (report-specific CSS)
 *   plugin: report.plugin.mjs  -> exports transform(html, ctx) run after numeric
 *                                 alignment and before confirmation marks
 *   theme: <name>         -> use _build/themes/<name>.css for this report
 */

import { readFileSync, writeFileSync, existsSync, rmSync, globSync } from "node:fs";
import { dirname, join, basename, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { marked } from "marked";
import { markedSmartypants } from "marked-smartypants";
import matter from "gray-matter";

marked.use(markedSmartypants());
marked.use({ gfm: true });

const HERE = import.meta.dirname;
const BASE_CSS = readFileSync(join(HERE, "base.css"), "utf8");
const PRINT_CSS = readFileSync(join(HERE, "print.css"), "utf8");
const DRAFT_CSS = readFileSync(join(HERE, "draft.css"), "utf8");

// ---------------------------------------------------------------------------
// Numeric-cell detection (shared by the column-aware aligner)
// ---------------------------------------------------------------------------

// A cell is "numeric" if its text matches any of these shapes: a signed /
// currency / approximate number, a number with a unit word, a K/M/% suffixed
// number, or a number range with an en/em dash.
const NUM_RE = new RegExp(
  "^\\s*~?[\\-−\\+\\(]?\\$?[\\d,]+(?:\\.\\d+)?[\\)\\%]?(?:\\s*/\\s*\\w+)?\\s*$" +
  "|^\\s*~?[\\-−\\+]?[\\d,]+(?:\\.\\d+)?[\\)\\%]?\\s*[a-zA-Z]+\\s*$" +
  "|^\\s*~?[\\-−\\+\\(]?\\$?[\\d,]+(?:\\.\\d+)?(?:K|M|%)?\\s*$" +
  "|^\\s*~?[\\-−\\+\\(]?\\$?[\\d,]+(?:\\.\\d+)?[\\)\\%]?\\s*[\\-–—]\\s*~?[\\-−\\+\\(]?\\$?[\\d,]+(?:\\.\\d+)?[\\)\\%]?\\s*$"
);

// Cell annotations stripped before testing against NUM_RE.
const LEADING_EST_RE = /^\s*(?:est\.|approx\.)\s+/i;
const TRAILING_MARK_RE = /\s*(?:[\*†‡§✓]|\u{1F4CB}|⚠️?)+\s*$/u;
const TRAILING_PAREN_NOTE_RE = /\s*\([^)]*[A-Za-z→\s][^)]*\)\s*$/;

function normalizeForNumeric(text) {
  let prev = null;
  while (prev !== text) {
    prev = text;
    text = text.replace(LEADING_EST_RE, "").trim();
    text = text.replace(TRAILING_MARK_RE, "").trim();
    text = text.replace(TRAILING_PAREN_NOTE_RE, "").trim();
  }
  return text;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, "");
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Markdown -> HTML body
// ---------------------------------------------------------------------------

function markdownToBody(mdText) {
  let html = marked.parse(mdText);
  // md_in_html: marked already renders markdown inside a blank-line-separated
  // <div ...> block; just drop the leftover `markdown="1"` attribute.
  html = html.replace(/\s*markdown="1"/g, "");
  return html;
}

// Pull the <h1> title and the leading italic methodology paragraph off the top.
// Short leading italic lines (attribution) are discarded; the longest is the
// methodology header.
function splitReport(htmlBody) {
  const h1 = htmlBody.match(/<h1>(.*?)<\/h1>/s);
  const title = h1 ? h1[1].trim() : "Report";
  const afterH1 = h1 ? htmlBody.slice(h1.index + h1[0].length) : htmlBody;

  const leading = afterH1.match(/^\s*(?:<p><em>.*?<\/em><\/p>\s*)+/s);
  if (!leading) return { title, headerHtml: "", rest: afterH1 };

  const allEm = [...leading[0].matchAll(/<p><em>(.*?)<\/em><\/p>/gs)].map((m) => m[1]);
  const headerHtml = allEm.length
    ? allEm.reduce((a, b) => (b.length > a.length ? b : a), "").trim()
    : "";
  return { title, headerHtml, rest: afterH1.slice(leading[0].length) };
}

// ---------------------------------------------------------------------------
// Section labels above each <h2>
// ---------------------------------------------------------------------------

function sectionLabelFor(headingText, sectionLabels) {
  const h = headingText.toLowerCase();
  for (const [substr, label] of sectionLabels) {
    if (h.includes(String(substr).toLowerCase())) return label;
  }
  return "";
}

function addSectionLabels(htmlBody, sectionLabels) {
  return htmlBody.replace(/<h2>(.*?)<\/h2>/gs, (m, heading) => {
    const label = sectionLabelFor(heading, sectionLabels);
    const h2 = `<h2>${heading}</h2>`;
    return label ? `<p class="section-label">${label}</p>\n${h2}` : h2;
  });
}

// Mark the section label preceding each "Part N" heading so it stays with the
// heading across a page break.
function addPartBreakClass(htmlBody) {
  return htmlBody.replace(
    /(<p class="section-label">[^<]*<\/p>)\s*(<h2>(?:\s*Part\s+\d[^<]*)<\/h2>)/gs,
    (m, label, h2) =>
      `${label.replace('class="section-label"', 'class="section-label before-part"')}\n${h2}`
  );
}

// A paragraph immediately preceding a table is its intro; keep them together.
function keepIntroWithTable(htmlBody) {
  return htmlBody.replace(
    /<p>([^<]*(?:<(?!\/?p>)[^<]*)*)<\/p>(\s*)(<table)/gs,
    '<p class="intro-table">$1</p>$2$3'
  );
}

// ---------------------------------------------------------------------------
// Column-aware numeric alignment
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /^\s*[\-–—]?\s*$/;

function columnIsNumeric(cells) {
  if (!cells.length) return false;
  let sawNumeric = false;
  for (const cell of cells) {
    const text = stripTags(cell).trim();
    if (PLACEHOLDER_RE.test(text)) continue;
    if (NUM_RE.test(normalizeForNumeric(text))) {
      sawNumeric = true;
      continue;
    }
    return false;
  }
  return sawNumeric;
}

function addNumClass(tagHtml) {
  if (tagHtml.includes('class="')) {
    return tagHtml.replace(/class="([^"]*)"/, (m, g1) =>
      `class="${g1} num"`.replace('"  ', '" ')
    );
  }
  return tagHtml.slice(0, -1) + ' class="num">';
}

function rewriteRow(rowHtml, cellTag, numericCols) {
  const re = new RegExp(`(<${cellTag}[^>]*>)([\\s\\S]*?)(</${cellTag}>)`, "g");
  const cells = [...rowHtml.matchAll(re)];
  let out = rowHtml;
  for (let j = cells.length - 1; j >= 0; j--) {
    if (j >= numericCols.length || !numericCols[j]) continue;
    const m = cells[j];
    let opening = m[1];
    opening = opening.replace(/\s*class="num"/, "");
    opening = opening.replace(/class="([^"]*)\bnum\b\s*"/, (mm, g1) => `class="${g1.trim()}"`);
    opening = opening.replace(/\s*class=""/, "");
    const newOpening = addNumClass(opening);
    out = out.slice(0, m.index) + newOpening + m[2] + m[3] + out.slice(m.index + m[0].length);
  }
  return out;
}

function alignNumericColumns(htmlBody) {
  return htmlBody.replace(/<table>[\s\S]*?<\/table>/g, (tableHtml) => {
    const theadM = tableHtml.match(/<thead>([\s\S]*?)<\/thead>/);
    const tbodyM = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/);
    if (!tbodyM) return tableHtml;

    const bodyRows = [];
    for (const tr of tbodyM[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
      bodyRows.push(cells);
    }
    if (!bodyRows.length) return tableHtml;

    const ncols = Math.max(...bodyRows.map((r) => r.length));
    const numericCols = [];
    for (let j = 0; j < ncols; j++) {
      numericCols.push(columnIsNumeric(bodyRows.map((r) => (j < r.length ? r[j] : ""))));
    }

    let newTable = tableHtml;
    if (theadM) {
      const newThead =
        "<thead>" +
        theadM[1].replace(/<tr>([\s\S]*?)<\/tr>/g, (m, inner) => `<tr>${rewriteRow(inner, "th", numericCols)}</tr>`) +
        "</thead>";
      newTable = newTable.replace(theadM[0], newThead);
    }
    const newTbody =
      "<tbody>" +
      tbodyM[1].replace(/<tr>([\s\S]*?)<\/tr>/g, (m, inner) => `<tr>${rewriteRow(inner, "td", numericCols)}</tr>`) +
      "</tbody>";
    return newTable.replace(tbodyM[0], newTbody);
  });
}

// ---------------------------------------------------------------------------
// Confirmation marks, callouts, typography
// ---------------------------------------------------------------------------

function confirmMarks(htmlBody) {
  return htmlBody.replace(/<h3>(.*?)<\/h3>/gs, (m, head) => {
    const fixed = head.replace(/\s*✓\s*/g, ' <span class="conf-mark">✓</span> ');
    return `<h3>${fixed.trim()}</h3>`;
  });
}

// Wrap paragraphs that begin with the "➤ Update" marker in a callout div.
function updateCallouts(htmlBody) {
  return htmlBody.replace(
    /<p>(<strong>➤ Update[^<]*<\/strong>[\s\S]*?)<\/p>/g,
    '<div class="update-callout"><p>$1</p></div>'
  );
}

// Restore math typography the markdown leaves as ASCII for clean reading.
function restoreTypography(htmlBody) {
  htmlBody = htmlBody.replace(
    /(\$?[\d,.]+(?:%|\/\w+)?)\s+\*\s+(\$?[\d,.]+(?:%|\/\w+)?)/g,
    "$1 × $2"
  );
  return htmlBody.replace(/~=/g, "≈");
}

// ---------------------------------------------------------------------------
// Other Formats cards
// ---------------------------------------------------------------------------

function replaceOtherFormatsSection(htmlBody, formats) {
  if (!formats || !formats.length) return htmlBody;
  const re = /(<p class="section-label">[^<]*<\/p>\s*)?<h2>Other [Ff]ormats<\/h2>[\s\S]*?(?=<h2|$)/;
  const m = htmlBody.match(re);
  if (!m) return htmlBody;

  const n = formats.length;
  const colsClass = n === 3 || n === 4 ? `cols-${n}` : "";
  const introWord = { 3: "three", 4: "four" }[n] || String(n);

  const cards = formats
    .map(
      (c) =>
        '  <div class="format-card">\n' +
        `    <div class="format-card-icon">${c.icon}</div>\n` +
        `    <div class="format-card-title"><a href="${c.href}">${c.title}</a></div>\n` +
        `    <div class="format-card-desc">${c.desc}</div>\n` +
        "  </div>"
    )
    .join("\n");

  const html =
    '\n<p class="section-label">Download</p>\n' +
    "<h2>Other Formats</h2>\n" +
    `<p>This report is available in ${introWord} formats, all located alongside this page:</p>\n\n` +
    `<div class="format-cards ${colsClass}">\n${cards}\n</div>\n`;

  return htmlBody.slice(0, m.index) + html + htmlBody.slice(m.index + m[0].length);
}

// ---------------------------------------------------------------------------
// Header anchors (HTML only)
// ---------------------------------------------------------------------------

function slugify(text) {
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”");
  text = text.replace(/<[^>]+>/g, "");
  text = text.split(/\s*✓\s*|\s+Confirmed\b/)[0];
  text = text.toLowerCase();
  text = text.replace(/[^a-z0-9]+/g, "-");
  return text.replace(/^-+|-+$/g, "");
}

function addHeaderAnchors(htmlBody) {
  const used = new Set();
  const makeUnique = (slug) => {
    if (!used.has(slug)) {
      used.add(slug);
      return slug;
    }
    let i = 2;
    while (used.has(`${slug}-${i}`)) i++;
    const u = `${slug}-${i}`;
    used.add(u);
    return u;
  };

  return htmlBody.replace(/<(h[23])>(.*?)<\/\1>/gs, (full, tag, content) => {
    const slug = slugify(content);
    if (!slug) return full;
    const id = makeUnique(slug);
    const anchor = `<a class="header-anchor" href="#${id}" aria-label="Link to this section">¶</a>`;
    return `<${tag} id="${id}">${content}${anchor}</${tag}>`;
  });
}

// ---------------------------------------------------------------------------
// Theme + config loading
// ---------------------------------------------------------------------------

function loadConfig() {
  const p = join(HERE, "report.config.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

// Returns the theme CSS: always default.css, with the named theme layered on
// top (so a custom theme only needs to list the variables it overrides).
function loadTheme(name) {
  const dir = join(HERE, "themes");
  const base = readFileSync(join(dir, "default.css"), "utf8");
  if (!name || name === "default") return base;
  const p = join(dir, `${name}.css`);
  if (!existsSync(p)) throw new Error(`theme "${name}" not found: ${p}`);
  return base + "\n" + readFileSync(p, "utf8");
}

// The sections map from /reports/reports.json (same source that drives the
// index pages), used to build report breadcrumbs. Empty if unavailable.
function loadSections() {
  const p = join(process.cwd(), "reports", "reports.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")).sections || {};
  } catch {
    return {};
  }
}

// Home › Reports › <Section> › <title>. The final node (the page itself) is a
// non-link .current; the rest are links. Section node is dropped if unknown.
function breadcrumbHtml(meta, sections) {
  const trail = [
    { label: "Home", href: "/" },
    { label: "Reports", href: "/reports/" },
  ];
  const sec = meta.section && sections[meta.section];
  if (sec) trail.push({ label: sec.label, href: sec.url });
  return trail
    .map((c) => `<a href="${c.href}">${escapeHtml(c.label)}</a>`)
    .concat(`<span class="current">${escapeHtml(meta.title)}</span>`)
    .join('<span class="sep">›</span>');
}

const CLIPBOARD_SCRIPT = `
document.addEventListener('click', function(e) {
    const anchor = e.target.closest('.header-anchor');
    if (!anchor) return;
    const heading = anchor.parentElement;
    const id = heading.id;
    if (!id) return;
    const url = window.location.origin + window.location.pathname + '#' + id;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() {
            anchor.classList.add('copied');
            setTimeout(function() { anchor.classList.remove('copied'); }, 1400);
        }).catch(function() {});
    }
});
`;

// Click any content image (chart/figure) to open it full-size in a lightbox
// overlay; click anywhere or press Esc to close. Screen-only — the overlay is
// built at runtime, so it never reaches the PDF.
const LIGHTBOX_SCRIPT = `
(function() {
    var imgs = document.querySelectorAll('.container img');
    if (!imgs.length) return;
    var overlay = null;
    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() {
        if (!overlay) return;
        var o = overlay;
        overlay = null;
        o.classList.remove('open');
        document.removeEventListener('keydown', onKey);
        setTimeout(function() { if (o.parentNode) o.parentNode.removeChild(o); }, 200);
    }
    function open(src, alt) {
        overlay = document.createElement('div');
        overlay.className = 'lightbox-overlay';
        var big = document.createElement('img');
        big.src = src;
        big.alt = alt || '';
        overlay.appendChild(big);
        overlay.addEventListener('click', close);
        document.body.appendChild(overlay);
        overlay.offsetWidth; // force reflow so the fade-in transition runs
        overlay.classList.add('open');
        document.addEventListener('keydown', onKey);
    }
    imgs.forEach(function(img) {
        img.addEventListener('click', function() { open(img.currentSrc || img.src, img.alt); });
    });
})();
`;

// ---------------------------------------------------------------------------
// Assemble the document
// ---------------------------------------------------------------------------

async function buildHtml(mdText, meta, { forPdf, extraCss, plugin, themeCss, breadcrumb }) {
  const body = markdownToBody(mdText);
  const { headerHtml, rest: rest0 } = splitReport(body);

  let rest = rest0;
  rest = addSectionLabels(rest, meta.sectionLabels || []);
  rest = addPartBreakClass(rest);
  rest = keepIntroWithTable(rest);
  rest = alignNumericColumns(rest);
  if (plugin && typeof plugin.transform === "function") {
    rest = await plugin.transform(rest, { meta, forPdf });
  }
  rest = confirmMarks(rest);
  if (meta.callouts) rest = updateCallouts(rest);
  rest = restoreTypography(rest);
  rest = replaceOtherFormatsSection(rest, meta.formats);
  // Add heading ids for both HTML and PDF so internal "#section" links resolve
  // in either; the visible ¶ anchor is hidden in print via CSS.
  rest = addHeaderAnchors(rest);

  const printCss = PRINT_CSS.replace("__PDF_PAGE_AUTHOR__", meta.pdf.author).replace(
    "__PDF_PAGE_FOOTER__",
    meta.pdf.footer
  );
  const draftCss = meta.draft ? "\n" + DRAFT_CSS : "";
  const bodyAttr = meta.draft ? ' data-draft="true"' : "";
  const css =
    themeCss + "\n" + BASE_CSS + (forPdf ? printCss : "") + draftCss + (extraCss ? "\n" + extraCss : "");

  const titleBlock =
    `<h1 class="report-title">${meta.title}</h1>\n` +
    `<p class="report-subtitle">${meta.subtitle}</p>\n` +
    `<p class="report-attribution">${meta.attribution}</p>\n` +
    `<hr class="report-header-rule">\n` +
    `<p class="methodology-header">${headerHtml}</p>`;

  if (forPdf) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${meta.pageTitle}</title>
<style>${css}</style>
</head>
<body${bodyAttr}>
<div class="container">
${titleBlock}
${rest}
</div>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>${meta.pageTitle}</title>
<style>${css}</style>
</head>
<body${bodyAttr}>
<div class="page-banner">
  <nav class="page-banner-inner crumbs">
    ${breadcrumb}
  </nav>
</div>
<div class="container">
${titleBlock}
${rest}
</div>
<div class="page-footer">
${meta.footer} ·
<a href="${meta.publicUrl}">${meta.pdf.footer}</a>
</div>
<script>${CLIPBOARD_SCRIPT}</script>
<script>${LIGHTBOX_SCRIPT}</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Metadata validation
// ---------------------------------------------------------------------------

function validateMeta(meta, mdPath) {
  const required = ["publicUrl", "pageTitle", "title", "subtitle", "attribution", "footer", "pdf"];
  const missing = required.filter((k) => meta[k] === undefined);
  if (missing.length) {
    throw new Error(`${mdPath}: missing front-matter field(s): ${missing.join(", ")}`);
  }
  if (!meta.pdf.author || !meta.pdf.footer) {
    throw new Error(`${mdPath}: pdf.author and pdf.footer are required`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Is this .md a report? (has report front matter — skips archived copies,
// drafts, and other markdown that was never set up for the builder.)
function isReportMd(mdPath) {
  try {
    const { data } = matter(readFileSync(mdPath, "utf8"));
    return !!(data && data.publicUrl);
  } catch {
    return false;
  }
}

async function buildReport(mdPath) {
  const folder = dirname(mdPath);
  const raw = readFileSync(mdPath, "utf8");
  const { data: meta, content: mdBody } = matter(raw);
  validateMeta(meta, mdPath);

  const htmlName = meta.htmlFile || "index.html";
  const pdfName = meta.pdfFile || basename(mdPath).replace(/\.md$/, "") + ".pdf";
  const htmlPath = join(folder, htmlName);
  const pdfPath = join(folder, pdfName);

  // Resolve theme: front matter > report.config.json > "default".
  const config = loadConfig();
  const themeName = meta.theme || config.theme || "default";
  const themeCss = loadTheme(themeName);

  // Breadcrumb (from reports.json sections + front-matter section)
  const breadcrumb = breadcrumbHtml(meta, loadSections());

  // Optional per-report CSS + plugin
  let extraCss = "";
  if (meta.extraCss) {
    const cssPath = join(folder, meta.extraCss);
    if (!existsSync(cssPath)) throw new Error(`extraCss not found: ${cssPath}`);
    extraCss = readFileSync(cssPath, "utf8");
  }
  let plugin = null;
  if (meta.plugin) {
    const pluginPath = join(folder, meta.plugin);
    if (!existsSync(pluginPath)) throw new Error(`plugin not found: ${pluginPath}`);
    plugin = await import(pathToFileURL(pluginPath).href);
  }

  // Screen HTML
  const screenHtml = await buildHtml(mdBody, meta, { forPdf: false, extraCss, plugin, themeCss, breadcrumb });
  writeFileSync(htmlPath, screenHtml, "utf8");
  console.log(`wrote ${htmlPath} (${screenHtml.length.toLocaleString()} chars, theme: ${themeName})`);

  // Print HTML -> PDF via WeasyPrint (temp file in the folder so local images resolve)
  const printHtml = await buildHtml(mdBody, meta, { forPdf: true, extraCss, plugin, themeCss, breadcrumb });
  const tmpHtml = join(folder, ".report-print.tmp.html");
  writeFileSync(tmpHtml, printHtml, "utf8");
  try {
    const r = spawnSync("python", ["-m", "weasyprint", tmpHtml, pdfPath], {
      stdio: ["ignore", "inherit", "pipe"],
      encoding: "utf8",
    });
    if (r.error) throw r.error;
    const stderr = r.stderr || "";
    if (r.status !== 0) {
      process.stderr.write(stderr);
      throw new Error(`weasyprint exited ${r.status}`);
    }
    // WeasyPrint is chatty: unsupported screen-only CSS properties, and GTK/GLib
    // registry notices on Windows. Surface only real ERROR lines; drop the rest.
    const errs = stderr.split(/\r?\n/).filter((l) => /^ERROR\b/.test(l));
    if (errs.length) console.error(errs.join("\n"));
  } finally {
    rmSync(tmpHtml, { force: true });
  }
  console.log(`wrote ${pdfPath}`);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: node _build/report.mjs <path/to/report.md> | --all");
    process.exit(2);
  }

  if (arg === "--all") {
    const root = process.cwd();
    const files = globSync("reports/**/*.md", { cwd: root })
      .map((f) => resolve(root, f))
      .filter(isReportMd)
      .sort();
    if (!files.length) {
      console.error("no reports with front matter found under reports/");
      process.exit(1);
    }
    const failed = [];
    for (const f of files) {
      try {
        await buildReport(f);
      } catch (e) {
        console.error(`FAILED ${f}: ${e.message || e}`);
        failed.push(f);
      }
    }
    console.log(
      `\nbuilt ${files.length - failed.length}/${files.length} report(s)` +
        (failed.length ? `; ${failed.length} failed` : "")
    );
    if (failed.length) process.exit(1);
    return;
  }

  const mdPath = isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
  if (!existsSync(mdPath)) {
    console.error(`not found: ${mdPath}`);
    process.exit(2);
  }
  await buildReport(mdPath);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
