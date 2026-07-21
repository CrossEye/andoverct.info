'use strict';
// Group resolution: membership -> included units, honest exclusions, aggregated series.

function resolveGroup(data, groupId) {
  const g = data.groups[groupId];
  if (!g) throw new Error(`Unknown group '${groupId}'`);
  const included = [], excluded = [];
  for (const name of g.members) {
    const u = data.units[name];
    if (!u) { excluded.push({ name, reason: 'not in dataset' }); continue; }
    if (u.type === 'town' && u.local_district === false) {
      const regs = (u.regions || []).join(', ');
      excluded.push({ name, reason: regs
        ? `no local district; member of ${regs}` : 'no local district' });
      continue;
    }
    included.push(name);
  }
  return { id: groupId, label: g.label, definition: g.definition || '',
           included, excluded };
}

// weighting: 'enrollment' (combined exp / combined enr). 'equal' reserved.
function seriesFor(data, resolved, fy0, fy1, weighting) {
  if (weighting && weighting !== 'enrollment')
    throw new Error(`weighting '${weighting}' not implemented (v1 supports 'enrollment')`);
  const yi = new Map(data.years.map((y, i) => [y, i]));
  const rows = [];
  for (let y = fy0; y <= fy1; y++) {
    const i = yi.get(y);
    if (i === undefined) continue;
    let enr = 0, exp = 0, ok = true;
    for (const name of resolved.included) {
      const u = data.units[name];
      const e = u.enr && u.enr[i], x = u.exp && u.exp[i];
      if (e == null || x == null) { ok = false; break; }
      enr += e; exp += x;
    }
    if (ok && enr > 0) rows.push({ fy: y, enr, exp, pp: exp / enr });
  }
  if (!rows.length) throw new Error(`No complete years for '${resolved.id}' in ${fy0}-${fy1}`);
  return rows;
}

module.exports = { resolveGroup, seriesFor };
