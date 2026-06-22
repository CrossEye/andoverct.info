const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

// --- Configuration -----------------------------------------------------------

const pages = require('./pages.json');

// --- Path resolution ---------------------------------------------------------

const rootDir = __dirname;
const sourceDir = path.join(rootDir, 'sources');

// --- Helpers -----------------------------------------------------------------

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readSource(filename) {
  const full = path.join(sourceDir, filename);
  if (!fs.existsSync(full)) {
    console.error(`Source file not found: ${full}`);
    process.exit(1);
  }
  return fs.readFileSync(full, 'utf-8');
}

function generateToc(markdown) {
  const lines = markdown.split('\n');
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    // Setext-style H2: non-empty text line followed by a line of dashes
    if (
      i + 1 < lines.length &&
      lines[i].trim() !== '' &&
      !/^[-=]{3,}\s*$/.test(lines[i].trim()) &&
      /^-{3,}\s*$/.test(lines[i + 1])
    ) {
      entries.push({ level: 2, text: lines[i].trim() });
      i++; // skip the underline
      continue;
    }
    // Symmetric ATX H3: ### text ###
    const m3 = lines[i].match(/^###\s+(.+?)\s+###\s*$/);
    if (m3) {
      entries.push({ level: 3, text: m3[1] });
      continue;
    }
    // Fallback: plain ATX H2/H3
    const m2 = lines[i].match(/^##\s+(.+)/);
    if (m2) {
      entries.push({ level: 2, text: m2[1] });
      continue;
    }
    const m3b = lines[i].match(/^###\s+(.+)/);
    if (m3b) {
      entries.push({ level: 3, text: m3b[1] });
    }
  }
  if (entries.length === 0) return '';

  let html = '<details class="toc" aria-label="Table of Contents">\n';
  html += '  <summary>Contents</summary>\n  <ul>\n';
  for (const entry of entries) {
    const id = entry.text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');
    const indent = entry.level === 3 ? '      ' : '    ';
    const cls = entry.level === 3 ? ' class="toc-sub"' : '';
    html += `${indent}<li${cls}><a href="#${id}">${entry.text}</a></li>\n`;
  }
  html += '  </ul>\n</details>\n';
  return html;
}

// --- Breadcrumbs / theming ---------------------------------------------------

// Absolute base path where town-charter is served.
const SECTION_BASE = '/town-charter/';
const SEP = '<span class="sep">›</span>';

// Map dest -> short breadcrumb label (pages.json `crumb`, falling back to title).
const crumbByDest = {};
for (const p of pages) crumbByDest[p.dest] = p.crumb || p.title;

// Build the breadcrumb markup for a page. Site convention: the section home
// (index.html) is the dark page and carries a simple inline trail inside the
// article; every other (light) page gets a dark breadcrumb banner above the
// article with the full Home › Town Charter › … trail.
function crumbsFor(page) {
  if (page.dest === 'index.html') {
    return `<nav class="crumbs"><a href="/">Home</a>${SEP}<span class="current">${crumbByDest['index.html']}</span></nav>`;
  }
  const segs = page.dest.split('/').slice(0, -1); // drop trailing index.html
  const parts = [
    '<a href="/">Home</a>',
    `<a href="${SECTION_BASE}">${crumbByDest['index.html']}</a>`,
  ];
  segs.forEach((seg, i) => {
    const sub = segs.slice(0, i + 1).join('/');
    const label = crumbByDest[`${sub}/index.html`] || seg;
    parts.push(
      i === segs.length - 1
        ? `<span class="current">${label}</span>`
        : `<a href="${SECTION_BASE}${sub}/">${label}</a>`
    );
  });
  return `<div class="page-banner">\n  <nav class="page-banner-inner crumbs">${parts.join(SEP)}</nav>\n</div>`;
}

function buildPage(page) {
  const md = readSource(page.src);
  let body = marked.parse(md, { renderer: makeRenderer(page.dest) });
  if (page.toc) {
    const toc = generateToc(md);
    // Insert TOC after the first <hr> (i.e. after the title and intro)
    const hrIndex = body.indexOf('<hr>');
    if (hrIndex !== -1) {
      const insertAt = hrIndex + '<hr>'.length;
      body = body.slice(0, insertAt) + '\n' + toc + body.slice(insertAt);
    } else {
      body = toc + body;
    }
  }

  // Depth from root — needed for CSS path
  const depth = page.dest.split('/').length - 1;
  const cssPath = (depth > 0 ? '../'.repeat(depth) : './') + 'style.css';

  const head = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <title>${page.title}</title>
  <link rel="stylesheet" href="${cssPath}">
</head>`;

  const crumbs = crumbsFor(page);

  // Section home: dark theme, trail inside the article.
  if (page.dest === 'index.html') {
    return `${head}
<body class="dark">
  <article>
${crumbs}
${body}
  </article>
</body>
</html>`;
  }

  // Guide pages: light theme, dark breadcrumb banner above the article.
  return `${head}
<body>
${crumbs}
  <article>
${body}
  </article>
</body>
</html>`;
}

// --- Marked configuration ----------------------------------------------------

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

// Build a map from source filename to dest path for link rewriting
const srcToDestMap = {};
for (const page of pages) {
  srcToDestMap[page.src] = page.dest;
}

function makeRenderer(currentDest) {
  const renderer = new marked.Renderer();

  renderer.heading = function ({ text, depth }) {
    const raw = typeof text === 'string' ? text : text.toString();
    const rendered = marked.parseInline(raw);
    const plain = rendered.replace(/<[^>]+>/g, '');
    const id = slugify(plain);
    return `<h${depth} id="${id}">${rendered}</h${depth}>\n`;
  };

  renderer.link = function ({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    // Rewrite links to sibling .md source files → relative HTML paths
    if (href && href.endsWith('.md') && srcToDestMap[href]) {
      const targetDest = srcToDestMap[href];
      const currentDir = path.dirname(currentDest);
      href = path.relative(currentDir, targetDest).replace(/\\/g, '/').replace(/\/index\.html$/, '') || '.';
    }
    const titleAttr = title ? ` title="${title}"` : '';
    return `<a href="${href}"${titleAttr}>${text}</a>`;
  };

  return renderer;
}

// --- Main --------------------------------------------------------------------

console.log('Source directory:', sourceDir);
console.log('Output directory:', rootDir);

// Build HTML pages
for (const page of pages) {
  const destPath = path.join(rootDir, page.dest);
  ensureDir(path.dirname(destPath));
  const html = buildPage(page);
  fs.writeFileSync(destPath, html, 'utf-8');
  console.log(`  wrote ${page.dest}`);
}

console.log('\nDone.');
