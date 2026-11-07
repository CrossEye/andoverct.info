#!/usr/bin/env node
/*
 * Printable site map (/site-map.html).
 *
 * A print-first page listing everything the home page links to, in the home
 * page's own order — the six sections, each landing page, every card, and the
 * items in the collapsed disclosures (charter guides, series parts, previous
 * editions). The Facts lists every edition, not just the current one. Each
 * entry carries a readable URL and a QR code so a handout or a poster can send
 * a reader straight to a page.
 *
 * The data comes from the same registries the home page is rendered from
 * (_build/site-index.json's `index.html` node, reports/reports.json,
 * the-facts/editions.json, opinion/opinion.json), so the two can't drift.
 * QR codes are inline SVG generated at build time by the `qrcode` package.
 *
 *   npm run rebuild:site-map   (node _build/site-map.mjs)
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import QRCode from "qrcode"
import { escapeHtml, siteFooterBarHtml, pieceMeta } from "./chrome.js"

const HERE = import.meta.dirname
const ROOT = join(HERE, "..")
const ORIGIN = "https://andoverct.info"
const OUT = "site-map.html"

const TREE = JSON.parse(readFileSync(join(HERE, "site-index.json"), "utf8"))
const REPORTS = JSON.parse(readFileSync(join(ROOT, "reports", "reports.json"), "utf8"))
const EDITIONS = JSON.parse(readFileSync(join(ROOT, "the-facts", "editions.json"), "utf8"))
const OPINION = JSON.parse(readFileSync(join(ROOT, "opinion", "opinion.json"), "utf8"))

const HOME = TREE.nodes.find((n) => n.out === "index.html")

const FONTS = `    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">`

// --- data -------------------------------------------------------------------

const absolute = (href) => (/^https?:\/\//.test(href) ? href : ORIGIN + href)

// The URL as a person reads it off paper: no scheme, no trailing slash on the
// apex alone, everything else kept so it can be typed back in exactly.
const readable = (href) => absolute(href).replace(/^https?:\/\//, "").replace(/\/$/, "")

const formatDate = (iso) => {
  const [y, m, d] = String(iso).split("-").map((x) => parseInt(x, 10))
  const M = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"]
  return m >= 1 && m <= 12 ? `${M[m - 1]} ${d}, ${y}` : iso
}

const editionHref = (id) => (id === EDITIONS.current ? "/the-facts/" : `/the-facts/editions/${id}/`)

// Every visible edition, newest first, as cards — the current one flagged.
const factsEntries = () =>
  Object.entries(EDITIONS.editions)
    .map(([id, e]) => ({ id, ...e }))
    .filter((e) => !e.hidden)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((e) => ({
      meta: [e.id === EDITIONS.current ? "Current edition" : "Edition", formatDate(e.date)],
      flag: e.id === EDITIONS.current,
      title: e.title,
      sub: e.subtitle,
      href: editionHref(e.id),
      desc: e.description || "",
    }))

// Reports: one group per section, in reports.json order, featured only (as on
// the home page).
const reportGroups = () =>
  Object.entries(REPORTS.sections)
    .map(([key, sec]) => ({
      label: sec.label,
      href: sec.url,
      items: REPORTS.reports
        .filter((r) => r.section === key && r.featured !== false && !r.hidden)
        .map((r) => ({ meta: r.meta || [], title: r.title, href: r.url, desc: r.summary || "" })),
    }))
    .filter((g) => g.items.length)

const opinionEntries = () =>
  OPINION.pieces
    .filter((p) => !p.hidden)
    .map((p) => ({ meta: pieceMeta(p), title: p.title, href: p.url, desc: p.summary || "" }))

// Normalise a home-page section into { cards, groups } where every group is
// { label, href, items, disclose }.
const sectionData = (s) => {
  if (s.source === "editions") return { cards: factsEntries(), groups: [] }
  if (s.source === "reports") return { cards: [], groups: reportGroups() }
  if (s.source === "opinion") return { cards: opinionEntries(), groups: [] }
  return { cards: s.items || [], groups: s.groups || [] }
}

// --- QR codes ---------------------------------------------------------------

// Medium error correction survives a slightly smudged print; zero margin
// because the card supplies the quiet zone as padding.
const qrSvg = async (href) => {
  const svg = await QRCode.toString(absolute(href), {
    type: "svg", errorCorrectionLevel: "M", margin: 0,
  })
  return svg
    .replace(/<svg /, `<svg role="img" aria-label="QR code for ${escapeHtml(readable(href))}" `)
    .replace(/ width="\d+" height="\d+"/, "")
}

// --- rendering --------------------------------------------------------------

// A readable URL wraps at its slashes, never mid-word: a <wbr> after each
// slash gives the browser a break point it will take before resorting to
// overflow-wrap.
const breakable = (href) => escapeHtml(readable(href)).replace(/\//g, "/<wbr>")

const urlHtml = (href) => `<a class="url" href="${escapeHtml(absolute(href))}">${breakable(href)}</a>`

const cardHtml = async (it) => {
  const meta = (it.meta || [])
    .map((x, i) => (it.flag && i === 0) ? `<span class="flag">${escapeHtml(x)}</span>` : escapeHtml(x))
    .join(' <span class="dot">·</span> ')
  return `<article class="sm-card">
<div class="qr">${await qrSvg(it.href)}</div>
<div class="body">
${meta ? `<p class="meta">${meta}</p>\n` : ""}<h3><a href="${escapeHtml(absolute(it.href))}">${escapeHtml(it.title)}</a></h3>
${it.sub ? `<p class="sub">${escapeHtml(it.sub)}</p>\n` : ""}${urlHtml(it.href)}
${it.desc ? `<p class="desc">${escapeHtml(it.desc)}</p>` : ""}
</div>
</article>`
}

const cardsHtml = async (items) =>
  (await Promise.all(items.map(cardHtml))).join("\n")

// The collapsed lists on the home page (series parts, charter guides) become
// compact rows: small QR, title, URL — the parent card already explains them.
const rowHtml = async (x, i, ordered) => `<li class="sm-row">
<div class="qr">${await qrSvg(x.href)}</div>
<div class="body">
<p class="row-title">${ordered ? `<span class="n">${i + 1}.</span> ` : ""}<a href="${escapeHtml(absolute(x.href))}">${escapeHtml(x.title)}</a></p>
${urlHtml(x.href)}
${x.gloss ? `<p class="gloss">${escapeHtml(x.gloss)}</p>` : ""}
</div>
</li>`

const discloseHtml = async (d) => {
  if (!d) return ""
  const rows = (await Promise.all(d.items.map((x, i) => rowHtml(x, i, d.ordered)))).join("\n")
  const tag = d.ordered ? "ol" : "ul"
  return `<div class="sm-list">
<p class="list-label">${escapeHtml(d.label)}</p>
<${tag} class="rows">
${rows}
</${tag}>
</div>`
}

const groupHtml = async (g) => `<div class="sm-group">
<p class="group-label"><a href="${escapeHtml(absolute(g.href))}">${escapeHtml(g.label)}</a> <span class="url-inline">${breakable(g.href)}</span></p>
<div class="sm-grid">
${await cardsHtml(g.items)}
</div>
${await discloseHtml(g.disclose)}
</div>`

const sectionHtml = async (s) => {
  const { cards, groups } = sectionData(s)
  const landing = s.href
  return `<section class="sm-section" id="sec-${s.id}">
<header class="sm-head">
<div class="qr">${await qrSvg(landing)}</div>
<div class="body">
<p class="section-label">§ ${s.num} · ${escapeHtml(s.label)}</p>
<h2>${escapeHtml(s.title || s.label)}</h2>
${urlHtml(landing)}
<p class="blurb">${escapeHtml(s.blurb)}</p>
</div>
</header>
${cards.length ? `<div class="sm-grid">\n${await cardsHtml(cards)}\n</div>` : ""}
${(await Promise.all(groups.map(groupHtml))).join("\n")}
</section>`
}

const STYLE = `
    /* ——— Site map: shared tokens, its own layout ——— */
    body.site-map .page { max-width: 64rem; padding-top: 2.5rem; }

    .sm-mast { display: grid; grid-template-columns: 1fr auto; gap: 1.5rem; align-items: start; }
    .sm-mast .qr { width: 7.5rem; }
    .sm-mast .title { margin-bottom: 0.25rem; }
    .sm-mast .url { font-size: 1rem; }
    .sm-mast .lede { margin-top: 0.75rem; }
    .print-hint {
      font-family: var(--sans); font-size: 0.85rem; color: var(--ink-mute);
      margin: 1.25rem 0 0; padding: 0.6rem 0.9rem;
      border: 1px solid var(--rule); border-radius: 8px; background: var(--bg-card);
    }
    .print-btn {
      font: inherit; font-weight: 600; color: var(--ink); background: var(--accent-bg);
      border: 1px solid var(--rule); border-radius: 999px; padding: 0.15rem 0.8rem;
      margin: 0 0.35rem; cursor: pointer;
    }
    .print-btn:hover { border-color: var(--accent); }

    .qr { flex: 0 0 auto; background: var(--bg-card); }
    .qr svg { display: block; width: 100%; height: auto; }

    /* Readable URLs — sans, slightly spaced, broken only at slashes */
    .url, .url-inline {
      font-family: var(--sans); font-size: 0.8rem; letter-spacing: 0.01em;
      color: var(--ink-mute); overflow-wrap: break-word;
    }
    .url { display: block; border-bottom: none; margin: 0.15rem 0 0; }
    .url:hover { color: var(--accent); }
    .url-inline { font-weight: 400; margin-left: 0.6em; }

    .sm-section { margin: 3rem 0 0; break-inside: auto; }
    .sm-head {
      display: flex; gap: 1.25rem; align-items: flex-start;
      padding-bottom: 1rem; border-bottom: 2px solid var(--accent);
      break-inside: avoid; break-after: avoid;
    }
    .sm-head .qr { width: 6rem; }
    .sm-head .section-label { margin: 0 0 0.25rem; }
    .sm-head h2 {
      font-family: var(--serif); font-weight: 600; font-size: 1.6rem; line-height: 1.2;
      margin: 0; color: var(--ink);
    }
    .sm-head .blurb { color: var(--ink-soft); font-size: 0.95rem; margin: 0.6rem 0 0; }

    .sm-group { margin-top: 1.5rem; }
    .sm-group > .group-label {
      margin: 0 0 0.75rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--rule);
      break-after: avoid;
    }
    .sm-group > .group-label a { color: var(--ink); border-bottom: none; }

    .sm-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(21rem, 1fr));
      gap: 0.85rem; margin: 1rem 0 0;
    }
    .sm-card {
      display: flex; gap: 0.9rem; align-items: flex-start;
      background: var(--bg-card); border: 1px solid var(--rule); border-radius: 12px;
      padding: 0.9rem 1rem;
      break-inside: avoid; page-break-inside: avoid;
    }
    .sm-card .qr { width: 5.5rem; }
    .sm-card .body { min-width: 0; }
    .sm-card .meta {
      font-family: var(--sans); font-size: 0.68rem; letter-spacing: 0.07em;
      text-transform: uppercase; color: var(--ink-mute); margin: 0 0 0.3rem;
    }
    .sm-card .meta .dot { margin: 0 0.4em; opacity: 0.5; }
    .sm-card .meta .flag { color: var(--accent); font-weight: 600; }
    .sm-card h3 {
      font-family: var(--serif); font-weight: 600; font-size: 1.05rem; line-height: 1.28;
      margin: 0; color: var(--ink);
    }
    .sm-card h3 a { color: var(--ink); border-bottom: none; }
    .sm-card h3 a:hover { color: var(--accent); }
    .sm-card .sub { font-style: italic; color: var(--ink-soft); font-size: 0.9rem; margin: 0.1rem 0 0; }
    .sm-card .desc {
      color: var(--ink-soft); font-size: 0.86rem; line-height: 1.45; margin: 0.45rem 0 0;
      display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
    }

    .sm-list { margin: 1rem 0 0; }
    .sm-list .list-label {
      font-family: var(--sans); font-size: 0.75rem; letter-spacing: 0.12em;
      text-transform: uppercase; color: var(--ink-mute); font-weight: 500;
      margin: 0 0 0.5rem; break-after: avoid;
    }
    .sm-list .rows {
      list-style: none; margin: 0; padding: 0;
      display: grid; grid-template-columns: repeat(auto-fill, minmax(21rem, 1fr));
      gap: 0.5rem 1.25rem;
    }
    .sm-row {
      display: flex; gap: 0.7rem; align-items: flex-start;
      padding: 0.45rem 0; border-top: 1px solid var(--rule-soft);
      break-inside: avoid; page-break-inside: avoid;
    }
    .sm-row .qr { width: 3.25rem; }
    .sm-row .body { min-width: 0; }
    .sm-row .row-title { margin: 0; font-weight: 600; font-size: 0.95rem; line-height: 1.3; }
    .sm-row .row-title a { color: var(--ink); border-bottom: none; }
    .sm-row .row-title a:hover { color: var(--accent); }
    .sm-row .row-title .n { color: var(--ink-mute); font-weight: 400; font-family: var(--sans); font-size: 0.85em; }
    .sm-row .url { font-size: 0.74rem; margin-top: 0.05rem; }
    .sm-row .gloss { color: var(--ink-soft); font-size: 0.8rem; line-height: 1.4; margin: 0.2rem 0 0; }

    @media (max-width: 560px) {
      .sm-mast { grid-template-columns: 1fr; }
      .sm-mast .qr { width: 6rem; }
    }

    @media print {
      @page { size: letter; margin: 0.6in 0.6in 0.7in; }
      html { font-size: 11pt; }
      body.site-map { background: none; color: var(--ink); }
      body.site-map .page { max-width: none; padding: 0; }
      body.site-map a { color: inherit; border-bottom: none; }
      .print-hint { display: none; }

      .sm-mast { grid-template-columns: 1fr auto; }
      .sm-mast .qr { width: 1.3in; }
      h1.title { font-size: 22pt; }
      .lede { font-size: 10pt; }

      .sm-section { margin-top: 0.35in; }
      .sm-head { gap: 0.2in; padding-bottom: 0.12in; border-bottom-width: 1.5pt; }
      .sm-head .qr { width: 1in; }
      .sm-head h2 { font-size: 15pt; }
      .sm-head .blurb { font-size: 9pt; }

      .sm-grid, .sm-list .rows { grid-template-columns: 1fr 1fr; gap: 0.12in 0.18in; }
      .sm-card { border-radius: 4pt; padding: 0.12in 0.14in; gap: 0.14in; background: none; }
      .sm-card .qr { width: 0.95in; }
      .sm-card h3 { font-size: 10.5pt; }
      .sm-card .desc { font-size: 8pt; line-height: 1.35; -webkit-line-clamp: 4; }
      .sm-card .meta { font-size: 6.5pt; }
      .sm-card .sub { font-size: 8.5pt; }
      .url { font-size: 8pt; color: var(--ink-soft); }
      .url-inline { font-size: 8pt; }

      .sm-row { padding: 0.06in 0; gap: 0.1in; }
      .sm-row .qr { width: 0.6in; }
      .sm-row .row-title { font-size: 9pt; }
      .sm-row .url { font-size: 7.5pt; }
      .sm-row .gloss { font-size: 7.5pt; }

      .qr { background: none; }
      .site-footer { margin-top: 0.3in; font-size: 7.5pt; }
    }`

const render = async () => {
  const sections = (await Promise.all(HOME.sections.map(sectionHtml))).join("\n\n")
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <title>Site Map — andoverct.info</title>
    <meta name="description" content="A printable map of andoverct.info: every section, report, edition, guide and resource linked from the home page, with readable URLs and QR codes.">

${FONTS}
    <link rel="stylesheet" href="./style.css">
    <style>${STYLE}
    </style>
  </head>

  <body class="bluegold site-map">
    <main class="page">
      <header class="sm-mast">
        <div class="body">
          <p class="eyebrow">${escapeHtml(HOME.eyebrow)}</p>
          <h1 class="title">Site Map</h1>
          ${urlHtml("/")}
          <p class="lede">Everything linked from the ${escapeHtml(HOME.h1)} home page, in the same order, with a QR code and a readable address for each. Scan a code with a phone camera, or type the address into a browser.</p>
          <p class="print-hint">Print this page for a handout <button type="button" class="print-btn" onclick="window.print()">Print</button> Cards are kept whole across page breaks.</p>
        </div>
        <div class="qr">${await qrSvg("/")}</div>
      </header>

${sections}

    </main>
${siteFooterBarHtml()}
  </body>
</html>
`
}

writeFileSync(join(ROOT, OUT), await render(), "utf8")
console.log(`site-map: wrote ${OUT}`)
