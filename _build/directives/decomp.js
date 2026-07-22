'use strict';
// <% decomp <group> [window=FY0:FY1] [weighting=enrollment] %>
// Renders the four-line decomposition chart (per-pupil, spending, enrollment,
// CPI, cumulative % since the window's first year) as an inline SVG string.

const { PAL, el, text, poly, r1 } = require('./svg');
const { resolveGroup, seriesFor } = require('./resolve');

const FW = 960, FH = 640;                       // frame
const M = { l: 58, r: 190, t: 96, b: 44 };      // margins (right holds labels)

function decomp(ctx, groupId, args = {}) {
  const { data, cpi } = ctx;
  const g = resolveGroup(data, groupId);
  let [fy0, fy1] = (args.window || '2013:2023').split(':').map(Number);
  const rows = seriesFor(data, g, fy0, fy1, args.weighting || 'enrollment');
  fy0 = rows[0].fy; fy1 = rows[rows.length - 1].fy;

  const base = rows[0];
  const cum = f => rows.map(r => (f(r) / f(base) - 1) * 100);
  const pp = cum(r => r.pp), sp = cum(r => r.exp), en = cum(r => r.enr);
  const cp = rows.map(r => (cpi.values[r.fy] / cpi.values[fy0] - 1) * 100);

  const lo = Math.min(0, ...en, ...sp), hi = Math.max(...pp, ...sp, ...cp);
  const pad = (hi - lo) * 0.10;
  const y0 = lo - pad, y1 = hi + pad;
  const X = fy => M.l + (fy - fy0) / (fy1 - fy0) * (FW - M.l - M.r);
  const Y = v => M.t + (y1 - v) / (y1 - y0) * (FH - M.t - M.b);
  const pts = arr => rows.map((r, i) => [r1(X(r.fy)), r1(Y(arr[i]))]);

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FW} ${FH}" ` +
    `font-family="Georgia,serif" role="img" aria-label="${g.label}: spending, students, and inflation">`);
  out.push(el('rect', { width: FW, height: FH, fill: PAL.cream }));

  // gridlines + y ticks (steps of 10 or 20 depending on range)
  const step = (y1 - y0) > 120 ? 20 : 10;
  for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) {
    out.push(el('line', { x1: M.l, x2: FW - M.r, y1: r1(Y(v)), y2: r1(Y(v)),
      stroke: PAL.grid, 'stroke-width': 1 }));
    out.push(text(M.l - 8, Y(v) + 4, (v > 0 ? '+' : '') + v + '%',
      { 'text-anchor': 'end', 'font-size': 12, fill: '#5a5446' }));
  }
  // enrollment shading, zero line
  out.push(el('polygon', { points: poly([[X(fy0), Y(0)], ...pts(en), [X(fy1), Y(0)]]),
    fill: PAL.slate, opacity: 0.10 }));
  out.push(el('line', { x1: M.l, x2: FW - M.r, y1: r1(Y(0)), y2: r1(Y(0)),
    stroke: PAL.faint, 'stroke-width': 1.2 }));

  // series
  const line = (arr, stroke, w, dash) =>
    el('polyline', { points: poly(pts(arr)), fill: 'none', stroke,
      'stroke-width': w, ...(dash ? { 'stroke-dasharray': dash } : {}) });
  out.push(line(sp, PAL.gold, 3, '9,5'));
  out.push(line(cp, PAL.purple, 2.6, '2.5,4'));
  out.push(line(en, PAL.slate, 3.2));
  pts(en).forEach(p => out.push(el('rect',
    { x: p[0] - 3.4, y: p[1] - 3.4, width: 6.8, height: 6.8,
      fill: PAL.slate, stroke: '#fff', 'stroke-width': 1.1 })));
  out.push(line(pp, PAL.green, 4.2));
  pts(pp).forEach(p => out.push(el('circle',
    { cx: p[0], cy: p[1], r: 4.6, fill: PAL.green, stroke: '#fff', 'stroke-width': 1.2 })));

  // x axis labels, thinned to a stride that fits the plot width so long
  // windows (the explore tool allows ~30-year spans) stay readable. Short
  // windows show every year; the first and last are always labelled.
  const plotW = FW - M.l - M.r;
  const maxTicks = Math.max(2, Math.floor(plotW / 48));
  const stride = Math.max(1, Math.ceil(rows.length / maxTicks));
  const showYear = i =>
    i === 0 || i === rows.length - 1 ||
    (i % stride === 0 && i <= rows.length - 1 - stride);
  rows.forEach((r, i) => {
    if (!showYear(i)) return;
    out.push(text(X(r.fy), FH - M.b + 22, 'FY' + r.fy,
      { 'text-anchor': 'middle', 'font-size': 11.5, fill: '#5a5446' }));
  });

  // end labels with simple collision spreading
  const last = a => a[a.length - 1];
  const fmt = (v, sign = true) => (sign && v >= 0 ? '+' : '') + Math.round(v) + '%';
  const labels = [
    { v: last(pp), t: `Per-pupil  ${fmt(last(pp))}`, c: PAL.green, s: 15, w: 'bold' },
    { v: last(sp), t: `Total spending  ${fmt(last(sp))}`, c: PAL.goldText, s: 13.5, w: 'bold' },
    { v: last(cp), t: `Inflation  ${fmt(last(cp))}`, c: PAL.purple, s: 13.5, w: 'bold' },
    { v: last(en), t: `Enrollment  ${fmt(last(en))}`, c: PAL.slate, s: 13.5, w: 'bold' },
  ].sort((a, b) => b.v - a.v);
  const minGap = 20;
  let ys = labels.map(l => Y(l.v));
  for (let i = 1; i < ys.length; i++)
    if (ys[i] - ys[i - 1] < minGap) ys[i] = ys[i - 1] + minGap;
  labels.forEach((l, i) => out.push(text(FW - M.r + 12, ys[i] + 5, l.t,
    { 'font-size': l.s, 'font-weight': l.w, fill: l.c,
      'font-family': 'Verdana,Geneva,sans-serif' })));

  // titles + source line
  out.push(text(12, 30, `${g.label}`, { 'font-size': 22, 'font-weight': 'bold', fill: PAL.ink,
    'font-family': 'Verdana,Geneva,sans-serif' }));
  out.push(text(12, 54,
    `Cumulative change since FY${fy0}: per-pupil cost, total current spending, enrollment, and inflation`,
    { 'font-size': 12.5, fill: PAL.sub }));
  out.push(text(12, FH - 10,
    'Sources: NCES/Census F-33 (NCES basis; includes state-paid teacher retirement) \u00b7 BLS CPI-U, July\u2013June averages',
    { 'font-size': 10, fill: PAL.faint }));
  out.push('</svg>');
  return out.join('');
}

module.exports = decomp;
