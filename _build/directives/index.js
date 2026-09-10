'use strict';
// Directive preprocessor for civic-report markdown.
//
//   const { preprocess } = require('./scripts/directives');
//   const out = preprocess(markdownSource, {
//     data: require('./dataset.json'),        // units + groups + years
//     correspondence: require('./correspondence.json'),  // living-ledger entries
//     geo:  require('./towns_xy.json'),       // pre-projected town polygons
//     cpi:  require('./cpi_fy.json'),         // fiscal-year CPI-U averages
//   });
//
// Syntax:  <% handler group-id key=value key=value %>   on its own line.
// Handlers return either raw HTML (inline SVG) or markdown; both splice
// cleanly into the source before the markdown-to-HTML stage. Unknown
// handlers throw by default; pass {lenient:true} to leave them untouched.

const handlers = {
  decomp: require('./decomp'),
  locmap: require('./locmap'),
  datatable: require('./datatable'),
  correspondence: require('./correspondence'),
};

const DIRECTIVE = /^[ \t]*<%\s*([\w-]+)\s+([\w-]+)((?:\s+[\w-]+=[^\s%]+)*)\s*%>[ \t]*$/gm;

function parseArgs(s) {
  const args = {};
  for (const m of (s || '').matchAll(/([\w-]+)=([^\s%]+)/g)) args[m[1]] = m[2];
  return args;
}

// The same syntax mid-line, for a directive that supplies a phrase rather than a
// block — a date inside a sentence, a count inside a table cell. Applied after
// the block pass, so a directive standing on its own line is already gone and
// only genuinely inline ones remain.
const INLINE = /<%\s*([\w-]+)\s+([\w-]+)((?:\s+[\w-]+=[^\s%]+)*)\s*%>/g;

function preprocess(markdown, ctx, opts = {}) {
  const run = (whole, name, groupId, rest) => {
    const h = handlers[name];
    if (!h) {
      if (opts.lenient) return whole;
      throw new Error(`Unknown directive '${name}'`);
    }
    return h(ctx, groupId, parseArgs(rest));
  };
  return markdown.replace(DIRECTIVE, run).replace(INLINE, run);
}

function register(name, fn) { handlers[name] = fn; }

module.exports = { preprocess, register, handlers };
