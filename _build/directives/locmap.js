'use strict';
// <% locmap <group> %>
// Locator map: full CT with the group's towns highlighted, plus a zoomed
// regional inset framed on the main map. Coloring: town covered by a listed
// regional district AND listed itself -> dark green ("both"); listed town
// only -> medium green; covered via region only -> slate; group towns with
// no local district -> hatched.

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

function locmap(ctx, groupId) {
  const { data, geo } = ctx;
  const g = resolveGroup(data, groupId);
  if (g.included.some(n => data.units[n].type === 'state'))
    return stateMap(ctx, g);
  const { local, viaRegion, hatched } = classify(data, g);
  const color = t =>
    hatched.has(t) ? null :
    local.has(t) && viaRegion.has(t) ? PAL.green :
    local.has(t) ? PAL.ringFill :
    viaRegion.has(t) ? PAL.slate : undefined;

  // geometry space -> two panels
  const sw = geo.viewW, sh = geo.viewH;
  const mainW = 600, mainH = FH - 60;
  const s = Math.min(mainW / sw, mainH / sh);
  const ox = 10, oy = 50 + (mainH - sh * s) / 2;
  const P = (pt, sc, o) => [r1(pt[0] * sc.k + o.x), r1(pt[1] * sc.k + o.y)];

  // zoom box: bbox of highlighted towns, padded
  const names = [...local, ...viaRegion, ...hatched];
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const n of names) for (const ring of (geo.towns[n] || []))
    for (const [x, y] of ring) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  const zp = 12; x0 -= zp; y0 -= zp; x1 += zp; y1 += zp;
  const insW = 320, insH = FH - 80, insX = FW - insW - 12, insY = 56;
  const zs = Math.min(insW / (x1 - x0), insH / (y1 - y0));

  const paintAll = (sc, o, lw, source, clipBox) => {
    const out = [];
    for (const [n, rings] of Object.entries(source)) {
      if (clipBox && !ringsIntersect(rings, clipBox)) continue;
      const c = color(n);
      for (const ring of rings) {
        const pp = ring.map(pt => P(pt, sc, o));
        if (c) out.push(el('polygon', { points: poly(pp), fill: c,
          stroke: PAL.townEdge, 'stroke-width': 0.5 * lw }));
        else if (hatched.has(n)) out.push(el('polygon', { points: poly(pp),
          fill: 'url(#hatch)', stroke: PAL.townEdge, 'stroke-width': 0.5 * lw }));
        else out.push(el('polygon', { points: poly(pp), fill: 'none',
          stroke: PAL.boundary, 'stroke-width': 0.35 * lw }));
      }
    }
    for (const ring of geo.state)
      out.push(el('polygon', { points: poly(ring.map(pt => P(pt, sc, o))),
        fill: 'none', stroke: PAL.faint, 'stroke-width': 1.1 * lw }));
    return out.join('');
  };

  const ringsIntersect = (rings, [bx0, by0, bx1, by1]) => {
    for (const ring of rings) for (const [x, y] of ring)
      if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) return true;
    // also keep shapes that span past the box on all sides
    let lo = [1e9, 1e9], hi = [-1e9, -1e9];
    for (const ring of rings) for (const [x, y] of ring) {
      if (x < lo[0]) lo[0] = x; if (y < lo[1]) lo[1] = y;
      if (x > hi[0]) hi[0] = x; if (y > hi[1]) hi[1] = y;
    }
    return lo[0] <= bx1 && hi[0] >= bx0 && lo[1] <= by1 && hi[1] >= by0;
  };

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FW} ${FH}" ` +
    `font-family="Verdana,Geneva,sans-serif" role="img" aria-label="Map: ${g.label}">`);
  out.push('<defs><pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
    `<rect width="6" height="6" fill="${PAL.hatchFill}"/>` +
    '<line x1="0" y1="0" x2="0" y2="6" stroke="#a99f8a" stroke-width="1.4"/></pattern></defs>');
  out.push(el('rect', { width: FW, height: FH, fill: PAL.cream }));
  out.push(paintAll({ k: s }, { x: ox, y: oy }, 1, geo.coarse || geo.towns));
  // zoom frame on main
  const zb = [P([x0, y0], { k: s }, { x: ox, y: oy }), P([x1, y1], { k: s }, { x: ox, y: oy })];
  out.push(el('rect', { x: zb[0][0], y: zb[0][1],
    width: r1(zb[1][0] - zb[0][0]), height: r1(zb[1][1] - zb[0][1]),
    fill: 'none', stroke: PAL.ink, 'stroke-width': 1.4 }));
  // inset (clipped)
  out.push(`<clipPath id="ins"><rect x="${insX}" y="${insY}" width="${insW}" height="${insH}"/></clipPath>`);
  out.push(`<g clip-path="url(#ins)">` +
    paintAll({ k: zs }, { x: insX - x0 * zs, y: insY - y0 * zs }, 1.8,
      geo.towns, [x0, y0, x1, y1]) + '</g>');
  out.push(el('rect', { x: insX, y: insY, width: insW, height: insH,
    fill: 'none', stroke: PAL.ink, 'stroke-width': 1.4 }));
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
