#!/usr/bin/env node
/*
 * Stage 4 of plan 010: where does composition drift, and does the ten-year
 * test survive its own assumptions?
 *
 *   npm run drift:teachers      → data/csde/teachers/drift.html (gitignored)
 *
 * Four sections, all from the collapsed teacher-year records and the
 * district-year table:
 *
 *   1. Drift across the town districts. For every local or regional district
 *      with at least MIN_TEACHERS in both end years: the change in the share
 *      of teachers at 13 or more years from 2015 to 2025, the typical
 *      year-to-year shape shift, annual turnover, size, and student need
 *      (high-needs share from the Performance Index export). The distribution
 *      of changes, and scatters against size, turnover and need, with
 *      correlations. 2015 is the first full year: the 2014 extract is short.
 *   2. Robustness of the ten-year test: the no-churn prediction against the
 *      actual roster under five variants (2014→2024 head count, 2015→2025,
 *      the alternative counting rule that puts 2014 outside the pre-panel
 *      field, and FTE weighting for both windows).
 *   3. Hiring waves. Districts whose 2014 roster bulged at years 10–12 the way
 *      Glastonbury's did, and what their 13+ share did afterwards.
 *   4. Andover's own entries and exits by experience and year. Private
 *      context for a board member, not for publication: the cells are people.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadTeacherYears } from "./teachers.mjs"
import { parseCsv, isTownDistrict } from "./edsight-client.mjs"
import {
  C, el, text, column, legend, table, emphasisLines, scatter, histogramChart,
  pct, fmt, median, mean, pearson, shares, pageShell,
} from "./teachers-charts.mjs"

const ROOT = join(import.meta.dirname, "..")
const DIR = join(ROOT, "data/csde/teachers")
const OUT = join(DIR, "drift.html")
const PEERS_CSV = join(ROOT, "reports/aes/peer-spending/peer_comparison_2024-25.csv")
const PI_CSV = join(ROOT, "data/edsight/performance-index/performance-index.csv")

const CENSOR = 13
const ANDOVER = "0010011"
const GLASTONBURY = "0540011"
const MIN_TEACHERS = 10
const binIndex = (e) => (e <= 3 ? 0 : e <= 7 ? 1 : e <= 12 ? 2 : 3)

// ------------------------------------------------------------------ data

const { teacherYears } = loadTeacherYears()
const districtYears = JSON.parse(readFileSync(join(DIR, "district-years.json"), "utf8")).records
const foys = [...new Set(teacherYears.map((t) => t.foy))].sort()
const FIRST = foys[0]
const LAST = foys[foys.length - 1]
const START = FIRST + 1 // first full year

const peerNames = parseCsv(readFileSync(PEERS_CSV, "utf8")).slice(1).map((r) => r[0]?.trim()).filter((n) => n && n !== "Norwich")
const nameToCode = new Map(districtYears.map((r) => [r.district, r.districtCode]))
const peerSet = new Set(peerNames.map((n) => nameToCode.get(`${n} School District`)).filter(Boolean))

const towns = teacherYears.filter((t) => isTownDistrict(t.entityType))
const dy = (code, foy) => districtYears.find((r) => r.districtCode === code && r.foy === foy)
const shortName = (code) => (districtYears.find((r) => r.districtCode === code)?.district ?? code).replace(" School District", "")

// High-needs share: ELA test takers flagged high needs over all ELA test
// takers, latest year with both counts. A proxy for the district's student
// need, on the same students the accountability work uses.
const needShare = (() => {
  const rows = parseCsv(readFileSync(PI_CSV, "utf8"))
  const [h, ...body] = rows
  const col = (n) => h.indexOf(n)
  const [iYear, iCode, iGroup, iSubject, iCount] = ["year", "districtCode", "studentGroup", "subject", "count"].map(col)
  const byCodeYear = new Map()
  body
    .filter((r) => r.length > 1 && r[iSubject] === "ELA" && (r[iGroup] === "High Needs" || r[iGroup] === "District") && r[iCount] !== "")
    .forEach((r) => {
      const k = `${r[iCode]}|${r[iYear]}`
      const o = byCodeYear.get(k) ?? byCodeYear.set(k, {}).get(k)
      o[r[iGroup] === "High Needs" ? "hn" : "all"] = Number(r[iCount])
    })
  const out = new Map()
  ;[...byCodeYear.entries()]
    .filter(([, o]) => o.hn != null && o.all)
    .sort(([a], [b]) => a.localeCompare(b)) // later years overwrite earlier
    .forEach(([k, o]) => out.set(k.split("|")[0], o.hn / o.all))
  return out
})()

// ------------------------------------------------- 1. drift across towns

const townCodes = [...new Set(towns.map((t) => t.districtCode))]
const districts = townCodes
  .map((code) => {
    const a = dy(code, START)
    const b = dy(code, LAST)
    if (!a || !b || a.teachers < MIN_TEACHERS || b.teachers < MIN_TEACHERS) return null
    const years = foys.filter((y) => y > START).map((y) => dy(code, y)).filter(Boolean)
    const turnoverYears = foys.filter((y) => y >= START && y < LAST).map((y) => dy(code, y)).filter((r) => r && r.leftDistrict != null)
    return {
      code,
      label: shortName(code),
      size: b.teachers,
      enrollment: b.enrollment,
      from: a.share13plus,
      to: b.share13plus,
      change: b.share13plus - a.share13plus,
      shift: mean(years.map((r) => r.w1FromPrior).filter((v) => v != null)),
      turnover: mean(turnoverYears.map((r) => r.leftDistrict / r.teachers)),
      enrChange: a.enrollment && b.enrollment ? b.enrollment / a.enrollment - 1 : null,
      sizeChange: b.teachers / a.teachers - 1,
      need: needShare.get(code) ?? null,
      peer: peerSet.has(code),
    }
  })
  .filter(Boolean)
  .sort((a, b) => a.change - b.change)

const andover = districts.find((d) => d.code === ANDOVER)
const changes = districts.map((d) => d.change)
const within = (pts) => districts.filter((d) => Math.abs(d.change) <= pts).length
const sizeClass = (d) => (d.size < 50 ? "under 50" : d.size < 150 ? "50–149" : d.size < 400 ? "150–399" : "400 or more")
const classes = ["under 50", "50–149", "150–399", "400 or more"]
const byClass = classes.map((c) => {
  const ds = districts.filter((d) => sizeClass(d) === c)
  return { c, n: ds.length, medChange: median(ds.map((d) => d.change)), medAbs: median(ds.map((d) => Math.abs(d.change))), medShift: median(ds.map((d) => d.shift)), medTurnover: median(ds.map((d) => d.turnover)) }
})
const corr = (f) => {
  const pairs = districts.filter((d) => f(d) != null && Number.isFinite(f(d))).map((d) => [f(d), d.change])
  return { r: pearson(pairs), n: pairs.length }
}
const corrShift = (f) => {
  const pairs = districts.filter((d) => f(d) != null && Number.isFinite(f(d))).map((d) => [f(d), d.shift])
  return { r: pearson(pairs), n: pairs.length }
}
const stats = {
  size: corr((d) => Math.log10(d.size)),
  turnover: corr((d) => d.turnover),
  need: corr((d) => d.need),
  enrChange: corr((d) => d.enrChange),
  sizeChange: corr((d) => d.sizeChange),
  shiftSize: corrShift((d) => Math.log10(d.size)),
  shiftTurnover: corrShift((d) => d.turnover),
}
const r2 = (v) => (v == null ? "" : v.toFixed(2))
const pts = (v) => `${v >= 0 ? "+" : ""}${(100 * v).toFixed(0)} pts`

// --------------------------------------------- 2. ten-year test variants

const in2014 = new Set(teacherYears.filter((t) => t.foy === FIRST).map((t) => t.teacherId))
const altExperience = (t) => t.experience + (in2014.has(t.teacherId) ? 1 : 0) // 2014 outside the pre-panel count
const tenYear = (tys, base, { exp = (t) => t.experience, weight = () => 1 }) => {
  const roster = tys.filter((t) => t.foy === base)
  const actual = tys.filter((t) => t.foy === base + 10)
  const share13 = (xs, e) => {
    const tot = xs.reduce((a, t) => a + weight(t), 0)
    return tot ? xs.filter((t) => e(t) >= CENSOR).reduce((a, t) => a + weight(t), 0) / tot : null
  }
  return {
    n: roster.length,
    predicted: share13(roster, (t) => Math.min(exp(t) + 10, CENSOR)),
    actual: share13(actual, exp),
  }
}
const groups = [
  ["Town districts", towns],
  ["45 elementary-only peers", teacherYears.filter((t) => peerSet.has(t.districtCode))],
  ["Glastonbury", teacherYears.filter((t) => t.districtCode === GLASTONBURY)],
  ["Andover", teacherYears.filter((t) => t.districtCode === ANDOVER)],
]
const variants = [
  [`${FIRST}→${FIRST + 10}, head count`, FIRST, {}],
  [`${START}→${START + 10}, head count`, START, {}],
  [`${FIRST}→${FIRST + 10}, 2014 outside the pre-panel count`, FIRST, { exp: altExperience }],
  [`${FIRST}→${FIRST + 10}, FTE-weighted`, FIRST, { weight: (t) => t.fte }],
  [`${START}→${START + 10}, FTE-weighted`, START, { weight: (t) => t.fte }],
]
const robust = variants.map(([label, base, opts]) => ({ label, cells: groups.map(([, tys]) => tenYear(tys, base, opts)) }))

// --------------------------------------------------- 3. hiring waves

const histOf = (tys) => {
  const h = Array.from({ length: CENSOR + 1 }, () => 0)
  tys.forEach((t) => { h[t.expCapped] += 1 })
  return h.slice(1)
}
const waves = townCodes
  .map((code) => {
    const r2014 = towns.filter((t) => t.districtCode === code && t.foy === FIRST)
    if (r2014.length < 100) return null
    const h = shares(histOf(r2014))
    const late = mean(h.slice(9, 12)) // years 10–12
    const early = mean(h.slice(0, 9)) // years 1–9
    const series = foys.map((y) => dy(code, y)?.share13plus ?? null)
    const peakI = series.indexOf(Math.max(...series.filter((v) => v != null)))
    return { code, label: shortName(code), n: r2014.length, ratio: early ? late / early : null, series, from: series[0], peak: series[peakI], peakYear: foys[peakI], to: series.at(-1) }
  })
  .filter((w) => w && w.ratio != null)
  .sort((a, b) => b.ratio - a.ratio)
const waveCut = 2.2
const waveDistricts = waves.filter((w) => w.ratio >= waveCut)
const flatAfterPeak = waveDistricts.filter((w) => w.peakYear <= 2020 && Math.abs(w.to - w.peak) <= 0.05).length
const stillRising = waveDistricts.filter((w) => w.peakYear >= LAST - 1).length

// ------------------------------------------------ 4. Andover's ledger

const andoverTys = teacherYears.filter((t) => t.districtCode === ANDOVER)
const ledger = foys.map((y) => {
  const here = andoverTys.filter((t) => t.foy === y)
  const entries = here.filter((t) => t.prevDistrict !== ANDOVER).map((t) => ({ exp: t.experience, from: t.prevDistrict == null ? "new to CT public" : shortName(t.prevDistrict) }))
  const exits = here.filter((t) => t.nextDistrict !== ANDOVER).map((t) => ({ exp: t.experience, to: t.nextDistrict == null ? "left CT public" : shortName(t.nextDistrict) }))
  return { y, n: here.length, entries, exits }
})
const list = (xs, key) => xs.map((x) => `${x.exp}${x[key] === "new to CT public" || x[key] === "left CT public" ? "" : ` (${x[key]})`}`).join(", ")

// ------------------------------------------------------------------ page

const xTicks = foys.filter((f) => f % 2 === 1)
const body = `
<h2>1. Drift across the town districts, ${START}–${LAST}</h2>
<p>${districts.length} local and regional districts with at least ${MIN_TEACHERS} teachers in both years. Change in the share of teachers at 13 or more years. Within ±5 points: ${within(0.05)}; within ±10: ${within(0.1)}; beyond ±10: ${districts.length - within(0.1)}. Median change ${pts(median(changes))}; median absolute change ${pts(median(changes.map(Math.abs)))}.</p>
${histogramChart({ values: changes.map((v) => 100 * v), binWidth: 5, min: -40, max: 40, mark: andover ? 100 * andover.change : null, markLabel: "Andover", xFmt: (v) => `${v > 0 ? "+" : ""}${Math.round(v)}` })}
${table(["District", "Teachers " + LAST, `13+ ${START}`, `13+ ${LAST}`, "Change", "Yearly shift", "Turnover", "Enrollment change", "Teachers change", "Need", "Peer"],
  districts.map((d) => [d.label, d.size, pct(d.from), pct(d.to), pts(d.change), d.shift?.toFixed(2), pct(d.turnover, 1), d.enrChange == null ? "" : pct(d.enrChange), pct(d.sizeChange), d.need == null ? "" : pct(d.need), d.peer ? "yes" : ""]))}

<h3>By district size</h3>
${table(["Teachers in " + LAST, "Districts", "Median change", "Median |change|", "Median yearly shift", "Median turnover"],
  byClass.map((c) => [c.c, c.n, pts(c.medChange), pts(c.medAbs), c.medShift?.toFixed(2), pct(c.medTurnover, 1)]), { open: true })}

<h3>Change in the 13+ share against size, turnover and need</h3>
<p>Correlation with change: log size r = ${r2(stats.size.r)} (n = ${stats.size.n}), turnover r = ${r2(stats.turnover.r)}, enrollment change ${START}–${LAST} r = ${r2(stats.enrChange.r)} (n = ${stats.enrChange.n}), teacher-count change r = ${r2(stats.sizeChange.r)}, need r = ${r2(stats.need.r)} (n = ${stats.need.n}). Correlation of the yearly shape shift with log size r = ${r2(stats.shiftSize.r)}, with turnover r = ${r2(stats.shiftTurnover.r)}.</p>
<div class="pair">
${scatter({ points: districts.map((d) => ({ key: d.code, label: d.label, x: d.size, y: d.change })), xLabel: `teachers, ${LAST} (log scale)`, yLabel: "change in 13+ share", xLog: true, xFmt: fmt, accentKey: ANDOVER })}
${scatter({ points: districts.map((d) => ({ key: d.code, label: d.label, x: d.turnover, y: d.change })), xLabel: "annual turnover (left the district)", yLabel: "change in 13+ share", xFmt: (v) => pct(v), accentKey: ANDOVER })}
</div>
<div class="pair">
${scatter({ points: districts.filter((d) => d.need != null).map((d) => ({ key: d.code, label: d.label, x: d.need, y: d.change })), xLabel: "high-needs share of students", yLabel: "change in 13+ share", xFmt: (v) => pct(v), accentKey: ANDOVER })}
${scatter({ points: districts.filter((d) => d.enrChange != null).map((d) => ({ key: d.code, label: d.label, x: d.enrChange, y: d.change })), xLabel: `enrollment change, ${START}–${LAST}`, yLabel: "change in 13+ share", xFmt: (v) => pts(v).replace(" pts", "%"), accentKey: ANDOVER })}
</div>
<div class="pair">
${scatter({ points: districts.map((d) => ({ key: d.code, label: d.label, x: d.sizeChange, y: d.change })), xLabel: `change in teacher count, ${START}–${LAST}`, yLabel: "change in 13+ share", xFmt: (v) => pts(v).replace(" pts", "%"), accentKey: ANDOVER })}
${scatter({ points: districts.map((d) => ({ key: d.code, label: d.label, x: d.size, y: d.shift })), xLabel: `teachers, ${LAST} (log scale)`, yLabel: "mean yearly shift (years)", xLog: true, xFmt: fmt, yFmt: (v) => v.toFixed(1), accentKey: ANDOVER })}
</div>

<h2>2. Does the ten-year test survive its assumptions?</h2>
<p>Predicted share at 13 or more years if nobody had left or arrived, against the actual share ten years later, under each variant.</p>
${table(["Variant", ...groups.map(([g]) => g)],
  robust.map((v) => [v.label, ...v.cells.map((c) => `${pct(c.predicted)} → ${pct(c.actual)}`)]), { open: true })}
<p class="note">Read each cell as predicted → actual. The alternative counting rule adds a year to everyone present in 2014, which can only raise the prediction. FTE weighting counts part-time teachers by their FTE.</p>

<h2>3. Hiring waves</h2>
<p>Districts with at least 100 teachers in ${FIRST} whose ${FIRST} roster had at least ${waveCut}× as many teachers per year at years 10–12 as at years 1–9: ${waveDistricts.length} of ${waves.length}. Of those, ${flatAfterPeak} peaked by 2020 and have since moved less than 5 points; ${stillRising} were still at their peak in ${LAST - 1} or ${LAST}. Glastonbury in gold; all town districts in navy.</p>
${emphasisLines({ xDomain: [FIRST, LAST], xTicks, lines: [...waveDistricts.map((w) => ({ key: w.code, label: w.label, points: foys.map((y, i) => [y, w.series[i]]) })), { key: "towns", label: "All town districts", points: foys.map((y) => [y, dy("towns", y)?.share13plus ?? null]) }], accentKey: GLASTONBURY, refKey: "towns" })}
${table(["District", `Teachers ${FIRST}`, "Bulge ratio", `13+ ${FIRST}`, "Peak", "Peak year", `13+ ${LAST}`],
  waveDistricts.map((w) => [w.label, w.n, w.ratio.toFixed(2), pct(w.from), pct(w.peak), w.peakYear, pct(w.to)]), { open: true })}

<h2>4. Andover's entries and exits</h2>
<p>Private context, not for publication. Experience in the year of arrival (first year in Andover) and in the last year before leaving; a district in parentheses is where the teacher came from or went to within CT public schools.</p>
${table(["FOY", "Teachers", "Arrived (experience)", "Left after this year (experience)"],
  ledger.map((l) => [l.y, l.n, list(l.entries, "from"), l.y === LAST ? "" : list(l.exits, "to")]), { open: true })}
`

writeFileSync(OUT, pageShell({
  title: `Where teacher composition drifts, ${START}–${LAST}`,
  intro: `Exploratory, not for publication. Stage 4 of the teacher-workforce analysis: drift across districts, robustness of the ten-year test, hiring waves, and Andover's own ledger.`,
  body,
}))

console.log(`${districts.length} town districts: change in 13+ share ${START}→${LAST} median ${pts(median(changes))}, |change| median ${pts(median(changes.map(Math.abs)))}, within ±5: ${within(0.05)}, within ±10: ${within(0.1)}`)
byClass.forEach((c) => console.log(`  ${c.c.padEnd(12)} n=${c.n} median change ${pts(c.medChange)} |change| ${pts(c.medAbs)} shift ${c.medShift?.toFixed(2)} turnover ${pct(c.medTurnover, 1)}`))
console.log(`correlations with change: log size ${r2(stats.size.r)}, turnover ${r2(stats.turnover.r)}, enrollment change ${r2(stats.enrChange.r)} (n=${stats.enrChange.n}), teacher-count change ${r2(stats.sizeChange.r)}, need ${r2(stats.need.r)} (n=${stats.need.n}); shift vs log size ${r2(stats.shiftSize.r)}`)
if (andover) console.log(`Andover: ${pct(andover.from)} → ${pct(andover.to)} (${pts(andover.change)}), shift ${andover.shift.toFixed(2)}, turnover ${pct(andover.turnover, 1)}, enrollment ${pts(andover.enrChange).replace(' pts', '%')}, teachers ${pts(andover.sizeChange).replace(' pts', '%')}, need ${pct(andover.need)}`)
console.log(`hiring-wave districts still rising: ${stillRising} of ${waveDistricts.length}`)
robust.forEach((v) => console.log(`${v.label}: ${v.cells.map((c, i) => `${groups[i][0]} ${pct(c.predicted)}→${pct(c.actual)}`).join(" | ")}`))
console.log(`hiring-wave districts (ratio >= ${waveCut}): ${waveDistricts.map((w) => `${w.label} ${pct(w.from)}→${pct(w.peak)}@${w.peakYear}→${pct(w.to)}`).join("; ")}`)
console.log(`wrote ${OUT}`)
