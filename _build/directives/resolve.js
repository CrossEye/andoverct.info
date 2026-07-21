'use strict';
// Group resolution: membership -> included units, honest exclusions, aggregated series.

function resolveGroup(data, groupId) {
  const g = data.groups[groupId];
  if (!g) throw new Error(`Unknown group '${groupId}'`);
  const included = [], noLocal = [];
  for (const name of g.members) {
    const u = data.units[name];
    if (!u) { noLocal.push({ name, reason: 'not in dataset' }); continue; }
    if (u.type === 'town' && u.local_district === false) {
      noLocal.push({ name, regions: u.regions || [] });
      continue;
    }
    included.push(name);
  }
  // A town with no local district is only truly excluded when no included
  // regional district covers it; a covered town (e.g. Haddam once Region 17
  // joins) is fully represented through that region.
  const coveredBy = name => included.find(n => {
    const u = data.units[n];
    return u.type === 'region' && (u.members || []).includes(name);
  });
  const excluded = [], represented = [];
  for (const e of noLocal) {
    const via = coveredBy(e.name);
    if (via) represented.push({ name: e.name, via });
    else excluded.push({ name: e.name,
      reason: e.reason || (e.regions.length
        ? `no local district; member of ${e.regions.join(', ')}`
        : 'no local district') });
  }
  return { id: groupId, label: g.label, definition: g.definition || '',
           included, excluded, represented };
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
