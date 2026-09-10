#!/usr/bin/env node
/*
 * Correspondence-tree builder (plan 008).
 *
 *   npm run rebuild:correspondence
 *   node _build/correspondence.mjs
 *
 * Renders the evidence layer under a living-ledger report: one page per letter,
 * reply, or public statement, plus an index and a machine-readable summary the
 * report itself reads. Modelled on links.mjs — hand-authored YAML under _src/,
 * always a full rebuild, every validation failure a build error, filename stem
 * as the published id.
 *
 * Layout, relative to a report folder carrying `correspondence: <dir>` in its
 * front matter:
 *
 *   correspondence/
 *     _src/<id>.yml            authored descriptors      PUBLISHED
 *     _raw/<id>.headers.txt    full raw email headers    NEVER PUBLISHED
 *     <id>/letter.txt          the message body          PUBLISHED
 *     <id>/index.html          generated
 *     index.html               generated
 *     correspondence.json      generated
 *     published-paths.json     committed path ledger
 *
 * Two rules make the split safe to live with:
 *
 *   _raw never ships. site.manifest.json excludes it and deploy.mjs hard-fails
 *   if a _raw path reaches the upload set, so the exclusion is enforced twice
 *   and by machine.
 *
 *   The public headers are DERIVED from the raw ones through PUBLIC_HEADERS
 *   below, never hand-copied. A hand-made reduction can keep a Received line by
 *   accident; an allowlist cannot.
 *
 * Entry ids are permanent. Published text cites entry directories by path, so
 * published-paths.json records every path ever built and the build fails if one
 * disappears or changes id.
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync,
} from "node:fs";
import { join, resolve, basename } from "node:path";
import { createRequire } from "node:module";
import { load as parseYaml } from "js-yaml";

const require = createRequire(import.meta.url);
const {
  escapeHtml, crumbs: buildCrumbs, banner: pageBanner,
  pageNoteHtml, siteFooterBarHtml, SEP,
} = require("./chrome.js");

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, "..");

const ID_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+-[a-z0-9]+(?:-[0-9]+)?$/;
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIME_RE = /^[0-9]{2}:[0-9]{2}$/;

const KINDS = new Set(["email-sent", "email-received", "public", "press"]);

// Part 3 of the report defines exactly these as answers. "No response" is NOT
// an entry status — it is a ledger state computed from the absence of one — so
// it is deliberately missing here.
const STATUSES = ["Disavowal", "Criticism", "Deflection", "Support"];

// The six headers doing evidentiary work (HANDOFF-correspondence.md). Everything
// else in a raw header block is dropped: Received carries originating IPs, and
// spam scores characterize a sender, which nothing in this tree may do.
const PUBLIC_HEADERS = ["From", "To", "Cc", "Date", "Subject", "Message-ID", "DKIM-Signature"];

// Same-day ties break by the report's ledger order so builds are stable.
const LEDGER = ["fazio", "jennings", "guidone", "weir"];

const CANDIDATE_NAMES = {
  fazio: "Ryan Fazio",
  jennings: "Jenn Jennings",
  guidone: "Jason Guidone",
  weir: "Steve Weir",
};

// ---------------------------------------------------------------------------
// Error collection — every failure is reported before exiting, links.mjs style
// ---------------------------------------------------------------------------

const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);

// ---------------------------------------------------------------------------
// Loading + validation
// ---------------------------------------------------------------------------

function loadEntries(srcDir) {
  if (!existsSync(srcDir)) return [];
  const entries = [];
  for (const name of readdirSync(srcDir).sort()) {
    if (!/\.ya?ml$/.test(name)) continue;
    const file = `_src/${name}`;
    const stem = name.replace(/\.ya?ml$/, "");
    let doc;
    try {
      doc = parseYaml(readFileSync(join(srcDir, name), "utf8"));
    } catch (e) {
      err(file, `YAML parse failed — ${e.message}`);
      continue;
    }
    if (!doc || typeof doc !== "object") {
      err(file, "empty or not a mapping");
      continue;
    }
    if (doc.id && doc.id !== stem) {
      err(file, `id "${doc.id}" does not match filename stem "${stem}"`);
    }
    if (!ID_RE.test(stem)) {
      err(file, `filename must be <YYYY-MM-DD>-<from>-<to>[-N], lowercase; got "${stem}"`);
    }
    entries.push({ ...doc, id: stem, _file: file });
  }
  return entries;
}

function validate(entry, dir) {
  const f = entry._file;

  if (!DATE_RE.test(entry.date || "")) {
    err(f, `date must be YYYY-MM-DD; got ${JSON.stringify(entry.date)}`);
  } else if (Number.isNaN(Date.parse(entry.date))) {
    err(f, `date "${entry.date}" is not a real date`);
  }
  if (entry.time != null && !TIME_RE.test(entry.time)) {
    err(f, `time must be HH:MM (quoted); got ${JSON.stringify(entry.time)}`);
  }
  if (!KINDS.has(entry.kind)) {
    err(f, `kind must be one of ${[...KINDS].join(", ")}; got ${JSON.stringify(entry.kind)}`);
  }
  for (const k of ["from", "to", "title"]) {
    if (!entry[k] || typeof entry[k] !== "string") err(f, `${k} is required`);
  }
  if (entry.candidate != null && !CANDIDATE_NAMES[entry.candidate]) {
    err(f, `candidate must be one of ${Object.keys(CANDIDATE_NAMES).join(", ")}; got ${JSON.stringify(entry.candidate)}`);
  }
  if (entry.status != null && !STATUSES.includes(entry.status)) {
    err(f, `status must be exactly one of ${STATUSES.join(" / ")} — the words Part 3 defines. `
      + `"No response" is a ledger state, not an entry status. Got ${JSON.stringify(entry.status)}`);
  }
  if (entry.status && !entry.candidate) {
    err(f, "status is set but candidate is not — a classified answer must attach to a ledger row");
  }

  // Body: the reading view.
  if (!entry.body) {
    err(f, "body is required (the message file inside the entry directory)");
  } else if (!existsSync(join(dir, entry.id, entry.body))) {
    err(f, `body file not found: ${entry.id}/${entry.body}`);
  }

  const src = entry.source || {};
  const gaps = Array.isArray(entry.gaps) ? entry.gaps : [];

  // Received mail must have headers or a stated reason: the evidentiary question
  // about a reply is whether it really came from the candidate, and that is what
  // headers answer. Sent mail is different — this site is the sender, the letter
  // text is the primary record, and headers add little a reader can act on. So
  // they are welcome on a sent entry but not demanded.
  if (entry.kind === "email-received") {
    const rawPath = join(dir, "_raw", `${entry.id}.headers.txt`);
    if (!existsSync(rawPath) && !gaps.length) {
      err(f, `no _raw/${entry.id}.headers.txt and no gaps: entry explaining why. `
        + "A missing source must be visible to the reader, not a hole they cannot see.");
    }
  }

  // Anything published online: the URL is mandatory, and a missing archive or
  // screenshot must be declared rather than simply absent.
  if (entry.kind === "public" || entry.kind === "press") {
    if (!src.url && !src.pdf) err(f, `kind "${entry.kind}" requires source.url (or source.pdf for a paper)`);
    for (const want of ["archive", "screenshot"]) {
      if (!src[want] && !gaps.length) {
        err(f, `no source.${want} and no gaps: entry explaining why`);
      }
    }
  }

  for (const key of ["screenshot", "pdf"]) {
    if (src[key] && !existsSync(join(dir, entry.id, src[key]))) {
      err(f, `source.${key} not found: ${entry.id}/${src[key]}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Header reduction
// ---------------------------------------------------------------------------

/*
 * Pull the allowlisted headers out of a raw RFC 5322 header block, preserving
 * folded continuation lines (DKIM-Signature is always folded). Returns the
 * reduced block plus the names withheld, so the page can say what it dropped.
 */
export function reduceHeaders(raw) {
  const kept = [];
  const withheld = new Set();
  let keeping = false;

  for (const line of raw.split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) {
      if (keeping) kept.push(line); // folded continuation of a kept header
      continue;
    }
    const m = /^([A-Za-z0-9-]+):/.exec(line);
    if (!m) { keeping = false; continue; }
    const name = m[1];
    keeping = PUBLIC_HEADERS.some((h) => h.toLowerCase() === name.toLowerCase());
    if (keeping) kept.push(line);
    else withheld.add(name);
  }
  return { text: kept.join("\n"), withheld: [...withheld].sort() };
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/*
 * Reverse chronological, newest first. Sorts on the entry's own date field
 * rather than the directory name so a corrected date reorders correctly.
 */
function byNewest(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const at = a.time || "", bt = b.time || "";
  if (at !== bt) return at < bt ? 1 : -1;
  const ai = LEDGER.indexOf(a.candidate), bi = LEDGER.indexOf(b.candidate);
  return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
}

function ledgerOrder(a, b) {
  return LEDGER.indexOf(a.candidate) - LEDGER.indexOf(b.candidate);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// ---------------------------------------------------------------------------
// Path immutability
// ---------------------------------------------------------------------------

/*
 * Published text cites entry directories by path — the four opening letters are
 * linked twice each from the report. A path that has gone out must keep
 * resolving, so every path ever built is recorded and its disappearance is a
 * build error rather than a 404 a reader finds first.
 */
function checkPublishedPaths(dir, ids) {
  const file = join(dir, "published-paths.json");
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { paths: [] };
  const known = new Set(prev.paths || []);
  const now = new Set(ids);

  for (const p of known) {
    if (!now.has(p)) {
      errors.push(`published-paths.json: "${p}" has been published and is cited by path, `
        + "but no _src entry produces it any more. Restore the entry or, if it truly "
        + "never shipped, remove it from published-paths.json by hand.");
    }
  }
  const merged = [...new Set([...known, ...now])].sort();
  writeFileSync(file, JSON.stringify({ paths: merged }, null, 2) + "\n", "utf8");
  return merged;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const LOCAL_CSS = `
.container { max-width: 820px; margin: 0 auto; padding: 28px 24px 8px; line-height: 1.55; }
.container h1 { margin-top: 0; font-size: 1.6rem; }
.entry-meta { color: #5a5348; font-size: .92rem; margin: -6px 0 22px; }
.entry-meta .kind { text-transform: uppercase; letter-spacing: .08em; font-size: .78rem; }
.letter {
  white-space: pre-wrap; font-family: Georgia, "Times New Roman", serif;
  font-size: 1rem; line-height: 1.6; background: #fffdf7;
  border: 1px solid #e3dcc9; border-left: 3px solid #b8942f;
  padding: 20px 24px; margin: 0 0 26px; overflow-wrap: break-word;
}
details.source { border-top: 1px solid #ddd6c4; padding-top: 14px; margin-bottom: 26px; }
details.source > summary {
  cursor: pointer; font-weight: 600; color: #4a4436; padding: 4px 0;
}
details.source pre {
  white-space: pre-wrap; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
  font-size: .82rem; line-height: 1.5; background: #f6f3ea;
  border: 1px solid #e3dcc9; padding: 14px 16px; overflow-x: auto;
}
.withheld { font-size: .86rem; color: #5a5348; margin: 10px 0 0; }
.gaps {
  background: #fdf6e3; border: 1px solid #e3d7ab; border-left: 3px solid #b8942f;
  padding: 12px 16px; margin: 0 0 24px; font-size: .92rem;
}
.gaps strong { display: block; margin-bottom: 4px; }
.gaps ul { margin: 0; padding-left: 20px; }
.entry-list { border-collapse: collapse; width: 100%; margin: 18px 0 28px; font-size: .95rem; }
.entry-list th, .entry-list td { padding: 8px 12px; border-bottom: 1px solid #e3dcc9; text-align: left; vertical-align: top; }
.entry-list th { background: #f5f2e8; font-weight: 600; }
.entry-list td.date { white-space: nowrap; }
.pinned { color: #5a5348; font-size: .92rem; }
`;

function shell({ title, crumbsHtml, body, note, baseCss, themeCss, noindex }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${noindex ? '\n<meta name="robots" content="noindex">' : ""}
<title>${escapeHtml(title)}</title>
<style>${baseCss}
${themeCss}
${LOCAL_CSS}</style>
</head>
<body>
${pageBanner(crumbsHtml)}
<main class="container">
${body}
${pageNoteHtml(note)}
</main>
${siteFooterBarHtml()}
</body>
</html>`;
}

function gapsHtml(gaps) {
  if (!gaps || !gaps.length) return "";
  return `<div class="gaps"><strong>What is missing from this entry</strong>\n<ul>`
    + gaps.map((g) => `<li>${escapeHtml(g)}</li>`).join("\n")
    + `</ul></div>`;
}

function sourceHtml(entry, dir) {
  const src = entry.source || {};
  const parts = [];

  if (entry.kind.startsWith("email")) {
    const rawPath = join(dir, "_raw", `${entry.id}.headers.txt`);
    if (existsSync(rawPath)) {
      const { text, withheld } = reduceHeaders(readFileSync(rawPath, "utf8"));
      parts.push(`<pre>${escapeHtml(text)}</pre>`);
      const note = withheld.length
        ? `The headers doing evidentiary work are shown. ${withheld.length} other header `
          + `${withheld.length === 1 ? "field was" : "fields were"} withheld — routing records, `
          + "which carry originating IP addresses, and spam-filter scores, which characterize a "
          + "sender. The full block is retained and will be produced if the authenticity of this "
          + "message is disputed."
        : "";
      if (note) parts.push(`<p class="withheld">${note}</p>`);
      parts.push(`<p class="withheld"><em>A DKIM signature is strong evidence that a message `
        + `arrived as sent, not proof: verifying one needs the body byte-exact and the sending `
        + `domain's key still published, and campaign keys rotate.</em></p>`);
    }
  }

  const links = [];
  if (src.url) links.push(`<a href="${escapeHtml(src.url)}">Original</a>`);
  if (src.archive) links.push(`<a href="${escapeHtml(src.archive)}">Archived copy</a>`);
  if (src.screenshot) links.push(`<a href="${escapeHtml(src.screenshot)}">Screenshot</a>`);
  if (src.pdf) links.push(`<a href="${escapeHtml(src.pdf)}">PDF</a>`);
  if (links.length) parts.push(`<p>${links.join(" · ")}</p>`);

  if (!parts.length) return "";
  return `<details class="source">\n<summary>Source</summary>\n${parts.join("\n")}\n</details>`;
}

function entryPage(entry, dir, ctx) {
  const bodyText = readFileSync(join(dir, entry.id, entry.body), "utf8");
  const crumbsHtml = buildCrumbs([
    ...ctx.trail,
    { label: "Correspondence", href: ctx.correspondenceUrl },
    { label: entry.title },
  ]);

  const kindLabel = {
    "email-sent": "Email sent", "email-received": "Email received",
    public: "Published statement", press: "Newspaper",
  }[entry.kind];

  const meta = [
    `<span class="kind">${escapeHtml(kindLabel)}</span>`,
    escapeHtml(longDate(entry.date)),
    entry.status ? `Classified as <strong>${escapeHtml(entry.status)}</strong>` : "",
  ].filter(Boolean).join(" &middot; ");

  const body = [
    `<h1>${escapeHtml(entry.title)}</h1>`,
    `<p class="entry-meta">${meta}</p>`,
    gapsHtml(entry.gaps),
    `<pre class="letter">${escapeHtml(bodyText.trim())}</pre>`,
    sourceHtml(entry, dir),
    `<p><a href="${ctx.correspondenceUrl}">&larr; All correspondence</a></p>`,
  ].filter(Boolean).join("\n");

  return shell({
    title: `${entry.title} — ${ctx.reportTitle}`,
    crumbsHtml, body, note: ctx.note,
    baseCss: ctx.baseCss, themeCss: ctx.themeCss, noindex: ctx.noindex,
  });
}

function indexPage(entries, ctx) {
  const crumbsHtml = buildCrumbs([...ctx.trail, { label: "Correspondence" }]);

  const opening = entries.filter((e) => e.opening).sort(ledgerOrder);
  const rest = entries.filter((e) => !e.opening).sort(byNewest);

  const row = (e) => `<tr>
  <td class="date">${escapeHtml(longDate(e.date))}</td>
  <td><a href="${e.id}/">${escapeHtml(e.title)}</a>${e.summary ? `<br><span class="pinned">${escapeHtml(e.summary)}</span>` : ""}</td>
  <td>${escapeHtml(e.status || "—")}</td>
</tr>`;

  const table = (rows) => `<table class="entry-list">
<thead><tr><th>Date</th><th>Item</th><th>Classification</th></tr></thead>
<tbody>
${rows.map(row).join("\n")}
</tbody>
</table>`;

  const body = [
    `<h1>Correspondence</h1>`,
    `<p>Every letter, reply, and public answer relating to the question put to four `
      + `candidates on September 10, 2026, newest first. Each entry carries the message `
      + `as formatted for reading, with its source alongside. Replies are published in `
      + `full and unedited.</p>`,
    rest.length
      ? `<h2>Since the opening letters</h2>\n${table(rest)}`
      : `<h2>Since the opening letters</h2>\n<p class="pinned">As of ${escapeHtml(longDate(ctx.asOf))}, `
        + `nothing has arrived beyond the four opening letters below.</p>`,
    `<h2>The opening letters</h2>`,
    `<p class="pinned">Sent the same day, in the same words, but for the salutation and the `
      + `sentence identifying the district.</p>`,
    table(opening),
    `<p><a href="../">&larr; Back to the report</a></p>`,
  ].join("\n");

  return shell({
    title: `Correspondence — ${ctx.reportTitle}`,
    crumbsHtml, body, note: ctx.note,
    baseCss: ctx.baseCss, themeCss: ctx.themeCss, noindex: ctx.noindex,
  });
}

// ---------------------------------------------------------------------------
// The ledger summary the report reads
// ---------------------------------------------------------------------------

/*
 * Per candidate the newest entry carrying a status wins; none means "No
 * response", reported as of a date and never as a permanent condition.
 */
function buildLedger(entries, asOf) {
  return LEDGER.map((id) => {
    const mine = entries.filter((e) => e.candidate === id).sort(byNewest);
    const asked = mine.filter((e) => e.opening)[0] || null;
    const answer = mine.find((e) => e.status) || null;
    return {
      candidate: id,
      name: CANDIDATE_NAMES[id],
      asked: asked ? { date: asked.date, path: `${asked.id}/` } : null,
      answered: answer ? { date: answer.date, path: `${answer.id}/` } : null,
      status: answer ? answer.status : "No response",
      asOf,
    };
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// The report's section crumb, read from the same reports.json the report reads,
// so the two trails cannot drift.
function sectionCrumb(meta) {
  if (!meta.section) return null;
  const path = join(ROOT, "reports", "reports.json");
  if (!existsSync(path)) return null;
  const sec = JSON.parse(readFileSync(path, "utf8")).sections?.[meta.section];
  return sec ? { label: sec.label, href: sec.url } : null;
}

export function buildCorrespondence(folder, meta, opts = {}) {
  const dirName = typeof meta.correspondence === "string" ? meta.correspondence : "correspondence";
  const dir = resolve(folder, dirName);
  if (!existsSync(dir)) throw new Error(`correspondence dir not found: ${dir}`);

  errors.length = 0;

  const entries = loadEntries(join(dir, "_src"));
  if (!entries.length) errors.push(`${dirName}/_src: no entry descriptors found`);
  for (const e of entries) validate(e, dir);

  if (errors.length) {
    console.error(`\n  correspondence: ${errors.length} problem${errors.length === 1 ? "" : "s"}\n`);
    for (const e of errors) console.error(`    - ${e}`);
    console.error("");
    throw new Error("correspondence build failed validation");
  }

  // Local date, not UTC: a build run on a US evening must not stamp tomorrow's
  // date on a page whose whole claim is "this is what had arrived on this day".
  const asOf = opts.asOf || (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  // Root-relative hrefs, matching the report's own trail (report.mjs
  // breadcrumbHtml). Relative ones would need a different prefix at each depth,
  // and the index and entry pages sit one level apart.
  const reportUrl = new URL(meta.publicUrl).pathname.replace(/\/?$/, "/");
  const ctx = {
    trail: opts.trail || [
      { label: "Home", href: "/" },
      { label: "Reports", href: "/reports/" },
      ...(sectionCrumb(meta) ? [sectionCrumb(meta)] : []),
      { label: meta.title, href: reportUrl },
    ],
    correspondenceUrl: `${reportUrl}${dirName}/`,
    reportTitle: meta.title || "Report",
    baseCss: opts.baseCss || "",
    themeCss: opts.themeCss || "",
    note: opts.note || "",
    noindex: meta.noindex === true,
    asOf,
  };

  checkPublishedPaths(dir, entries.map((e) => e.id));
  if (errors.length) {
    for (const e of errors) console.error(`    - ${e}`);
    throw new Error("correspondence build failed validation");
  }

  for (const entry of entries) {
    const out = join(dir, entry.id, "index.html");
    mkdirSync(join(dir, entry.id), { recursive: true });
    writeFileSync(out, entryPage(entry, dir, ctx), "utf8");
  }
  writeFileSync(join(dir, "index.html"), indexPage(entries, ctx), "utf8");

  const summary = {
    generated: asOf,
    entries: entries.sort(byNewest).map((e) => ({
      id: e.id, date: e.date, time: e.time || null, kind: e.kind,
      title: e.title, summary: e.summary || null, candidate: e.candidate || null,
      status: e.status || null, opening: e.opening === true, path: `${e.id}/`,
    })),
    ledger: buildLedger(entries, asOf),
  };
  writeFileSync(join(dir, "correspondence.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");

  console.log(`  correspondence: ${entries.length} entr${entries.length === 1 ? "y" : "ies"} `
    + `-> ${dirName}/ (index + correspondence.json, as of ${asOf})`);
  return summary;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (process.argv[1] && basename(process.argv[1]) === "correspondence.mjs") {
  const matter = (await import("gray-matter")).default;
  const targets = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (!targets.length) {
    console.error("usage: node _build/correspondence.mjs <report.md> [...]");
    process.exit(1);
  }
  const baseCss = readFileSync(join(HERE, "base.css"), "utf8");
  for (const t of targets) {
    const mdPath = resolve(ROOT, t);
    const { data: meta } = matter(readFileSync(mdPath, "utf8"));
    const folder = resolve(mdPath, "..");
    const themeName = meta.theme || "default";
    const themePath = join(HERE, "themes", `${themeName}.css`);
    const defaultTheme = readFileSync(join(HERE, "themes", "default.css"), "utf8");
    const themeCss = themeName === "default" || !existsSync(themePath)
      ? defaultTheme
      : defaultTheme + "\n" + readFileSync(themePath, "utf8");
    buildCorrespondence(folder, meta, { baseCss, themeCss });
  }
}
