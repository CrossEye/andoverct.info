#!/usr/bin/env node
/*
 * town-asset renderer — docs-sweep output → staged site trees (plan 004).
 *
 *   npm run render:town-asset                  # ../docs-sweep/v4 -> its out-site/
 *   npm run render:town-asset -- --src <v4dir> --out <dir>
 *
 * Reads <src>/out/town-asset/1..N (markdown pieces, campaign register yamls,
 * meta.json, MANIFEST.txt — emitted by docs-sweep's v4/build.py), plus this
 * repo's links/_src and <src>/fb (campaign.md, cards/, console tooling).
 * Writes ONLY under --out, never inside this repo: unpublished content stays
 * out of it (plan 003). The output fills the plan-003 staging contract:
 *
 *   steps/<N>/MANIFEST.txt, FB.txt, FB-card*.png
 *   steps/<N>/www/{series/…, links/…}          <- copied live on promotion
 *   preview/…                                  <- gated review area + FB console
 *
 * Rule 3 (no signposting) is enforced by construction and re-checked by greps
 * in the verification: seams appear only in the final article; the collection
 * footer only on standalone pieces; nothing rendered names a plan or a count.
 */

import {
  readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync,
  copyFileSync, rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { marked } from "marked";
import { markedSmartypants } from "marked-smartypants";
import {
  loadConfig, loadTheme, loadDocsFrom, pageShell, ogHead, escapeHtml,
  renderLeafPage, renderListPage, renderIndexPage, BASE_CSS, LINKS_CSS,
} from "./links.mjs";

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, "..");

const args = process.argv.slice(2);
const valOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const SRC = resolve(ROOT, valOf("--src") || "../docs-sweep/v4");
const OUT = resolve(ROOT, valOf("--out") || join(SRC, "out-site"));

const STEPS_SRC = join(SRC, "out", "town-asset");
const FB_DIR = join(SRC, "fb");
const SITE_SRC = join(ROOT, "links", "_src");

function fail(msg) { console.error(`\n  render:town-asset: ${msg}\n`); process.exit(1); }
const warnings = [];
function warn(msg) { warnings.push(msg); console.log(`  ! ${msg}`); }

marked.use(markedSmartypants());
marked.use({ mangle: false, headerIds: false });

// ---------------------------------------------------------------------------
// Series chrome. The piece-page spec comes from the stage-0 mockup
// (.meta/mockups/town-asset-page.html); SEAM_CSS is Scott's decided hybrid and
// MUST stay after the .piece-body p rules — p.seam wins the specificity tie
// only by coming later.
// ---------------------------------------------------------------------------
const TA_CSS = `
.piece-body h1 { margin: 0 0 4px; }
.piece-dek { font-size: 1.06rem; color: var(--ink-mute); margin: 0 0 28px; font-family: var(--font-sans); font-style: italic; }
.piece-body p { margin: 0 0 1em; }
.piece-body sup { font-size: 0.72em; }
.piece-body sup a { text-decoration: none; }
.ta-index h3 { margin: 1.6em 0 0.3em; }
.ta-index h3 a { color: var(--accent-2); text-decoration: none; }
.ta-index h3 a:hover { text-decoration: underline; }
.ta-article h2 { margin: 2.2em 0 0.6em; }
h2.sources-h { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-mute); font-family: var(--font-serif); margin: 40px 0 10px; padding-top: 14px; border-top: 3px solid var(--accent); }
h2.sources-h + ol { margin: 0 0 1em; padding-left: 1.4em; font-size: 0.92rem; }
h2.sources-h + ol li { margin: 0 0 8px; }
p.collection-footer { margin: 26px 0 0; padding: 14px 16px; background: var(--bg-soft); border-radius: 8px; font-size: 0.95rem; }

/* SEAM_CSS — decided at stage 0; keep after .piece-body p (specificity tie). */
p.seam {
    padding-left: 1.25em;
    border-left: 3px solid var(--accent);
    margin: 4em 2em 2em;
    font-style: italic;
}
`;

const SERIES_TITLE = "A Town Asset";
const SERIES_DESC =
  "An account drawn entirely from Andover's own public record: the minutes, "
  + "the packets, and the recordings of its own meetings.";

const crumb = (parts, current) =>
  parts.map((c) => `<a href="${c.href}">${escapeHtml(c.label)}</a>`)
    .concat(`<span class="current">${escapeHtml(current)}</span>`)
    .join('<span class="sep">›</span>');

// Markdown -> body HTML, with the two known shapes given their site classes.
function mdToHtml(md) {
  let html = marked.parse(md);
  html = html.replace(/<h2([^>]*)>Sources<\/h2>/, '<h2$1 class="sources-h">Sources</h2>');
  html = html.replace(/<p>Every source cited above/, '<p class="collection-footer">Every source cited above');
  // Citation markers need no transform: build.py emits them as raw
  // <sup class="src"> HTML (like the seams), so nothing here has to guess
  // which links are citations. TA_CSS styles .piece-body sup.
  return html;
}

// ---------------------------------------------------------------------------
// FB campaign: posts by number from the fenced blocks of fb/campaign.md.
// ---------------------------------------------------------------------------
function loadPosts() {
  const p = join(FB_DIR, "campaign.md");
  if (!existsSync(p)) { warn("no fb/campaign.md — steps get no FB.txt/cards"); return new Map(); }
  const text = readFileSync(p, "utf8");
  const posts = new Map(); // number -> { title, image, text }
  let current = null;
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^###\s+(.+?)\s+###\s*$/);
    if (h) {
      const n = h[1].match(/^Post\s+(\d+)\b/i);
      current = { number: n ? parseInt(n[1], 10) : null, title: h[1], image: null, lines: null };
      continue;
    }
    if (!current) continue;
    const im = line.match(/^Image:\s*`?([^`\s]+?)`?\.?\s*$/i);
    if (im && fence === null) { current.image = /^none$/i.test(im[1]) ? null : im[1]; continue; }
    if (line.trim() === "```") {
      if (fence === null) { fence = []; }
      else {
        if (current.number !== null) {
          posts.set(current.number, {
            title: current.title, image: current.image, text: fence.join("\n").trim() + "\n",
          });
        }
        fence = null;
      }
      continue;
    }
    if (fence !== null) fence.push(line);
  }
  return posts;
}

// ---------------------------------------------------------------------------
// Load inputs
// ---------------------------------------------------------------------------
if (!existsSync(STEPS_SRC)) fail(`no ${STEPS_SRC} — run docs-sweep's build first (python v4/build.py).`);
const stepNums = readdirSync(STEPS_SRC).filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);
if (!stepNums.length) fail(`no step dirs under ${STEPS_SRC}.`);
const TOTAL = stepNums[stepNums.length - 1];

const config = loadConfig();
if (!config.siteOrigin) fail(`_build/report.config.json must define "siteOrigin".`);
// Strip CSS comments before shipping: the theme files carry dev-facing notes
// (paths, project names) that must not ride along inside every page's <style>
// — the rule-3 greps treat them as leaks.
const stripCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n{3,}/g, "\n\n");
const linksCtx = {
  siteOrigin: config.siteOrigin.replace(/\/+$/, ""),
  defaultOgImage: config.defaultOgImage,
  css: stripCss(loadTheme(config.theme || "default") + "\n" + BASE_CSS + LINKS_CSS),
};
const seriesCss = stripCss(loadTheme(config.theme || "default") + "\n" + BASE_CSS + TA_CSS);
const og = (title, description, path) =>
  ogHead({ title, description, path }, linksCtx);

const site = loadDocsFrom(SITE_SRC);
if (site.errors.length) { site.errors.forEach((e) => console.error(`ERROR ${e}`)); fail("repo links/_src does not validate."); }

const posts = loadPosts();

rmSync(OUT, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Per-step rendering
// ---------------------------------------------------------------------------
let finalMeta = null;
for (const step of stepNums) {
  const sd = join(STEPS_SRC, String(step));
  const metaPath = join(sd, "meta.json");
  if (!existsSync(metaPath)) fail(`steps/${step} has no meta.json (rebuild docs-sweep with the current build.py).`);
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  if (meta.final) finalMeta = meta;
  const byQuery = new Map(meta.pieces.map((p) => [p.slug, p]));

  const www = join(OUT, "steps", String(step), "www");
  const taDir = join(www, "series", "town-asset");
  mkdirSync(taDir, { recursive: true });

  // --- the parent: annotated list mid-run, THE ARTICLE on the final night ---
  const indexMd = readFileSync(join(sd, "index.md"), "utf8");
  const parentBody = `<article class="piece-body ${meta.final ? "ta-article" : "ta-index"}">`
    + mdToHtml(indexMd) + `</article>`;
  writeFileSync(join(taDir, "index.html"), pageShell({
    pageTitle: SERIES_TITLE,
    og: og(SERIES_TITLE, SERIES_DESC, "/series/town-asset/"),
    crumbs: crumb([{ label: "Home", href: "/" }, { label: "Series", href: "/series/" }], SERIES_TITLE),
    body: parentBody,
  }, seriesCss), "utf8");

  // --- the pieces published so far ---
  for (const piece of meta.pieces) {
    const md = readFileSync(join(sd, "pieces", piece.slug + ".md"), "utf8");
    let html = mdToHtml(md);
    // The dek lives in meta.json, not the markdown; it renders under the title.
    html = html.replace(/<\/h1>/, `</h1>\n<p class="piece-dek">${escapeHtml(piece.dek)}</p>`);
    const dir = join(taDir, piece.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), pageShell({
      pageTitle: `${piece.title} — ${SERIES_TITLE}`,
      og: og(piece.title, piece.dek, `/series/town-asset/${piece.slug}/`),
      crumbs: crumb([
        { label: "Home", href: "/" }, { label: "Series", href: "/series/" },
        { label: SERIES_TITLE, href: "/series/town-asset/" },
      ], piece.title),
      body: `<article class="piece-body">${html}</article>`,
    }, seriesCss), "utf8");
  }

  // --- the /series/ landing: minimal, one entry, identical every step ---
  writeFileSync(join(www, "series", "index.html"), pageShell({
    pageTitle: "Series",
    og: og("Series", "Longer pieces published in parts.", "/series/"),
    crumbs: crumb([{ label: "Home", href: "/" }], "Series"),
    body: `<article class="piece-body ta-index"><h1>Series</h1>`
      + `<h3><a href="/series/town-asset/">${SERIES_TITLE}</a></h3>`
      + `<p>${escapeHtml(SERIES_DESC)}</p></article>`,
  }, seriesCss), "utf8");

  // --- links: the step's campaign docs + the union index -------------------
  const camp = loadDocsFrom(join(sd, "links"));
  if (camp.errors.length) { camp.errors.forEach((e) => console.error(`ERROR ${e}`)); fail(`step ${step} campaign links do not validate.`); }

  const union = new Map(site.docs);
  for (const [id, doc] of camp.docs) {
    if (union.has(id)) {
      fail(`duplicate link id "${id}": ${join("links/_src", id + ".yaml")} (repo) vs `
        + `${join(sd, "links", id + ".yaml")} (campaign). Every id must be unique.`);
    }
    union.set(id, doc);
  }

  const linksOut = join(www, "links");
  mkdirSync(join(linksOut, "_src"), { recursive: true });
  for (const [id, doc] of camp.docs) {
    copyFileSync(join(sd, "links", id + ".yaml"), join(linksOut, "_src", id + ".yaml"));
    const html = doc.kind === "leaf" ? renderLeafPage(doc, linksCtx) : renderListPage(doc, union, linksCtx);
    mkdirSync(join(linksOut, id), { recursive: true });
    writeFileSync(join(linksOut, id, "index.html"), html, "utf8");
  }
  writeFileSync(join(linksOut, "index.html"), renderIndexPage(union, linksCtx), "utf8");

  // --- MANIFEST + the night's post text and card(s) -------------------------
  copyFileSync(join(sd, "MANIFEST.txt"), join(OUT, "steps", String(step), "MANIFEST.txt"));

  const nights = [];
  if (posts.has(step)) nights.push(posts.get(step));
  if (step === TOTAL) {
    for (const [n, p] of [...posts].sort((a, b) => a[0] - b[0])) if (n > TOTAL) nights.push(p);
  }
  if (nights.length) {
    writeFileSync(join(OUT, "steps", String(step), "FB.txt"),
      nights.map((p) => p.text).join("\n----\n"), "utf8");
    let cardN = 0;
    for (const p of nights) {
      if (!p.image) { warn(`step ${step}: post "${p.title}" has no card (Image: none)`); continue; }
      const src = join(FB_DIR, "cards", p.image.replace(/\.png$/i, "") + ".png");
      if (!existsSync(src)) { warn(`step ${step}: card ${p.image} not found under fb/cards/ (run export_cards.py)`); continue; }
      cardN++;
      copyFileSync(src, join(OUT, "steps", String(step), cardN === 1 ? "FB-card.png" : `FB-card-${cardN}.png`));
    }
  } else {
    warn(`step ${step}: no FB post numbered ${step} in fb/campaign.md — no FB.txt staged`);
  }

  console.log(`  step ${String(step).padStart(2)}  ${meta.tonight.slug.padEnd(20)} pieces=${String(meta.pieces.length).padStart(2)}  links=${camp.docs.size}${meta.final ? "   <- THE ARTICLE" : ""}`);
}

// ---------------------------------------------------------------------------
// preview/ — the gated review area (uploaded to /private/town-asset/)
// ---------------------------------------------------------------------------
if (!finalMeta) fail("no step is marked final in its meta.json — cannot build the preview dashboard.");
const pv = join(OUT, "preview");
mkdirSync(pv, { recursive: true });
const finalSd = join(STEPS_SRC, String(TOTAL));

// Full renderings of every piece and the assembled article, byte-styled like
// the live pages, so phone review shows exactly what will publish.
for (const piece of finalMeta.pieces) {
  const md = readFileSync(join(finalSd, "pieces", piece.slug + ".md"), "utf8");
  let html = mdToHtml(md).replace(/<\/h1>/, `</h1>\n<p class="piece-dek">${escapeHtml(piece.dek)}</p>`);
  const dir = join(pv, "pieces", piece.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), pageShell({
    pageTitle: `${piece.title} — ${SERIES_TITLE}`, og: "",
    crumbs: crumb([
      { label: "Home", href: "/" }, { label: "Series", href: "/series/" },
      { label: SERIES_TITLE, href: "/series/town-asset/" },
    ], piece.title),
    body: `<article class="piece-body">${html}</article>`,
  }, seriesCss), "utf8");
}
mkdirSync(join(pv, "article"), { recursive: true });
writeFileSync(join(pv, "article", "index.html"), pageShell({
  pageTitle: SERIES_TITLE, og: "",
  crumbs: crumb([{ label: "Home", href: "/" }, { label: "Series", href: "/series/" }], SERIES_TITLE),
  body: `<article class="piece-body ta-article">${mdToHtml(readFileSync(join(finalSd, "index.md"), "utf8"))}</article>`,
}, seriesCss), "utf8");

// The FB console: build it from the campaign sources and copy it in.
if (existsSync(join(FB_DIR, "campaign.md"))) {
  const py = process.platform === "win32" ? "python" : "python3";
  const res = spawnSync(py, ["build_console.py", "campaign.md"],
    { cwd: FB_DIR, encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1" } });
  if (res.status !== 0) {
    warn(`build_console.py failed (${(res.stderr || "").trim().slice(-300)}) — preview has no console`);
  } else {
    mkdirSync(join(pv, "console"), { recursive: true });
    copyFileSync(join(FB_DIR, "index.html"), join(pv, "console", "index.html"));
  }
}

// The dashboard: plain private chrome, clearly not public-styled.
const statusRows = finalMeta.pieces.map((p, i) => {
  const ok = p.status === "sourced";
  return `<tr><td>${i + 1}</td>`
    + `<td><a href="pieces/${escapeHtml(p.slug)}/">${escapeHtml(p.title)}</a></td>`
    + `<td class="${ok ? "ok" : "warn"}">${escapeHtml(p.status || "?")}</td></tr>`;
}).join("\n");
writeFileSync(join(pv, "index.html"), `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>A Town Asset — private review</title>
<style>
  body{margin:0;background:#f4f6f9;color:#19222e;font-family:system-ui,sans-serif;line-height:1.5}
  .wrap{max-width:720px;margin:0 auto;padding:32px 20px}
  h1{font-size:1.2rem;color:#143862} .private{display:inline-block;background:#8a1f1f;color:#fff;
  font-size:11px;letter-spacing:.08em;text-transform:uppercase;border-radius:4px;padding:2px 8px}
  table{width:100%;border-collapse:collapse;margin:18px 0;font-size:14px}
  td,th{padding:7px 8px;border-bottom:1px solid #e3e8ef;text-align:left}
  td.ok{color:#1f7d49} td.warn{color:#8a1f1f;font-weight:600}
  a{color:#245c95} .big{font-size:15px;margin:8px 0}
</style></head><body><div class="wrap">
<p class="private">Private review</p>
<h1>A Town Asset — ${finalMeta.total} pieces</h1>
<p class="big"><a href="article/">The assembled article</a> · <a href="console/">FB posting console</a></p>
<table><tr><th>#</th><th>Piece</th><th>Status</th></tr>
${statusRows}
</table>
<p>Live promotion happens at <a href="/private/admin/promote">/private/admin/promote</a>.
Each night's post text and card sit in that step's folder and appear on the promote result page.</p>
</div></body></html>\n`, "utf8");

console.log(`\n  wrote ${OUT}  (steps 1..${TOTAL} + preview)`);
if (warnings.length) console.log(`  ${warnings.length} warning(s) above.`);
