// Research-page builder. Triggered by a `research:` directive in the main
// report's front matter. Each entry names a subdir under the report folder
// that contains a report.md; the builder renders that markdown to HTML and
// writes index.html alongside it, using the same site chrome (breadcrumbs,
// banner, theme) as the parent report. No civic-report treatment (methodology
// box, section labels, etc.) — these are lightweight supplementary pages.
//
// Front-matter shape:
//   research:
//     - subdir: research/chaplin-rd11
//       title: Chaplin / RD 11 Shared Central Office
//
// The source markdown is always read from {subdir}/report.md and the HTML is
// written to {subdir}/index.html so a folder URL (.../chaplin-rd11/) serves
// the rendered page while /report.md remains available for anyone who wants
// the underlying source.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { marked } from "marked";
import { markedSmartypants } from "marked-smartypants";

marked.use(markedSmartypants());

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Promote the parent report's `<span class="current">…title…</span>` breadcrumb
// terminus to a link back to ../../, then append a new terminal current node
// carrying this page's title.
function extendBreadcrumb(breadcrumb, reportHref, finalLabel) {
  if (!breadcrumb) return "";
  return breadcrumb.replace(
    /<span class="current">([^<]+)<\/span>/,
    `<a href="${reportHref}">$1</a><span class="sep">›</span><span class="current">${escapeHtml(finalLabel)}</span>`
  );
}

const LOCAL_CSS = `
.container { max-width: 900px; margin: 0 auto; padding: 24px; line-height: 1.55; }
.container h1 { margin-top: 0; }
.container h2 { margin-top: 32px; }
.container h3 { margin-top: 20px; }
.container hr { margin: 32px 0; border: 0; border-top: 1px solid #ddd; }
.container table { border-collapse: collapse; margin: 8px 0 16px 0; font-size: 14px; }
.container th, .container td { padding: 4px 10px; border-bottom: 1px solid #ddd; text-align: left; }
.container th { background: #f5f2e8; font-weight: 600; }
.container td.num, .container th.num { text-align: right; font-variant-numeric: tabular-nums; }
.container a { word-break: break-word; }
.container ul, .container ol { padding-left: 24px; }
.container li { margin: 4px 0; }
`;

export async function buildResearchPages(folder, meta, themeCss, baseCss, breadcrumb) {
  const items = meta.research;
  if (!Array.isArray(items) || !items.length) return;

  for (const item of items) {
    const subdir = item.subdir;
    if (!subdir || !item.title) {
      console.log(`research: skipping entry missing subdir/title: ${JSON.stringify(item)}`);
      continue;
    }
    const src = resolve(folder, subdir, "report.md");
    if (!existsSync(src)) {
      console.log(`research: source not found: ${src}`);
      continue;
    }

    const raw = readFileSync(src, "utf8");
    const bodyHtml = marked.parse(raw);

    // Depth of the page relative to the parent report determines the href
    // that promotes the parent title to a link. subdir "research/chaplin-rd11"
    // is two levels deep, so the parent lives at "../../".
    const depth = subdir.split("/").filter(Boolean).length;
    const parentHref = "../".repeat(depth);
    const extendedCrumbs = extendBreadcrumb(breadcrumb, parentHref, item.title);

    const pageTitle = `${item.title} — ${meta.title || ""}`;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<style>${baseCss}
${themeCss}
${LOCAL_CSS}</style>
</head>
<body>
<div class="page-banner">
  <nav class="page-banner-inner crumbs">
    ${extendedCrumbs}
  </nav>
</div>
<main class="container">
${bodyHtml}
</main>
</body>
</html>`;

    const outPath = join(folder, subdir, "index.html");
    writeFileSync(outPath, html, "utf8");
    console.log(`wrote ${subdir}/index.html (${html.length.toLocaleString()} chars)`);
  }
}
