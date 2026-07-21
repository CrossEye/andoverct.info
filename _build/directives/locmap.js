'use strict';
// <% locmap <group> %>
// Locator map: full CT with the group's towns highlighted. Coloring: included
// towns fill green, shaded by concentric ring (darkest at the innermost nested
// group, lighter with each ring, consistent across maps); towns counted only
// through an included regional district fill slate; excluded group towns are
// hatched. Borders between highlighted towns use the chart background so
// adjacent fills stay distinct.

const { PAL, el, poly, text, r1 } = require('./svg');
const { resolveGroup } = require('./resolve');

const FW = 960, FH = 500;

function classify(data, g) {
  const local = new Set(), viaRegion = new Set(), hatched = new Set();
  for (const name of g.included.concat(g.excluded.map(e => e.name))) {
    const u = data.units[name];
    if (!u) continue;
    if (u.type === 'region') for (const m of u.members || []) viaRegion.add(m);
  }
  for (const name of g.included)
    if (data.units[name].type === 'town') local.add(name);
  for (const e of g.excluded) hatched.add(e.name);
  return { local, viaRegion, hatched };
}

// The chain of named groups strictly nested inside this one (smallest first,
// the group itself last), e.g. core -> block1 -> block2 for block2. Only
// multi-member groups count, and the candidates must nest cleanly; otherwise
// there is no ring structure and the map uses a single fill.
function ringChain(data, groupId) {
  const cur = data.groups[groupId];
  if (!cur || !cur.members) return null;
  const curSet = new Set(cur.members);
  const subset = (a, b) => a.size < b.size && [...a].every(x => b.has(x));
  const cands = Object.entries(data.groups)
    .filter(([id, gr]) => id !== groupId && gr.members && gr.members.length > 1)
    .map(([id, gr]) => new Set(gr.members))
    .filter(s => subset(s, curSet))
    .sort((a, b) => a.size - b.size);
  if (!cands.length) return null;
  for (let i = 1; i < cands.length; i++)
    if (!subset(cands[i - 1], cands[i])) return null;
  return [...cands, curSet];
}

function locmap(ctx, groupId) {
  const { data, geo } = ctx;
  const g = resolveGroup(data, groupId);
  if (g.included.some(n => data.units[n].type === 'state'))
    return stateMap(ctx, g);
  const { local, viaRegion, hatched } = classify(data, g);
  const tiers = ringChain(data, groupId);
  const shade = t => {
    if (!tiers) return PAL.green;
    for (let i = 0; i < tiers.length; i++)
      if (tiers[i].has(t)) return PAL.rings[Math.min(i, PAL.rings.length - 1)];
    return PAL.rings[PAL.rings.length - 1];
  };
  const color = t =>
    hatched.has(t) ? null :
    local.has(t) ? shade(t) :
    viaRegion.has(t) ? PAL.slate : undefined;

  // geometry space -> frame
  const sw = geo.viewW, sh = geo.viewH;
  const s = Math.min((FW - 40) / sw, (FH - 70) / sh);
  const ox = (FW - sw * s) / 2, oy = 56 + (FH - 70 - sh * s) / 2;
  const P = pt => [r1(pt[0] * s + ox), r1(pt[1] * s + oy)];

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FW} ${FH}" ` +
    `font-family="Verdana,Geneva,sans-serif" role="img" aria-label="Map: ${g.label}">`);
  out.push('<defs><pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
    `<rect width="6" height="6" fill="${PAL.hatchFill}"/>` +
    '<line x1="0" y1="0" x2="0" y2="6" stroke="#a99f8a" stroke-width="1.4"/></pattern></defs>');
  out.push(el('rect', { width: FW, height: FH, fill: PAL.cream }));
  for (const [n, rings] of Object.entries(geo.coarse || geo.towns)) {
    const c = color(n);
    for (const ring of rings) {
      const pp = ring.map(P);
      if (c) out.push(el('polygon', { points: poly(pp), fill: c,
        stroke: PAL.cream, 'stroke-width': 0.6 }));
      else if (hatched.has(n)) out.push(el('polygon', { points: poly(pp),
        fill: 'url(#hatch)', stroke: PAL.cream, 'stroke-width': 0.6 }));
      else out.push(el('polygon', { points: poly(pp), fill: 'none',
        stroke: PAL.boundary, 'stroke-width': 0.35 }));
    }
  }
  for (const ring of geo.state)
    out.push(el('polygon', { points: poly(ring.map(P)),
      fill: 'none', stroke: PAL.faint, 'stroke-width': 1.1 }));
  out.push(text(12, 30, g.label, { 'font-size': 20, 'font-weight': 'bold', fill: PAL.ink }));
  out.push('</svg>');
  return out.join('');
}

function stateMap(ctx, g) {
  const { geo } = ctx;
  const { PAL: P } = require('./svg');
  const FW2 = 960, FH2 = 500;
  const sw = geo.viewW, sh = geo.viewH;
  const s = Math.min((FW2 - 40) / sw, (FH2 - 70) / sh);
  const ox = (FW2 - sw * s) / 2, oy = 56 + (FH2 - 70 - sh * s) / 2;
  const T = pt => `${r1(pt[0] * s + ox)},${r1(pt[1] * s + oy)}`;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FW2} ${FH2}" ` +
    `font-family="Verdana,Geneva,sans-serif" role="img" aria-label="Map: ${g.label}">`);
  out.push(el('rect', { width: FW2, height: FH2, fill: P.cream }));
  const src = geo.coarse || geo.towns;
  for (const rings of Object.values(src))
    for (const ring of rings)
      out.push(el('polygon', { points: ring.map(T).join(' '),
        fill: '#dceadf', stroke: '#b9cfc0', 'stroke-width': 0.4 }));
  for (const ring of geo.state)
    out.push(el('polygon', { points: ring.map(T).join(' '),
      fill: 'none', stroke: P.faint, 'stroke-width': 1.3 }));
  out.push(text(12, 30, g.label, { 'font-size': 20, 'font-weight': 'bold', fill: P.ink }));
  out.push('</svg>');
  return out.join('');
}

module.exports = locmap;
