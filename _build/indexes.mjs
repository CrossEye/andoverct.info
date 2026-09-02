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
import { escapeHtml, crumbs as buildCrumbs, pageNoteHtml, siteFooterBarHtml } from "./chrome.js";

const HERE = import.meta.dirname;
const ROOT = join(HERE, "..");

const TREE = JSON.parse(readFileSync(join(HERE, "site-index.json"), "utf8"));
const REPORTS = JSON.parse(readFileSync(join(ROOT, "reports", "reports.json"), "utf8"));
const EDITIONS = JSON.parse(readFileSync(join(ROOT, "the-facts", "editions.json"), "utf8"));

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

function cssPathFor(out) {
  const depth = out.split("/").length - 1;
  return (depth > 0 ? "../".repeat(depth) : "./") + "style.css";
}

// Bespoke content pages (home, reference, tools): the generator owns the head,
// page shell, shared footer and script placement; the authored <main> content
// (masthead + entries) is injected verbatim from a fragment file, so migrating
// these onto the shared chrome can't disturb their hand-written bodies.
function renderContentNode(node) {
  const content = readFileSync(join(ROOT, node.contentFile), "utf8").replace(/\s+$/, "");
  const scripts = node.scriptsFile
    ? "\n" + readFileSync(join(ROOT, node.scriptsFile), "utf8").replace(/\s+$/, "") + "\n"
    : "";
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <title>${escapeHtml(node.pageTitle)}</title>
    <meta name="description" content="${escapeHtml(node.description)}">

${node.fonts || FONTS}
    <link rel="stylesheet" href="${cssPathFor(node.out)}">
  </head>

  <body class="${node.theme || "dark"}">
    <main class="page">
${content}

      ${pageNoteHtml(node.footerNote)}
    </main>
${siteFooterBarHtml()}
${scripts}  </body>
</html>
`;
}

// --- cards layout (the home page) --------------------------------------------

function formatDate(iso) {
  const p = String(iso).split("-");
  if (p.length !== 3) return iso;
  const M = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  const m = parseInt(p[1], 10) - 1;
  return m < 0 || m > 11 ? iso : `${M[m]} ${parseInt(p[2], 10)}, ${p[0]}`;
}

function cardHtml(it) {
  const meta = (it.meta || [])
    .map((x, i) => (it.flag && i === 0) ? `<span class="flag">${escapeHtml(x)}</span>` : escapeHtml(x))
    .join(' <span class="dot">·</span> ');
  return '<article class="card">'
    + (meta ? `<p class="meta">${meta}</p>` : "")
    + `<h3><a href="${escapeHtml(it.href)}">${escapeHtml(it.title)}</a></h3>`
    + (it.desc ? `<p class="desc">${escapeHtml(it.desc)}</p>` : "")
    + "</article>";
}

// A collapsed disclosure, hidden by default. `ordered: true` renders a numbered
// list (for sequences — series parts, guides read in order); otherwise a compact
// chip row (for loose sets like previous editions).
function discloseHtml(d) {
  if (!d) return "";
  let body;
  if (d.ordered) {
    const lis = d.items.map((x) =>
      `<li><a href="${escapeHtml(x.href)}">${escapeHtml(x.title)}</a>${x.gloss ? `<span class="g">${escapeHtml(x.gloss)}</span>` : ""}</li>`
    ).join("\n");
    body = `<ol class="disclose-list">${lis}</ol>`;
  } else {
    const chips = d.items.map((x) =>
      `<a class="chip" href="${escapeHtml(x.href)}"${x.gloss ? ` title="${escapeHtml(x.gloss)}"` : ""}>${escapeHtml(x.title)}</a>`
    ).join("");
    body = `<div class="chip-row">${chips}</div>`;
  }
  return `<details class="disclose"><summary>${escapeHtml(d.label)} <span class="count">${d.items.length}</span></summary>\n${body}</details>`;
}

// A labelled card cluster: a linked heading, a grid of cards, and an optional
// collapsed disclosure. Used both for report families (aes, rham, …) and for
// individual series (town-asset, …) — a section can hold several.
function cardGroupHtml(g) {
  const cards = g.items.map(cardHtml).join("\n");
  return `<div class="cardgroup"><p class="group-label"><a href="${escapeHtml(g.href)}">${escapeHtml(g.label)} <span class="arrow">→</span></a></p>\n`
    + `<div class="cardgrid">${cards}</div>`
    + (g.disclose ? "\n" + discloseHtml(g.disclose) : "")
    + "</div>";
}

// Reports render as one cluster per section, in reports.json order.
function reportsCards() {
  return Object.keys(REPORTS.sections).map((key) => {
    const sec = REPORTS.sections[key];
    const items = REPORTS.reports
      .filter((r) => r.section === key && r.featured !== false && !r.hidden)
      .map((r) => ({ meta: r.meta || [], title: r.title, href: r.url, desc: r.summary || "" }));
    return items.length ? cardGroupHtml({ label: sec.label, href: sec.url, items }) : "";
  }).filter(Boolean).join("\n");
}

// The Facts: the current edition as a card, older ones collapsed below.
function factsCards() {
  const eds = Object.entries(EDITIONS.editions)
    .map(([id, e]) => ({ id, ...e }))
    .filter((e) => !e.hidden)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const hrefFor = (e) => (e.id === EDITIONS.current ? "/the-facts/" : `/the-facts/editions/${e.id}/`);
  const [latest, ...prev] = eds;
  let html = `<div class="cardgrid">${cardHtml({
    meta: ["Current edition", formatDate(latest.date)], flag: true,
    title: latest.title, href: hrefFor(latest), desc: latest.description || latest.subtitle || "",
  })}</div>`;
  if (prev.length) {
    html += discloseHtml({
      label: "Previous editions",
      items: prev.map((e) => ({ title: e.title, gloss: `${formatDate(e.date)}${e.subtitle ? " — " + e.subtitle : ""}`, href: hrefFor(e) })),
    });
  }
  return html;
}

function cardsSectionHtml(s) {
  let body;
  if (s.source === "reports") body = reportsCards();
  else if (s.source === "editions") body = factsCards();
  else {
    body = s.items ? `<div class="cardgrid">${s.items.map(cardHtml).join("\n")}</div>` : "";
    if (s.groups) body += (body ? "\n" : "") + s.groups.map(cardGroupHtml).join("\n");
    if (s.aside) body += `\n<div class="aside-note">${s.aside}</div>`;
    if (s.disclose) body += "\n" + discloseHtml(s.disclose);
  }
  const h2 = s.title
    ? `\n      <h2 class="section-title"><a href="${escapeHtml(s.href)}">${escapeHtml(s.title)} <span class="arrow">→</span></a></h2>`
    : "";
  return `<section class="group" id="sec-${s.id}" data-sec="${s.id}">
      <p class="section-label">§ ${s.num} · ${escapeHtml(s.label)}</p>${h2}
      <p class="section-blurb">${escapeHtml(s.blurb)}</p>
      ${body}
    </section>`;
}

const HOME_SCROLLSPY = `<script>
(function () {
  var rail = document.querySelector('.home-rail'); if (!rail) return;
  var links = {}; [].forEach.call(rail.querySelectorAll('a'), function (l) { links[l.getAttribute('href').slice(5)] = l; });
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      for (var k in links) links[k].classList.remove('on');
      var l = links[e.target.id.slice(4)]; if (l) l.classList.add('on');
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  [].forEach.call(document.querySelectorAll('section.group'), function (s) { io.observe(s); });
})();
</script>`;

// The rail count is what a reader perceives as top-level entries in a section:
// individual reports/editions for those, but the number of series/document groups
// for grouped sections (1 series, not its 2 cards; 2 charter docs, not their parts).
function railCount(s) {
  if (s.source === "reports") return REPORTS.reports.filter((r) => r.featured !== false && !r.hidden).length;
  if (s.source === "editions") return Object.values(EDITIONS.editions).filter((e) => !e.hidden).length;
  if (s.groups) return s.groups.length;
  return s.items ? s.items.length : 0;
}

function renderCardsNode(node) {
  const rail = node.sections
    .map((s) => `<a href="#sec-${s.id}">${escapeHtml(s.label)}<span class="rail-n">${railCount(s)}</span></a>`)
    .join("");
  const sections = node.sections.map(cardsSectionHtml).join("\n");
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
    <link rel="stylesheet" href="${cssPathFor(node.out)}">
  </head>

  <body class="${node.theme || "dark"} home">
    <main class="page">
      <header class="home-mast">
        <p class="eyebrow">${escapeHtml(node.eyebrow)}</p>
        <h1 class="title">${escapeHtml(node.h1)}</h1>
        <p class="lede">${escapeHtml(node.lede)}</p>
      </header>

      <nav class="home-rail" aria-label="Sections">${rail}</nav>

${sections}

      ${pageNoteHtml(node.footerNote)}
    </main>
${siteFooterBarHtml()}
    ${HOME_SCROLLSPY}
  </body>
</html>
`;
}

function renderNode(node) {
  if (node.layout === "cards") return renderCardsNode(node);
  if (node.contentFile) return renderContentNode(node);
  const cssPath = cssPathFor(node.out);
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

      ${pageNoteHtml(node.footerNote)}
    </main>
${siteFooterBarHtml()}
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
