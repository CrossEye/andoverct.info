/*
 * Shared page chrome (plan 006). Authored as CommonJS on purpose: Node lets an
 * ESM module `import` a CJS module and a CJS module `require` it, but NOT the
 * reverse — so CJS is the only authoring choice all six site generators (three
 * ESM: links.mjs, report.mjs, town-asset-render.mjs; three CJS: the-facts
 * render.js, town-charter convert.js, transcripts download-transcripts.js) can
 * consume from one place.
 *
 * Shared here: crumb assembly + separator, the page banner, the two-part footer,
 * and escapeHtml. NOT shared: each surface's CSS skin — this module only emits
 * stable class names (page-banner / page-banner-inner / crumbs / page-note /
 * site-footer / site-footer-inner) that every stylesheet keeps skinning its own way.
 */
"use strict";

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const FOOTER = JSON.parse(readFileSync(join(__dirname, "footer.json"), "utf8"));

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The one crumb separator, previously copied verbatim into all six generators.
const SEP = '<span class="sep">›</span>';

/*
 * Breadcrumb innards. `trail` is an ordered array of { label, href? }: items
 * with an href render as links, any item without one (normally the last)
 * renders as the current-page span. Returns just the joined crumbs — wrap them
 * with banner() for the standard dark rail, or in a surface-specific <nav> (the
 * charter home page keeps its crumbs inside the dark article, for instance).
 */
function crumbs(trail) {
  return trail
    .map((c) => (c.href
      ? `<a href="${c.href}">${escapeHtml(c.label)}</a>`
      : `<span class="current">${escapeHtml(c.label)}</span>`))
    .join(SEP);
}

/*
 * The standard page banner: a full-width rail carrying the breadcrumbs.
 *  - opts.extraClass appends to the page-banner element (e.g. "private-banner").
 *  - opts.indent is leading whitespace prepended to every line, so a caller
 *    embedding the banner deeper in its document can keep its own indentation
 *    (and thus byte-identical output).
 */
function banner(crumbsHtml, opts) {
  opts = opts || {};
  const extra = opts.extraClass ? " " + opts.extraClass : "";
  const p = opts.indent || "";
  return `${p}<div class="page-banner${extra}">\n`
    + `${p}  <nav class="page-banner-inner crumbs">\n`
    + `${p}    ${crumbsHtml}\n`
    + `${p}  </nav>\n`
    + `${p}</div>`;
}

/*
 * The site footer, in two parts.
 *
 * .page-note is the optional per-page line — sources, method, an edition note.
 * It stays in the page flow because it belongs to the document.
 *
 * .site-footer is the canonical identity/disclaimer from footer.json, constant
 * site-wide. It renders as a full-width bar carrying the banner's background,
 * with the banner's rule mirrored onto its top edge, so every page is bookended
 * by the same chrome; each stylesheet skins it from its own palette vars.
 *
 * PLACEMENT: emit them in this order, and put the bar where it can run
 * full-bleed. On a surface whose footer is a direct child of <body> that is
 * simply where the old single footer went. On one whose content sits in a
 * width-constrained wrapper (<main class="page">, the-facts' <div class="page">)
 * the note goes INSIDE the wrapper and the bar AFTER it — inside, the bar
 * inherits the wrapper's max-width and stops being full-width.
 */
function pageNoteHtml(note) {
  return note ? `<p class="page-note">${note}</p>` : "";
}

function siteFooterBarHtml() {
  return '<footer class="site-footer">\n'
    + `<div class="site-footer-inner">${FOOTER.id}</div>\n`
    + "</footer>";
}

module.exports = {
  escapeHtml, SEP, crumbs, banner,
  pageNoteHtml, siteFooterBarHtml,
  footer: FOOTER,
};
