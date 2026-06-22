#!/usr/bin/env node
/**
 * render.js — convert a the-facts edition .md to index.html.
 *
 * Usage:
 *   node render.js <edition-folder>
 *   node render.js --all
 *
 * Reads the first .md file in the folder, processes YAML frontmatter,
 * renders markdown with marked, applies custom-block and post-process
 * transforms (math-block, data-section, ecs-chart, blockquote source,
 * placeholder, references), substitutes into template.html, and writes
 * <folder>/index.html.
 *
 * Authoring conventions are documented in
 * .claude/skills/the-facts-edition/SKILL.md.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const TEMPLATE_PATH = path.join(__dirname, 'template.html');
const EDITIONS_DIR = path.resolve(__dirname, '..', 'editions');

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    usage(1);
  } else if (args[0] === '--all') {
    renderAll();
  } else {
    args.forEach(renderEdition);
  }
}

function usage(code) {
  process.stderr.write('Usage: node render.js <edition-folder> [<edition-folder>...]\n');
  process.stderr.write('       node render.js --all\n');
  process.exit(code);
}

function renderAll() {
  const entries = fs.readdirSync(EDITIONS_DIR, { withFileTypes: true });
  entries
    .filter(e => e.isDirectory())
    .forEach(e => renderEdition(path.join(EDITIONS_DIR, e.name)));
}

function renderEdition(dir) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    process.stderr.write(`Skipped (not a directory): ${dir}\n`);
    return;
  }
  const mdFile = fs.readdirSync(abs).find(f => f.endsWith('.md'));
  if (!mdFile) {
    process.stderr.write(`Skipped (no .md found): ${dir}\n`);
    return;
  }
  const mdPath = path.join(abs, mdFile);
  const src = fs.readFileSync(mdPath, 'utf8');
  const { data: fm, content: body } = matter(src);

  const html = renderToHtml({ frontmatter: fm, body });
  const outPath = path.join(abs, 'index.html');
  fs.writeFileSync(outPath, html);
  process.stdout.write(`Rendered ${path.relative(process.cwd(), mdPath)} -> ${path.relative(process.cwd(), outPath)}\n`);
}

/* ------------------------------------------------------------------ *
 *  Top-level assembly                                                 *
 * ------------------------------------------------------------------ */

function renderToHtml({ frontmatter, body }) {
  const fm = frontmatter || {};

  const titleHtml = renderTitleAccent(fm.title || '');
  const titlePlain = stripMd(fm.title || '');
  const subtitleHtml = renderInline(fm.subtitle || '');
  const breadcrumbHtml = buildBreadcrumb(titlePlain);

  const bodyHtmlAll = renderBody(body);
  const extracted = extractReferences(bodyHtmlAll, fm.colophon);
  // Anchors are injected last, after references are split out, so the
  // extraction regex matches clean (anchor-free) headings.
  const bodyMain = addHeadingAnchors(extracted.bodyMain);
  const references = addHeadingAnchors(extracted.references);

  const heroImageHtml = renderHeroImage(fm.hero_image);
  const ctaHtml = renderCta(fm.cta);

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return template
    .replace('{{TITLE_TAG}}', escapeHtml(buildPageTitle(titlePlain, fm)))
    .replace('{{DESCRIPTION}}', escapeAttr(fm.description || ''))
    .replace('{{BREADCRUMB}}', breadcrumbHtml)
    .replace('{{HERO_TITLE}}', titleHtml)
    .replace('{{HERO_DEK}}', subtitleHtml)
    .replace('{{HERO_IMAGE}}', heroImageHtml)
    .replace('{{BODY}}', bodyMain)
    .replace('{{CTA}}', ctaHtml)
    .replace('{{REFERENCES}}', references);
}

function buildPageTitle(titlePlain, fm) {
  const tag = fm.page_title;
  if (tag) return tag;
  return `${titlePlain} — the facts`;
}

// Home › The Facts › <edition title>. "The Facts" links to /the-facts/ (the
// current edition); the edition title is the non-link current node.
function buildBreadcrumb(titlePlain) {
  return [
    '<a href="/">Home</a>',
    '<a href="/the-facts/">The Facts</a>',
    '<span class="current">' + escapeHtml(titlePlain) + '</span>',
  ].join('<span class="sep">›</span>');
}

/* ------------------------------------------------------------------ *
 *  Title accent                                                       *
 * ------------------------------------------------------------------ */

/**
 * Render an H1-bound title with two-tone accent coloring.
 *
 * Convention: bold-italic-inside-bold gets the accent color.
 *   "Jeff is **Mis*LEADING*** Us" -> the inner <em> ("LEADING") becomes .leading,
 *   surrounding <strong> content becomes .mis. Plain titles render unchanged.
 */
function renderTitleAccent(mdTitle) {
  const inline = renderInline(mdTitle);
  const m = inline.match(/^([\s\S]*?)<strong>([\s\S]*?)<em>([\s\S]*?)<\/em>([\s\S]*?)<\/strong>([\s\S]*)$/);
  if (!m) return inline;
  const [, before, sBefore, emText, sAfter, after] = m;
  return [
    before,
    sBefore ? `<span class="mis">${sBefore}</span>` : '',
    `<span class="leading">${emText}</span>`,
    sAfter ? `<span class="mis">${sAfter}</span>` : '',
    after,
  ].join('');
}

/* ------------------------------------------------------------------ *
 *  Body                                                               *
 * ------------------------------------------------------------------ */

function renderBody(md) {
  // 1. Extract <div class="..." markdown="1"> blocks before parsing.
  const blocks = [];
  const protectedSrc = md.replace(
    /<div class="([^"]+)" markdown="1">\s*([\s\S]*?)\s*<\/div>/g,
    (_, cls, inner) => {
      const id = blocks.length;
      blocks.push({ cls, inner });
      return `\n\n<!--BLOCK_${id}-->\n\n`;
    }
  );

  // 2. Parse remaining markdown. (marked 14 dropped the headerIds option, so
  //    we derive slug ids ourselves in step 4 below.)
  let html = marked.parse(protectedSrc);

  // 3. Render and re-insert custom blocks.
  blocks.forEach((b, i) => {
    const blockHtml = renderCustomBlock(b.cls, b.inner);
    html = html.replace(`<!--BLOCK_${i}-->`, blockHtml);
  });

  // 4. Post-process: wrap h2 sections, lift lead paragraphs, etc.
  html = wrapSections(html);
  html = hoistBlockquoteSources(html);
  html = renderPlaceholders(html);
  html = addHeadingIds(html);

  return html;
}

/* ------------------------------------------------------------------ *
 *  Heading slug ids                                                   *
 * ------------------------------------------------------------------ */

/**
 * Give every heading a GitHub-style slug id derived from its text, so
 * sections can be deep-linked (e.g. .../#how-fast-has-spending-grown).
 * Headings that already carry an id are left alone; duplicate slugs get a
 * numeric suffix (-1, -2, ...) in document order.
 */
function addHeadingIds(html) {
  const used = new Map();
  return html.replace(
    /<(h[1-6])((?:\s[^>]*)?)>([\s\S]*?)<\/\1>/g,
    (full, tag, attrs, inner) => {
      if (/\sid\s*=/.test(attrs)) return full;
      const base = slugify(stripTags(inner));
      if (!base) return full;
      let slug = base;
      if (used.has(base)) {
        const n = used.get(base) + 1;
        used.set(base, n);
        slug = `${base}-${n}`;
      } else {
        used.set(base, 0);
      }
      return `<${tag}${attrs} id="${slug}">${inner}</${tag}>`;
    }
  );
}

/**
 * Append a subtle hover-reveal permalink anchor to every heading that carries
 * an id. The "¶" link copies the section URL to the clipboard (see the script
 * in template.html). Mirrors the reports' `.header-anchor` convention.
 * Run AFTER extractReferences so its heading regex sees anchor-free headings.
 */
function addHeadingAnchors(html) {
  return html.replace(
    /<(h[1-6])((?:\s[^>]*)?)\sid="([^"]+)"((?:\s[^>]*)?)>([\s\S]*?)<\/\1>/g,
    (full, tag, pre, id, post, inner) => {
      if (inner.includes('header-anchor')) return full;
      const anchor =
        `<a class="header-anchor" href="#${id}" aria-label="Link to this section">¶</a>`;
      return `<${tag}${pre} id="${id}"${post}>${inner}${anchor}</${tag}>`;
    }
  );
}

/**
 * GitHub-style slug: lowercase, strip punctuation, collapse whitespace and
 * underscores to single hyphens, trim leading/trailing hyphens.
 */
function slugify(text) {
  return String(text)
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, '')  // drop HTML entities (escaped punctuation)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ------------------------------------------------------------------ *
 *  Custom blocks                                                      *
 * ------------------------------------------------------------------ */

function renderCustomBlock(cls, inner) {
  switch (cls) {
    case 'math-block':   return renderMathBlock(inner);
    case 'data-section': return renderDataSection(inner);
    case 'ecs-chart':    return renderEcsChart(inner);
    default:
      // Unknown wrap — pass through with the class preserved.
      return `<div class="${cls}">\n${marked.parse(inner)}</div>`;
  }
}

/**
 * math-block: two-row, two-column table.
 *   Row 1 -> wrong (burgundy, x-mark);
 *   Row 2 -> right (green, check-mark).
 */
function renderMathBlock(md) {
  const inner = marked.parse(md);
  const rows = [...inner.matchAll(/<tr>\s*<td(?:\s[^>]*)?>([\s\S]*?)<\/td>\s*<td(?:\s[^>]*)?>([\s\S]*?)<\/td>\s*<\/tr>/g)]
    .map(m => [m[1].trim(), m[2].trim()]);
  if (rows.length !== 2) {
    process.stderr.write(`warn: math-block expects 2 rows, got ${rows.length}\n`);
  }
  const styleMark = (text) => text
    .replace(/✗/g, '<span class="mark x">✗</span>')
    .replace(/✓/g, '<span class="mark check">✓</span>');
  const stripStrong = (s) => s.replace(/^<strong>/, '').replace(/<\/strong>$/, '');

  let out = '<div class="math-block">\n';
  rows.forEach((row, i) => {
    const labelClass = i === 0 ? 'wrong-label' : 'right-label';
    out += '  <div class="row">\n';
    out += `    <div class="label ${labelClass}">${stripStrong(row[0])}</div>\n`;
    out += `    <div class="equation">${styleMark(row[1])}</div>\n`;
    out += '  </div>\n';
  });
  out += '</div>';
  return out;
}

/**
 * data-section: h3 + (optional) paragraph(s) + bullet list + (optional) paragraph(s).
 * Bullets matching "**X** — Y" become .stat blocks; other bullets stay in a <ul>.
 */
function renderDataSection(md) {
  let inner = marked.parse(md);
  inner = inner.replace(/<ul>([\s\S]*?)<\/ul>/g, (_, ulInner) => {
    const items = [...ulInner.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1].trim());
    let stats = '';
    let remaining = '';
    items.forEach(li => {
      const m = li.match(/^<strong>([\s\S]+?)<\/strong>\s*[—–-]\s*([\s\S]+)$/);
      if (m) {
        stats += `<div class="stat">${m[1].trim()} &nbsp;<span class="stat-label">${m[2].trim()}</span></div>\n`;
      } else {
        remaining += `<li>${li}</li>`;
      }
    });
    const ul = remaining ? `<ul>${remaining}</ul>\n` : '';
    return ul + stats;
  });
  return `<div class="data-section">\n${inner.trim()}\n</div>`;
}

/**
 * ecs-chart: one or more scenarios. Each scenario is:
 *   <p><strong>Heading</strong> — subtitle</p>
 *   <table> headers + one row of currency values </table>
 *   <p>Local share, total: <strong>$X</strong></p>
 * Renders as stacked bars sized proportionally to the currency values.
 */
function renderEcsChart(md) {
  const inner = marked.parse(md);
  const re = new RegExp(
    '<p><strong>([\\s\\S]+?)<\\/strong>\\s*[—–-]\\s*([\\s\\S]+?)<\\/p>' +
    '\\s*<table>([\\s\\S]*?)<\\/table>' +
    '\\s*<p>([^<]*?)<strong>([^<]+)<\\/strong>([^<]*)<\\/p>',
    'g'
  );

  const scenarios = [];
  for (const m of inner.matchAll(re)) {
    scenarios.push({
      heading: m[1].trim(),
      subtitle: m[2].trim(),
      table: m[3],
      totalPrefix: (m[4] || '').trim(),
      totalAmount: m[5].trim(),
      totalSuffix: (m[6] || '').trim(),
    });
  }

  if (scenarios.length === 0) {
    process.stderr.write('warn: ecs-chart found no scenarios\n');
    return `<div class="ecs-chart">${inner}</div>`;
  }

  const segClasses = ['seg-town', 'seg-aes', 'seg-rham'];
  let out = '<div class="ecs-chart">\n';

  scenarios.forEach(s => {
    const headers = [...s.table.matchAll(/<th(?:\s[^>]*)?>([\s\S]*?)<\/th>/g)].map(m => m[1].trim());
    const values  = [...s.table.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/g)].map(m => m[1].trim());
    const nums    = values.map(parseCurrency);
    const total   = nums.reduce((a, b) => a + b, 0) || 1;
    const widths  = nums.map(v => (v / total * 100).toFixed(1));

    out += '  <div class="scenario">\n';
    out += `    <h4>${s.heading}</h4>\n`;
    out += `    <div class="subtitle">${s.subtitle}</div>\n`;
    out += '    <div class="stack">\n';
    values.forEach((v, i) => {
      const cls = segClasses[i] || `seg-other-${i}`;
      out += `      <div class="${cls}" style="width: ${widths[i]}%;">${v}</div>\n`;
    });
    out += '    </div>\n';
    out += '    <div class="labels">\n';
    headers.forEach((h, i) => {
      const { name, rest } = splitColumnHeader(h);
      const restHtml = rest ? rest : '';
      out += `      <div style="width: ${widths[i]}%;"><span class="name">${name}</span>${restHtml}</div>\n`;
    });
    out += '    </div>\n';
    out += '    <div class="total">\n';
    const totalLabel = (s.totalPrefix || 'Local share, total').replace(/[:\s]+$/, '');
    out += `      <span class="label">${totalLabel}</span>\n`;
    out += `      <span class="amount">${s.totalAmount}</span>\n`;
    out += '    </div>\n';
    out += '  </div>\n';
  });

  out += '</div>';
  return out;
}

function parseCurrency(s) {
  const stripped = s.replace(/[,$\s]/g, '');
  const m = stripped.match(/^([\d.]+)([KMB]?)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult = ({ K: 1e3, M: 1e6, B: 1e9 })[(m[2] || '').toUpperCase()] || 1;
  return n * mult;
}

/**
 * Split a column header like "Town (after ECS, Gen Gov't + Capital)"
 *   -> { name: "Town", rest: "after ECS, Gen Gov't + Capital" }
 * Or "AES (gross)" -> { name: "AES", rest: "(gross)" }.
 * The convention: a single leading word becomes .name; everything after is the subtitle.
 */
function splitColumnHeader(s) {
  const m = s.match(/^(\S+)\s+(.+)$/);
  if (!m) return { name: s, rest: '' };
  return { name: m[1], rest: m[2] };
}

/* ------------------------------------------------------------------ *
 *  Section wrapping & lead paragraph                                  *
 * ------------------------------------------------------------------ */

/**
 * Walk the rendered body and wrap each H2 plus its trailing content in a <section>.
 * Also: if the first <p> of a section is entirely <em>...</em>, convert to
 * <p class="lead">stripped content</p> so it gets the kicker styling.
 *
 * The "Sources..." H2 is NOT wrapped; extractReferences() handles it separately.
 */
function wrapSections(html) {
  // Split into chunks at H2 boundaries. JS's split-with-lookahead does not
  // emit a leading empty string when the input starts with the pattern, so
  // we have to detect that case explicitly.
  const parts = html.split(/(?=<h2(?:\s[^>]*)?>)/);
  const startsWithH2 = /^<h2(?:\s[^>]*)?>/.test(parts[0] || '');
  const preH2Raw = startsWithH2 ? '' : (parts[0] || '');
  const sections = startsWithH2 ? parts : parts.slice(1);

  // Wrap any content that appeared before the first H2 in its own <section>,
  // so the article's typography (section h2 / section h3) applies to articles
  // composed entirely of H3 subsections (edition-2 style).
  const preH2 = preH2Raw.trim()
    ? `<section>\n${preH2Raw.trim()}\n</section>\n`
    : '';

  const wrapped = sections.map(chunk => {
    const headingMatch = chunk.match(/^<h2(?:\s[^>]*)?>([\s\S]*?)<\/h2>/);
    if (!headingMatch) return chunk;
    const headingText = stripTags(headingMatch[1]).trim();
    if (/^Sources(?:\s+and\s+further\s+reading)?$/i.test(headingText)) {
      // Leave it; extractReferences will lift everything from here on out.
      return chunk;
    }
    let inner = chunk;
    // Lift the first <p>…</p> into a .lead if it's a single <em>…</em>.
    inner = inner.replace(/(<h2[^>]*>[\s\S]*?<\/h2>)\s*<p><em>([\s\S]*?)<\/em><\/p>/,
      (_, h2, leadText) => `${h2}\n<p class="lead">${leadText}</p>`);
    return `<section>\n${inner.trim()}\n</section>\n`;
  }).join('');

  return preH2 + wrapped;
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, '');
}

/* ------------------------------------------------------------------ *
 *  Blockquote source attribution                                       *
 * ------------------------------------------------------------------ */

/**
 * Convention: a blockquote whose last <p> is "<em>— Speaker, Date</em>"
 * lifts that line into <span class="source">. Em-dash, en-dash, and plain
 * hyphen all accepted.
 */
function hoistBlockquoteSources(html) {
  return html.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (full, content) => {
    const m = content.match(/^([\s\S]*?)<p>\s*<em>\s*[—–-]\s*([\s\S]*?)<\/em>\s*<\/p>\s*$/);
    if (!m) return full;
    return `<blockquote>${m[1].trim()}\n<span class="source">— ${m[2].trim()}</span>\n</blockquote>`;
  });
}

/* ------------------------------------------------------------------ *
 *  Placeholders                                                       *
 * ------------------------------------------------------------------ */

function renderPlaceholders(html) {
  // Block-level: a blockquote whose only content is [PLACEHOLDER: ...].
  html = html.replace(
    /<blockquote>\s*<p>\s*\[PLACEHOLDER:\s*([\s\S]*?)\]\s*<\/p>\s*<\/blockquote>/g,
    (_, content) => `<div class="placeholder-block">PLACEHOLDER: ${content.trim()}</div>`
  );
  // Inline: [PLACEHOLDER: ...] anywhere else.
  html = html.replace(
    /\[PLACEHOLDER:\s*([^\]]*)\]/g,
    (_, content) => `<span class="placeholder">PLACEHOLDER: ${content.trim()}</span>`
  );
  return html;
}

/* ------------------------------------------------------------------ *
 *  Hero image                                                         *
 * ------------------------------------------------------------------ */

function renderHeroImage(hi) {
  if (!hi || !hi.src) return '';
  const circle = hi.circle ? renderCircle(hi.circle) : '';
  const caption = hi.caption
    ? `\n    <div class="mailer-caption">${renderInline(hi.caption)}</div>`
    : '';
  return `
  <div class="mailer">
    <div class="mailer-frame">
      <img src="${escapeAttr(hi.src)}" alt="${escapeAttr(hi.alt || '')}">${circle ? '\n      ' + circle : ''}
    </div>${caption}
  </div>`;
}

function renderCircle(c) {
  const parts = [];
  if (c.top != null)    parts.push(`top: ${c.top}`);
  if (c.left != null)   parts.push(`left: ${c.left}`);
  if (c.width != null)  parts.push(`width: ${c.width}`);
  if (c.height != null) parts.push(`height: ${c.height}`);
  if (c.rotate != null) parts.push(`transform: rotate(${c.rotate}deg)`);
  const style = parts.join('; ');
  return `<div class="circle" style="${style};"></div>`;
}

/* ------------------------------------------------------------------ *
 *  CTA                                                                *
 * ------------------------------------------------------------------ */

function renderCta(cta) {
  if (!cta || !cta.heading) return '';
  const bodyLines = (cta.body || '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(renderInline);
  const bodyHtml = bodyLines.length
    ? `\n    <p>${bodyLines.join('<br>\n    ')}</p>`
    : '';
  return `
  <div class="cta">
    <h2>${renderInline(cta.heading)}</h2>${bodyHtml}
  </div>`;
}

/* ------------------------------------------------------------------ *
 *  References + colophon                                              *
 * ------------------------------------------------------------------ */

/**
 * Find the last "Sources" / "Sources and further reading" H2 and move that
 * heading plus everything after it into a <div class="references">.
 * If frontmatter.colophon is set, append it as a <div class="colophon">.
 */
function extractReferences(html, colophon) {
  const re = /<h2(?:\s[^>]*)?>(Sources(?:\s+and\s+further\s+reading)?)<\/h2>/i;
  const m = html.match(re);
  const colophonHtml = colophon
    ? `\n    <div class="colophon">\n      ${renderInline(String(colophon).trim()).replace(/\n/g, '<br>\n      ')}\n    </div>`
    : '';

  if (!m) {
    if (!colophonHtml) return { bodyMain: html, references: '' };
    return {
      bodyMain: html,
      references: `\n  <div class="references">${colophonHtml}\n  </div>`,
    };
  }

  const idx = html.indexOf(m[0]);
  const before = html.slice(0, idx).trimEnd();
  const after = html.slice(idx + m[0].length).trimStart();
  const heading = m[1];
  return {
    bodyMain: before + '\n',
    references: `\n  <div class="references">
    <h2 id="${slugify(heading)}">${heading}</h2>
    ${after}${colophonHtml}
  </div>`,
  };
}

/* ------------------------------------------------------------------ *
 *  Helpers                                                            *
 * ------------------------------------------------------------------ */

function renderInline(md) {
  return marked.parseInline(String(md || ''));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}

function stripMd(s) {
  return String(s).replace(/[*_`]/g, '');
}

main();
