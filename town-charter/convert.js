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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${page.title}</title>
  <link rel="stylesheet" href="${cssPath}">
</head>
<body>
  <button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode">
    <span class="theme-icon-light">☀︎</span>
    <span class="theme-icon-dark">☾</span>
  </button>
  <article>
${body}
  </article>
  <script>
    (function() {
      var btn = document.getElementById('theme-toggle');
      var root = document.documentElement;
      var stored = localStorage.getItem('theme');
      if (stored) {
        root.setAttribute('data-theme', stored);
      } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        root.setAttribute('data-theme', 'dark');
      }
      btn.addEventListener('click', function() {
        var current = root.getAttribute('data-theme') || 'light';
        var next = current === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
      });
    })();
  </script>
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
