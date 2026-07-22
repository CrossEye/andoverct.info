'use strict';
// <% datatable <group> [window=FY0:FY1] [basis=skip] %>
// Emits an aligned markdown table plus the Notes blockquote. By default the
// Notes open with the shared data-basis sentence so each table is
// self-contained (the mode a standalone generator wants); basis=skip omits it
// for documents that state the basis once in their methodology, and the
// blockquote disappears entirely when no group-specific notes remain.

const { resolveGroup, seriesFor } = require('./resolve');
const money = v => '$' + Math.round(v).toLocaleString('en-US');
const num = v => v.toLocaleString('en-US');

function datatable(ctx, groupId, args = {}) {
  const { data } = ctx;
  const g = resolveGroup(data, groupId);
  const [fy0, fy1] = (args.window || '2013:2023').split(':').map(Number);
  const weighting = args.weighting || 'enrollment';
  const rows = seriesFor(data, g, fy0, fy1, weighting);

  const header = ['Fiscal year', 'School year', 'Students', 'Total current spending', 'Per pupil'];
  const body = rows.map(r => [String(r.fy),
    `${r.fy - 1}-${String(r.fy).slice(2)}`, num(r.enr), money(r.exp), money(r.pp)]);
  const w = header.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)));
  const pad = (s, i) => i >= 2 ? s.padStart(w[i]) : s.padEnd(w[i]);
  const line = cells => '| ' + cells.map(pad).join(' | ') + ' |';
  const rule = '|' + w.map((n, i) =>
    (i >= 2 ? '-'.repeat(n + 1) + ':' : '-'.repeat(n + 2))).join('|') + '|';

  const md = [line(header), rule, ...body.map(line)].join('\n');
  const parts = [];
  if (args.basis !== 'skip') {
    const multi = g.included.length > 1;
    const ppNote = weighting === 'equal'
      ? 'Per pupil is the plain average of the member districts’ own ' +
        'per-pupil figures (equal weighting: one district, one vote)' +
        (multi ? ', so it does not equal total spending divided by total students.' : '.')
      : 'Per pupil is combined spending divided by combined students, ' +
        'which weights each district by its enrollment.';
    parts.push(`${data.basis} ${ppNote}`);
  }
  if (g.represented && g.represented.length)
    parts.push(g.represented.map(r =>
      `${r.name} has no local district but is fully represented through ` +
      `${r.via}, included above`).join('; ') + '.');
  if (g.excluded.length)
    parts.push('Excluded from the aggregate: ' + g.excluded.map(e =>
      `${e.name} (${e.reason})`).join('; ') + '.');
  if (!parts.length) return md;
  return md + '\n\n' + `> **Notes:** ${parts.join(' ')}`;
}

module.exports = datatable;
