'use strict'
// Shared SVG string helpers and the report palette.
//
// PAL is the palette: this is the one place in the directive renderers where a
// colour literal belongs, the same way _build/themes/*.css is the one place in
// the stylesheets. The renderers reference PAL.<name> and never a raw hex.
// These cannot be CSS custom properties — the same SVG is rendered by
// WeasyPrint for the PDF, which does not resolve var() in presentation
// attributes.

const PAL = {
  cream: '#FBF8F1', ink: '#2b2b2b', sub: '#6a6453', faint: '#8a8170',
  grid: '#E3DDCE', green: '#1f7a3d', gold: '#B8860B', goldText: '#9a6f08',
  purple: '#7a4b8a', slate: '#5b7a99', ringFill: '#2e8b57',
  boundary: '#d9d2c0', townEdge: '#6a6453', hatchFill: '#efe9da',
  // Concentric-ring shades, darkest (core) outward; consistent across maps.
  rings: ['#1f7a3d', '#4f9c62', '#82bd8f', '#b5dcbc'],
  // Chart furniture: axis tick labels, and the keyline that separates a data
  // marker from the series line running under it.
  axis: '#5a5446', markerEdge: '#fff',
  // Locator-map furniture: the hatch rule over excluded towns, and the muted
  // fill/edge used for every town on the whole-state map.
  hatchLine: '#a99f8a', stateFill: '#dceadf', stateEdge: '#b9cfc0',
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const attrs = (o) => Object.entries(o).map(([k, v]) => ` ${k}="${v}"`).join('')
const el = (tag, a, inner) =>
  inner == null ? `<${tag}${attrs(a)}/>` : `<${tag}${attrs(a)}>${inner}</${tag}>`
const r1 = (v) => Math.round(v * 10) / 10
const text = (x, y, s, a = {}) => el('text', { x: r1(x), y: r1(y), ...a }, esc(s))
const poly = (pts) => pts.map((p) => `${p[0]},${p[1]}`).join(' ')

module.exports = { PAL, esc, attrs, el, text, poly, r1 }
