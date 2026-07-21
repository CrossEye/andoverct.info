'use strict';
// <% datatable <group> [window=FY0:FY1] %>
// Emits an aligned markdown table plus the Notes blockquote.

const { resolveGroup, seriesFor } = require('./resolve');
const money = v => '$' + Math.round(v).toLocaleString('en-US');
const num = v => v.toLocaleString('en-US');

function datatable(ctx, groupId, args = {}) {
  const { data } = ctx;
  const g = resolveGroup(data, groupId);
  const [fy0, fy1] = (args.window || '2013:2023').split(':').map(Number);
  const rows = seriesFor(data, g, fy0, fy1, 'enrollment');

  const header = ['Fiscal year', 'School year', 'Students', 'Total current spending', 'Per pupil'];
  const body = rows.map(r => [String(r.fy),
    `${r.fy - 1}-${String(r.fy).slice(2)}`, num(r.enr), money(r.exp), money(r.pp)]);
  const w = header.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)));
  const pad = (s, i) => i >= 2 ? s.padStart(w[i]) : s.padEnd(w[i]);
  const line = cells => '| ' + cells.map(pad).join(' | ') + ' |';
  const rule = '|' + w.map((n, i) =>
    (i >= 2 ? '-'.repeat(n + 1) + ':' : '-'.repeat(n + 2))).join('|') + '|';

  const md = [line(header), rule, ...body.map(line)].join('\n');
  let notes = `> **Notes:** ${data.basis} Per pupil is combined spending divided ` +
    'by combined students, which weights each district by its enrollment.';
  if (g.excluded.length)
    notes += ' Excluded from the aggregate: ' + g.excluded.map(e =>
      `${e.name} (${e.reason})`).join('; ') + '.';
  return md + '\n\n' + notes;
}

module.exports = datatable;
