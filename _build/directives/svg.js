'use strict';
// Shared SVG string helpers and the report palette.

const PAL = {
  cream: '#FBF8F1', ink: '#2b2b2b', sub: '#6a6453', faint: '#8a8170',
  grid: '#E3DDCE', green: '#1f7a3d', gold: '#B8860B', goldText: '#9a6f08',
  purple: '#7a4b8a', slate: '#5b7a99', ringFill: '#2e8b57',
  boundary: '#d9d2c0', townEdge: '#6a6453', hatchFill: '#efe9da',
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attrs = o => Object.entries(o).map(([k, v]) => ` ${k}="${v}"`).join('');
const el = (tag, a, inner) =>
  inner == null ? `<${tag}${attrs(a)}/>` : `<${tag}${attrs(a)}>${inner}</${tag}>`;
const text = (x, y, s, a = {}) =>
  el('text', { x: r1(x), y: r1(y), ...a }, esc(s));
const poly = pts => pts.map(p => `${p[0]},${p[1]}`).join(' ');
const r1 = v => Math.round(v * 10) / 10;

module.exports = { PAL, esc, attrs, el, text, poly, r1 };
