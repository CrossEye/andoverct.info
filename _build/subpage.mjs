/*
 * Authored-HTML subpage builder. Triggered by a `subpages:` directive in the
 * main report's front matter. Each entry names a standalone HTML document
 * (kept under the report's _src/) whose <style>, body and <script> are lifted
 * out and re-hosted on the site chrome: the report's breadcrumb rail with one
 * extra level, the theme + base stylesheet, and the shared site footer.
 *
 * The source IS published, but served as text/plain via a .htaccess this
 * builder drops beside it — see ensureSourceHtaccess below.
 *
 * The point is a format the markdown pipeline can't express — a large
 * hand-built chart, a scripted table, a rendered diagram — that should still
 * read as part of the report rather than as a stray white page. The source
 * document stays independently openable in a browser while it is being
 * authored; the builder is what makes the published copy a site page.
 *
 * Front-matter shape:
 *   subpages:
 *     - src: _src/indicators.html      # relative to the report folder
 *       subdir: indicators             # output goes to {subdir}/index.html
 *       title: Companion Chart         # terminal breadcrumb + <title> lead
 *
 * The source's own CSS is scoped to the `.subpage` wrapper (its html/body/
 * :root rules are rewritten onto the wrapper, everything else is prefixed), so
 * the source can be written as an ordinary standalone page without knowing it
 * will be embedded. Site chrome is hidden in print, leaving whatever @page
 * rules the source itself declares to govern the sheet.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { escapeHtml, pageNoteHtml, siteFooterBarHtml, banner: pageBanner } = require("./chrome.js");

// ---------------------------------------------------------------------------
// CSS scoping
// ---------------------------------------------------------------------------

// At-rules whose block holds further rule sets, so the scoper must recurse.
// Everything else (@font-face, @page, @keyframes) carries plain declarations
// and passes through untouched — which is how the source keeps its own @page.
const NESTING_AT_RULES = /^@(media|supports|container|layer|document|scope)\b/i;

// Strip a leading html/body/:root off a selector: in the standalone source
// those target the document itself, and the wrapper is what stands in for it.
function stripRootTokens(sel) {
  let prev = null;
  while (prev !== sel) {
    prev = sel;
    sel = sel.replace(/^(?:html|body|:root)(?![\w-])\s*/i, "");
  }
  return sel;
}

function scopeSelectorList(selectors, scope) {
  return selectors
    .split(",")
    .map((raw) => {
      const sel = raw.trim();
      if (!sel) return "";
      if (sel.startsWith("&")) return scope + sel.slice(1);
      const rest = stripRootTokens(sel);
      if (rest === sel) return `${scope} ${sel}`;
      return rest ? `${scope} ${rest}` : scope;
    })
    .filter(Boolean)
    .join(", ");
}

/*
 * Rewrite a stylesheet so every rule applies only inside `scope`. Walks the
 * text tracking comments, strings and brace depth rather than parsing CSS
 * properly — enough for a hand-authored source page, since it never has to
 * understand a declaration, only find the selector preceding each block.
 */
export function scopeCss(css, scope) {
  let out = "";
  let buf = ""; // text seen since the last block boundary
  let i = 0;

  const flushBlock = (body) => {
    const head = buf.trim();
    buf = "";
    if (!head) return `{${body}}`;
    if (head.startsWith("@")) {
      const inner = NESTING_AT_RULES.test(head) ? scopeCss(body, scope) : body;
      return `${head} {${inner}}`;
    }
    return `${scopeSelectorList(head, scope)} {${body}}`;
  };

  while (i < css.length) {
    const c = css[i];

    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      buf += css.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      buf += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "{") {
      // Collect this block's body, balanced, so nested blocks come along.
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        const d = css[j];
        if (d === "/" && css[j + 1] === "*") {
          const end = css.indexOf("*/", j + 2);
          j = end === -1 ? css.length : end + 2;
          continue;
        }
        if (d === '"' || d === "'") {
          let k = j + 1;
          while (k < css.length && css[k] !== d) k += css[k] === "\\" ? 2 : 1;
          j = k + 1;
          continue;
        }
        if (d === "{") depth++;
        else if (d === "}") depth--;
        j++;
      }
      const body = css.slice(i + 1, depth === 0 ? j - 1 : j);
      out += flushBlock(body);
      i = j;
      continue;
    }
    if (c === ";" && buf.trim().startsWith("@")) {
      // Block-less at-rule (@import, @charset) — leave it where it is.
      out += buf + ";";
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  return out + buf;
}

// ---------------------------------------------------------------------------
// Source document extraction
// ---------------------------------------------------------------------------

// Pull a standalone HTML document apart: every <style> block (concatenated, in
// order) and the contents of <body> — scripts included, which is why they are
// left in place rather than hoisted out.
function splitDocument(html) {
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1])
    .join("\n");
  const stripped = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  const body = stripped.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return { styles, body: (body ? body[1] : stripped).trim() };
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

// Promote the parent report's terminal `<span class="current">…</span>` crumb
// to a link back up, then append this page's own terminal crumb. The same move
// research.mjs makes; kept local so the two can diverge.
function extendBreadcrumb(breadcrumb, reportHref, finalLabel) {
  if (!breadcrumb) return "";
  return breadcrumb.replace(
    /<span class="current">([^<]+)<\/span>/,
    `<a href="${reportHref}">$1</a><span class="sep">›</span><span class="current">${escapeHtml(finalLabel)}</span>`
  );
}

// The wrapper stands in for the source's <body>, which splits its styling in
// two. Paint goes BEFORE the scoped source CSS, so a source that sets its own
// background/padding wins; the report column width goes AFTER it, because the
// source's `body { margin: 0 }` would otherwise cancel the centering. Only the
// two centering margins are set, leaving a source free to set its own top and
// bottom. Site chrome drops out in print, so the source's own @page rules
// govern the sheet.
const SUBPAGE_PAINT_CSS = `
.subpage {
    background: var(--bg-page);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.04);
}
`;

const SUBPAGE_LAYOUT_CSS = `
.subpage {
    max-width: var(--measure);
    margin-left: auto;
    margin-right: auto;
}
@media print {
    .page-banner, .site-footer { display: none; }
    body { background: #fff; }
    .subpage { max-width: none; box-shadow: none; }
}
`;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/*
 * Publish the authored source as VIEWABLE TEXT, not as a second page.
 *
 * The source is a complete standalone HTML document. Left as text/html the
 * server renders it as an unstyled duplicate of the page it builds into — which
 * is why it was originally excluded from the deploy set entirely. But then it
 * was unreachable without a checkout, and the whole point of keeping a readable
 * source is being able to fetch or hand it on from anywhere.
 *
 * So it ships, with a sibling .htaccess remapping .html to text/plain, the same
 * way /reports/.htaccess already serves the .md report sources. Written here
 * rather than left to whoever adds the next subpage, because forgetting it
 * silently republishes the duplicate page. Idempotent: never overwrites an
 * existing .htaccess, so a hand-tuned one survives.
 */
function ensureSourceHtaccess(srcPath) {
  const path = join(dirname(srcPath), ".htaccess");
  if (existsSync(path)) return;
  writeFileSync(path, `# Authored source, published for reference only. Served as plain text so the
# browser shows the source instead of rendering a second, unstyled copy of the
# page it builds into. Mirrors the .md handling in /reports/.htaccess.
#
# No RewriteEngine here on purpose: this directory inherits the document root's
# ruleset, including the https redirect fix and the /<dir>/idx listing route.
AddType "text/plain; charset=utf-8" .html
`, "utf8");
  console.log(`  wrote ${path} (serves the source as text/plain)`);
}

export async function buildSubpages(folder, meta, themeCss, baseCss, breadcrumb) {
  const items = meta.subpages;
  if (!Array.isArray(items) || !items.length) return;

  for (const item of items) {
    if (!item.src || !item.subdir || !item.title) {
      console.log(`subpages: skipping entry missing src/subdir/title: ${JSON.stringify(item)}`);
      continue;
    }
    const src = resolve(folder, item.src);
    if (!existsSync(src)) {
      console.log(`subpages: source not found: ${src}`);
      continue;
    }

    ensureSourceHtaccess(src);
    const { styles, body } = splitDocument(readFileSync(src, "utf8"));
    const scoped = scopeCss(styles, ".subpage");

    const depth = item.subdir.split("/").filter(Boolean).length;
    const parentHref = "../".repeat(depth);
    const extendedCrumbs = extendBreadcrumb(breadcrumb, parentHref, item.title);

    const pageTitle = item.pageTitle || `${item.title} — ${meta.title || ""}`;
    const robotsMeta = meta.noindex ? '\n<meta name="robots" content="noindex">' : "";
    const description = item.description
      ? `\n<meta name="description" content="${escapeHtml(item.description)}">`
      : "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${robotsMeta}${description}
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>${escapeHtml(pageTitle)}</title>
<style>${themeCss}
${baseCss}
${SUBPAGE_PAINT_CSS}
${scoped}
${SUBPAGE_LAYOUT_CSS}</style>
</head>
<body>
${pageBanner(extendedCrumbs)}
<div class="subpage">
${body}
</div>
${pageNoteHtml(item.footerNote ?? meta.footerNote ?? meta.footer)}
${siteFooterBarHtml()}
</body>
</html>`;

    const outDir = join(folder, item.subdir);
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, "index.html");
    writeFileSync(outPath, html, "utf8");
    console.log(`wrote ${item.subdir}/index.html (${html.length.toLocaleString()} chars)`);
  }
}
