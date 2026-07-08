#!/usr/bin/env node
/*
 * Link-registry builder.
 *
 * Renders the hand-authored YAML docs under links/_src/ into static pages at
 * links/<id>/index.html plus a links/index.html listing every collection.
 * Always a full rebuild (list and index pages depend on every leaf):
 *
 *   npm run rebuild:links
 *   node _build/links.mjs
 *
 * Two doc shapes, distinguished by their keys:
 *   leaf  — { id, title, description, url, image?, date?, archived? }
 *   list  — { id, title, description, image?, groups | links }
 * where groups is an ordered array of { title, description?, links } and a
 * top-level links array is an untitled single group. Link arrays reference
 * other docs by id (= filename stem).
 *
 * Lists never nest: a reference to another list renders as a plain link card
 * pointing at that list's own page, which structurally rules out recursion.
 * Every referenced doc must exist; any validation failure is a build error,
 * and all errors across all files are reported before exiting.
 *
 * Body hrefs stay root-relative (a local test vhost sees its own copies);
 * only og:url / og:image / rel=canonical are absolutized, using the
 * "siteOrigin" value from _build/report.config.json.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { load as parseYaml } from "js-yaml";

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, "..");
const SRC_DIR = join(ROOT, "links", "_src");
const OUT_DIR = join(ROOT, "links");

const ID_RE = /^[A-Za-z0-9_-]+$/;
const URL_RE = /^(https?:\/\/|\/)/; // external or root-relative internal
const EXT_RE = /^https?:\/\//;

const BASE_CSS = readFileSync(join(HERE, "base.css"), "utf8");

// Registry-specific chrome, layered onto the shared theme + base.css.
const LINKS_CSS = `
.link-card {
    border: 1px solid var(--rule);
    background: var(--bg);
    border-radius: 4px;
    padding: 14px 18px;
    margin: 0 0 14px 0;
    scroll-margin-top: 16px;
}
.link-card:target {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
}
.link-card-title {
    font-family: var(--font-sans);
    font-size: 12pt;
    font-weight: 700;
    margin: 0;
}
.link-card-title .ext-mark {
    margin-left: 0.35em;
    font-size: 9pt;
    color: var(--ink-faint);
}
.link-card-desc {
    margin: 6px 0 0 0;
    font-size: 10.5pt;
    color: var(--ink-soft);
}
.link-card-meta {
    font-family: var(--font-sans);
    margin: 8px 0 0 0;
    font-size: 9pt;
    color: var(--ink-faint);
}
.link-group-desc {
    color: var(--ink-mute);
    margin: 0 0 14px 0;
}
.links-count {
    font-family: var(--font-sans);
    margin-top: 28px;
    font-size: 9pt;
    color: var(--ink-faint);
}
`;

// ---------------------------------------------------------------------------
// Helpers shared with report.mjs (copied — report.mjs exports nothing)
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loadConfig() {
  const p = join(HERE, "report.config.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function loadTheme(name) {
  const dir = join(HERE, "themes");
  const base = readFileSync(join(dir, "default.css"), "utf8");
  if (!name || name === "default") return base;
  const p = join(dir, `${name}.css`);
  if (!existsSync(p)) throw new Error(`theme "${name}" not found: ${p}`);
  return base + "\n" + readFileSync(p, "utf8");
}

// ---------------------------------------------------------------------------
// Load + validate sources
// ---------------------------------------------------------------------------

// Structural validation of one parsed YAML doc. Returns error strings; an
// empty array means the doc is safe to normalize.
function validateDoc(raw, stem, rel) {
  const errs = [];
  const err = (m) => errs.push(`${rel}: ${m}`);

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    err("document must be a YAML mapping");
    return errs;
  }
  if (raw.id === undefined) err(`missing "id"`);
  else if (String(raw.id) !== stem) err(`id "${raw.id}" does not match filename`);

  const shapeKeys = ["url", "groups", "links"].filter((k) => raw[k] !== undefined);
  if (shapeKeys.length !== 1) {
    err(
      `must be a leaf ("url") or a list ("groups" or "links"); found: ` +
        (shapeKeys.join(", ") || "none")
    );
    return errs;
  }
  const kind = shapeKeys[0] === "url" ? "leaf" : "list";

  const allowed =
    kind === "leaf"
      ? ["id", "title", "description", "url", "image", "date", "archived"]
      : ["id", "title", "description", "image", "groups", "links"];
  for (const k of Object.keys(raw)) {
    if (!allowed.includes(k)) err(`unknown key "${k}"`);
  }

  const nonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
  if (!nonEmptyString(raw.title)) err(`"title" must be a non-empty string`);
  if (!nonEmptyString(raw.description)) err(`"description" must be a non-empty string`);
  if (raw.image !== undefined && !(typeof raw.image === "string" && URL_RE.test(raw.image)))
    err(`"image" must start with "/" or "http(s)://"`);

  if (kind === "leaf") {
    if (!(typeof raw.url === "string" && URL_RE.test(raw.url)))
      err(`"url" must start with "/" (internal) or "http(s)://" (external)`);
    if (
      raw.archived !== undefined &&
      !(typeof raw.archived === "string" && EXT_RE.test(raw.archived))
    )
      err(`"archived" must be an http(s) URL`);
    if (raw.date !== undefined) {
      // js-yaml parses a bare YYYY-MM-DD into a JS Date; accept either form.
      const ok =
        raw.date instanceof Date
          ? !isNaN(raw.date)
          : typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date);
      if (!ok) err(`"date" must be YYYY-MM-DD`);
    }
    return errs;
  }

  const checkLinks = (arr, where) => {
    if (!Array.isArray(arr) || arr.length === 0) {
      err(`${where} must be a non-empty array of ids`);
      return;
    }
    for (const x of arr) {
      if (!ID_RE.test(String(x))) err(`${where} contains invalid id "${x}"`);
    }
  };

  if (raw.groups !== undefined) {
    if (!Array.isArray(raw.groups) || raw.groups.length === 0) {
      err(`"groups" must be a non-empty array`);
      return errs;
    }
    raw.groups.forEach((g, i) => {
      const where = `groups[${i}]`;
      if (!g || typeof g !== "object" || Array.isArray(g)) {
        err(`${where} must be a mapping`);
        return;
      }
      for (const k of Object.keys(g)) {
        if (!["title", "description", "links"].includes(k))
          err(`${where}: unknown key "${k}"`);
      }
      if (!nonEmptyString(g.title)) err(`${where}: "title" must be a non-empty string`);
      if (g.description !== undefined && !nonEmptyString(g.description))
        err(`${where}: "description" must be a non-empty string`);
      checkLinks(g.links, `${where}.links`);
    });
  } else {
    checkLinks(raw.links, `"links"`);
  }
  return errs;
}

// A validated doc, reshaped for rendering: ids stringified, dates formatted,
// and an ungrouped links array folded into a single untitled group.
function normalizeDoc(raw, stem) {
  const kind = raw.url !== undefined ? "leaf" : "list";
  const doc = {
    id: stem,
    kind,
    title: raw.title.trim(),
    description: raw.description.trim(),
  };
  if (raw.image) doc.image = raw.image;
  if (kind === "leaf") {
    doc.url = raw.url;
    if (raw.archived) doc.archived = raw.archived;
    if (raw.date !== undefined)
      doc.date =
        raw.date instanceof Date ? raw.date.toISOString().slice(0, 10) : raw.date;
  } else {
    doc.groups = raw.groups
      ? raw.groups.map((g) => ({
          title: g.title.trim(),
          description: g.description ? g.description.trim() : undefined,
          links: g.links.map(String),
        }))
      : [{ links: raw.links.map(String) }];
  }
  return doc;
}

// Reads every links/_src/*.yaml into a Map<id, doc>, pushing all problems
// (bad filename, parse failure, schema violation, dangling reference) onto
// `errors` so the caller can report the whole batch at once.
function loadDocs(errors) {
  if (!existsSync(SRC_DIR)) throw new Error(`source directory not found: ${SRC_DIR}`);
  const docs = new Map();
  const files = readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
  for (const file of files) {
    const rel = `links/_src/${file}`;
    const stem = file.slice(0, -".yaml".length);
    if (!ID_RE.test(stem)) {
      errors.push(`${rel}: filename id "${stem}" must be letters/digits/_/- only`);
      continue;
    }
    let raw;
    try {
      raw = parseYaml(readFileSync(join(SRC_DIR, file), "utf8"));
    } catch (e) {
      errors.push(`${rel}: YAML parse error: ${e.message}`);
      continue;
    }
    const errs = validateDoc(raw, stem, rel);
    if (errs.length) {
      errors.push(...errs);
      continue;
    }
    docs.set(stem, normalizeDoc(raw, stem));
  }
  for (const [id, doc] of docs) {
    if (doc.kind !== "list") continue;
    for (const g of doc.groups) {
      for (const ref of g.links) {
        if (!docs.has(ref))
          errors.push(`links/_src/${id}.yaml: reference to unknown id "${ref}"`);
      }
    }
  }
  return docs;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function absUrl(u, siteOrigin) {
  return u.startsWith("/") ? siteOrigin + u : u;
}

function ogHead({ title, description, path, image }, siteOrigin) {
  const url = siteOrigin + path;
  const lines = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
  ];
  if (image)
    lines.push(
      `<meta property="og:image" content="${escapeHtml(absUrl(image, siteOrigin))}">`
    );
  lines.push(`<link rel="canonical" href="${escapeHtml(url)}">`);
  return lines.join("\n");
}

// Home › Links › <title>; pass currentTitle=null on the index page itself.
function crumbsHtml(currentTitle) {
  const trail = [{ label: "Home", href: "/" }];
  let current = "Links";
  if (currentTitle !== null) {
    trail.push({ label: "Links", href: "/links/" });
    current = currentTitle;
  }
  return trail
    .map((c) => `<a href="${c.href}">${escapeHtml(c.label)}</a>`)
    .concat(`<span class="current">${escapeHtml(current)}</span>`)
    .join('<span class="sep">›</span>');
}

function pageShell({ pageTitle, og, crumbs, body }, css) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${og}
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>${escapeHtml(pageTitle)}</title>
<style>${css}</style>
</head>
<body>
<div class="page-banner">
  <nav class="page-banner-inner crumbs">
    ${crumbs}
  </nav>
</div>
<div class="container">
${body}
</div>
<div class="page-footer">
andoverct.info link registry
</div>
</body>
</html>`;
}

function metaLineHtml(doc) {
  const bits = [];
  if (doc.date) bits.push(escapeHtml(doc.date));
  if (doc.archived)
    bits.push(`<a href="${escapeHtml(doc.archived)}">archived copy</a>`);
  return bits.length
    ? `\n  <p class="link-card-meta">${bits.join(" · ")}</p>`
    : "";
}

// The card for a leaf doc, both on its own page and inlined in lists. Only
// the first occurrence per page carries the fragment id (withFragment).
function leafCardHtml(doc, withFragment) {
  const idAttr = withFragment ? ` id="link-${doc.id}"` : "";
  const mark = EXT_RE.test(doc.url)
    ? `<span class="ext-mark" title="external link">&#8599;</span>`
    : "";
  return `<div class="link-card"${idAttr}>
  <div class="link-card-title"><a href="${escapeHtml(doc.url)}">${escapeHtml(doc.title)}</a>${mark}</div>
  <p class="link-card-desc">${escapeHtml(doc.description)}</p>${metaLineHtml(doc)}
</div>`;
}

// The card for a list doc referenced from another page: links to the list's
// own page instead of inlining its contents (the no-nesting rule).
function listRefCardHtml(doc, withFragment) {
  const idAttr = withFragment ? ` id="link-${doc.id}"` : "";
  return `<div class="link-card"${idAttr}>
  <div class="link-card-title"><a href="/links/${doc.id}/">${escapeHtml(doc.title)}</a></div>
  <p class="link-card-desc">${escapeHtml(doc.description)}</p>
</div>`;
}

function renderLeafPage(doc, ctx) {
  const body =
    `<p class="section-label">Source</p>\n` + leafCardHtml(doc, true);
  return pageShell(
    {
      pageTitle: `${doc.title} — andoverct.info`,
      og: ogHead(
        {
          title: doc.title,
          description: doc.description,
          path: `/links/${doc.id}/`,
          image: doc.image,
        },
        ctx.siteOrigin
      ),
      crumbs: crumbsHtml(doc.title),
      body,
    },
    ctx.css
  );
}

function renderListPage(doc, docs, ctx) {
  const seen = new Set();
  let body =
    `<h1 class="report-title">${escapeHtml(doc.title)}</h1>\n` +
    `<p class="report-subtitle">${escapeHtml(doc.description)}</p>\n` +
    `<hr class="report-header-rule">\n`;
  for (const g of doc.groups) {
    if (g.title) body += `<h2>${escapeHtml(g.title)}</h2>\n`;
    if (g.description) body += `<p class="link-group-desc">${escapeHtml(g.description)}</p>\n`;
    for (const ref of g.links) {
      const target = docs.get(ref);
      const withFragment = !seen.has(ref);
      seen.add(ref);
      body +=
        (target.kind === "leaf"
          ? leafCardHtml(target, withFragment)
          : listRefCardHtml(target, withFragment)) + "\n";
    }
  }
  return pageShell(
    {
      pageTitle: `${doc.title} — andoverct.info`,
      og: ogHead(
        {
          title: doc.title,
          description: doc.description,
          path: `/links/${doc.id}/`,
          image: doc.image,
        },
        ctx.siteOrigin
      ),
      crumbs: crumbsHtml(doc.title),
      body,
    },
    ctx.css
  );
}

function renderIndexPage(docs, ctx) {
  const byId = (a, b) =>
    /^\d+$/.test(a.id) && /^\d+$/.test(b.id)
      ? Number(a.id) - Number(b.id)
      : a.id.localeCompare(b.id);
  const all = [...docs.values()];
  const lists = all.filter((d) => d.kind === "list").sort(byId);
  const leaves = all.filter((d) => d.kind === "leaf");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const description = "Sources referenced in andoverct.info posts and campaigns.";
  const body =
    `<h1 class="report-title">Link registry</h1>\n` +
    `<p class="report-subtitle">${escapeHtml(description)}</p>\n` +
    `<hr class="report-header-rule">\n` +
    lists.map((d) => listRefCardHtml(d, false)).join("\n") +
    `\n<p class="links-count">${plural(lists.length, "collection")} · ${plural(leaves.length, "source")}</p>`;
  return pageShell(
    {
      pageTitle: "Link registry — andoverct.info",
      og: ogHead({ title: "Link registry — andoverct.info", description, path: "/links/" }, ctx.siteOrigin),
      crumbs: crumbsHtml(null),
      body,
    },
    ctx.css
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const config = loadConfig();
  if (!config.siteOrigin)
    throw new Error(
      `_build/report.config.json must define "siteOrigin" (e.g. "https://andoverct.info")`
    );
  const css =
    loadTheme(config.theme || "default") + "\n" + BASE_CSS + LINKS_CSS;
  const ctx = { siteOrigin: config.siteOrigin.replace(/\/+$/, ""), css };

  const errors = [];
  const docs = loadDocs(errors);
  if (errors.length) {
    for (const e of errors) console.error(`ERROR ${e}`);
    process.exit(1);
  }

  for (const [id, doc] of docs) {
    const html =
      doc.kind === "leaf"
        ? renderLeafPage(doc, ctx)
        : renderListPage(doc, docs, ctx);
    mkdirSync(join(OUT_DIR, id), { recursive: true });
    writeFileSync(join(OUT_DIR, id, "index.html"), html, "utf8");
    console.log(`wrote links/${id}/index.html (${html.length} chars)`);
  }

  const idx = renderIndexPage(docs, ctx);
  writeFileSync(join(OUT_DIR, "index.html"), idx, "utf8");
  console.log(`wrote links/index.html (${idx.length} chars)`);

  // Prune output dirs whose source is gone, so the local tree stays canonical.
  // Only dirs that contain exactly our own output are touched.
  for (const entry of readdirSync(OUT_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name === "_src" || docs.has(name) || !ID_RE.test(name)) continue;
    const contents = readdirSync(join(OUT_DIR, name));
    if (contents.length === 1 && contents[0] === "index.html") {
      rmSync(join(OUT_DIR, name), { recursive: true });
      console.log(`pruned links/${name}/`);
    } else {
      console.warn(
        `WARNING links/${name}/ has no source but holds unexpected files; not pruned`
      );
    }
  }
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
