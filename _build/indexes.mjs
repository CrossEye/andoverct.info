#!/usr/bin/env node
/*
 * Index-page generator (plan 006, stage 2+).
 *
 * Reads _build/site-index.json (the index tree) and renders each node to a real
 * index.html at build time, on the shared chrome (_build/chrome.js). Leaf card
 * lists reference reports/reports.json via each node's `list` rather than
 * duplicating report metadata — the same data the runtime reports.js reads, but
 * rendered once, at build time, so the page is real HTML (crawlable, no-JS,
 * no fetch flash) instead of an empty container hydrated in the browser.
 *
 *   npm run rebuild:indexes   (node _build/indexes.mjs)
 *
 * The card markup here is a straight port of reports.js's entryHtml/render so
 * the output matches what the runtime path produced.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { escapeHtml, crumbs as buildCrumbs, siteFooterHtml } from "./chrome.js";

const HERE = import.meta.dirname;
const ROOT = join(HERE, "..");

const TREE = JSON.parse(readFileSync(join(HERE, "site-index.json"), "utf8"));
const REPORTS = JSON.parse(readFileSync(join(ROOT, "reports", "reports.json"), "utf8"));

const FONTS = `    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">`;

// --- report card rendering (ported from reports/reports.js) ------------------

function entryHtml(e, heading) {
  const meta = e.meta.map(escapeHtml).join(' <span class="dot">·</span> ');
  const paras = e.paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
  return (
    '<article class="entry">' +
    (meta ? `<p class="meta">${meta}</p>` : "") +
    `<${heading}><a href="${escapeHtml(e.url)}">${escapeHtml(e.title)}</a></${heading}>` +
    paras +
    "</article>"
  );
}

// A section listing: every report in the section (hidden ones omitted), using
// its section-specific meta/detail where present.
function sectionListHtml(section, heading) {
  const entries = REPORTS.reports
    .filter((r) => r.section === section && !r.hidden)
    .map((r) => entryHtml({
      url: r.url,
      title: r.title,
      meta: r.sectionMeta || r.meta || [],
      paras: r.detail || (r.summary ? [r.summary] : []),
    }, heading))
    .join("\n");
  return `<section class="group">\n${entries}\n      </section>`;
}

// The top-level grouped view: featured reports under linked section headings,
// in the order the sections appear in reports.json.
function featuredGroupHtml(groupHeading, heading) {
  return Object.keys(REPORTS.sections)
    .map((key) => {
      const sec = REPORTS.sections[key];
      const inSec = REPORTS.reports.filter(
        (r) => r.section === key && r.featured !== false && !r.hidden
      );
      if (!inSec.length) return "";
      const label =
        `<${groupHeading} class="group-label"><a href="${escapeHtml(sec.url)}">${escapeHtml(sec.label)}</a></${groupHeading}>`;
      const entries = inSec
        .map((r) => entryHtml({ url: r.url, title: r.title, meta: r.meta || [], paras: r.summary ? [r.summary] : [] }, heading))
        .join("\n");
      return `<section class="report-group">${label}${entries}</section>`;
    })
    .filter(Boolean)
    .join("\n");
}

function listHtml(list) {
  if (list.kind === "section") {
    return sectionListHtml(list.section, list.heading || "h3");
  }
  // featured (optionally grouped by section)
  if (list.group === "section") {
    return featuredGroupHtml(list.groupHeading || "h3", list.heading || "h3");
  }
  const entries = REPORTS.reports
    .filter((r) => r.featured !== false && !r.hidden)
    .map((r) => entryHtml({ url: r.url, title: r.title, meta: r.meta || [], paras: r.summary ? [r.summary] : [] }, list.heading || "h3"))
    .join("\n");
  return `<section class="group">\n${entries}\n      </section>`;
}

// --- page assembly -----------------------------------------------------------

function renderNode(node) {
  const depth = node.out.split("/").length - 1;
  const cssPath = (depth > 0 ? "../".repeat(depth) : "./") + "style.css";
  const crumbsHtml = buildCrumbs(node.trail);
  const crumbsNav = `<nav class="crumbs">\n          ${crumbsHtml}\n        </nav>`;

  const headerParts = [];
  if (!node.crumbsAbove) headerParts.push(`        ${crumbsNav}`);
  if (node.eyebrow) headerParts.push(`        <p class="eyebrow">${escapeHtml(node.eyebrow)}</p>`);
  headerParts.push(`        <h1 class="title">${escapeHtml(node.h1)}</h1>`);
  headerParts.push(`        <p class="subtitle">${escapeHtml(node.subtitle)}</p>`);
  if (node.lede) headerParts.push(`\n        <p class="lede">\n          ${escapeHtml(node.lede)}\n        </p>`);

  const aboveHeader = node.crumbsAbove ? `      ${crumbsNav}\n\n` : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <title>${escapeHtml(node.pageTitle)}</title>
    <meta name="description" content="${escapeHtml(node.description)}">

${FONTS}
    <link rel="stylesheet" href="${cssPath}">
  </head>

  <body class="${node.theme || "dark"}">
    <main class="page">
${aboveHeader}      <header>
${headerParts.join("\n")}
      </header>

      <hr class="rule">

      ${listHtml(node.list)}

      ${siteFooterHtml(node.footerNote)}
    </main>
  </body>
</html>
`;
}

let n = 0;
for (const node of TREE.nodes) {
  const dest = join(ROOT, node.out);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, renderNode(node), "utf8");
  console.log(`  wrote ${node.out}`);
  n++;
}
console.log(`\nindexes: wrote ${n} page(s).`);
