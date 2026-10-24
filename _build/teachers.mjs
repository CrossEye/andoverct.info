#!/usr/bin/env node
/*
 * Builds the teacher-workforce tables from the CSDE teacher-level staffing panel
 * described in data/csde/teachers/provenance.md:
 *
 *   npm run build:teachers
 *
 * The raw file is one row per teacher per assignment per Fall of Year (FOY),
 * 2014 through 2025. This module reduces it in two steps and writes the
 * results next to it in data/csde/teachers/ (all gitignored; see .gitignore):
 *
 *   teacher-years.csv    one row per teacher per FOY after the collapsing rules
 *                        below. Still teacher-level, so still never published.
 *   district-years.csv   one row per district per FOY: head count, FTE, median
 *   district-years.json  and mean experience, four experience bins (head count
 *   district-years.xlsx  and FTE-weighted), degree lanes, entries, exits,
 *                        retention, and the year-over-year distribution shift.
 *                        Two synthetic "districts" carry the state and the
 *                        town-governed (local + regional) aggregate.
 *   sanity.md            every profiling number the methodology cites,
 *                        regenerated on each run so it cannot go stale.
 *
 * Rules applied (plan 010, "Decisions"), each pending CSDE confirmation where
 * marked:
 *
 *   - Experience in FOY y = Years_2002to2014 + (panel years after 2014 through
 *     y in which the teacher appears). Years_2002to2014 counts school years
 *     2002-03 through 2014-15 and is capped at 13, so FOY 2014 is already in
 *     it and is not counted again (PRE_PANEL_INCLUDES_2014; pending CSDE).
 *     Gap years earn nothing. The result is "years in CT public schools since
 *     2002", a floor on real experience, maxing out at 24 in FOY 2025.
 *   - That cap left-censors the senior end: 39% of the 2014 teachers sit at
 *     exactly 13 and could really have anything from 13 to 40 years. Any
 *     threshold at or below 13 years is still exact in every year, because
 *     censoring only blurs values above it, so the bins stop at "13 or more"
 *     (0–3, 4–7, 8–12, 13+), the year-over-year shape shift is measured on
 *     experience capped at 13 (CENSOR), and the uncapped mean is reported
 *     only as a censored figure. Medians are exact whenever they fall below
 *     13 + (FOY − 2014), which they do throughout.
 *   - One teacher-year has one FTE: the assignment rows are summed and the sum
 *     is capped at 1.0. The uncapped sum and a flag are kept.
 *   - A teacher-year is assigned to the district holding the most of their
 *     FTE (ties to the lower code); role, school and GET/SE come from the
 *     largest assignment in that district.
 *   - HighestDegree is a per-teacher snapshot in this delivery (it never
 *     changes across years), so lanes are carried through but any lane
 *     time series is biased toward later credentials. Pending CSDE.
 *   - Lanes collapse to four: No BA/BS and Associate (CTECS trades) fold into
 *     "Bachelor's or less"; PhD/EdD is "Doctorate".
 *
 * Other scripts can `import { loadTeacherYears } from "./teachers.mjs"` to get
 * the collapsed teacher-year records without re-implementing the rules.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import ExcelJS from "exceljs"
import { parseCsv, toCsv, entityType, isTownDistrict, writeRecordsJson } from "./edsight-client.mjs"

const ROOT = join(import.meta.dirname, "..")
const DIR = join(ROOT, "data/csde/teachers")
const RAW_DIR = join(DIR, "raw")

const PANEL_START = 2014
// Every teacher present in FOY 2014 has Years_2002to2014 >= 1 and the field
// tops out at 13 = the thirteen school years 2002-03..2014-15, so FOY 2014 is
// inside the pre-panel count. Flip this if CSDE says otherwise.
const PRE_PANEL_INCLUDES_2014 = true

const LANES = {
  "No BA/BS": "Bachelor's or less",
  "Associate": "Bachelor's or less",
  "Bachelor's": "Bachelor's or less",
  "Master's": "Master's",
  "Sixth Year": "Sixth Year",
  "PhD/EdD": "Doctorate",
}
const LANE_KEYS = {
  "Bachelor's or less": "laneBachelorsOrLess",
  "Master's": "laneMasters",
  "Sixth Year": "laneSixthYear",
  "Doctorate": "laneDoctorate",
}
const DEGREE_RANK = ["No BA/BS", "Associate", "Bachelor's", "Master's", "Sixth Year", "PhD/EdD"]

// Years_2002to2014 tops out at 13, so 13 is the highest threshold that is
// observed exactly in every year of the panel. It is also about where CT
// salary schedules reach their top step, which makes "13 or more" the natural
// proxy for "at or near the top of the schedule".
const CENSOR = 13
const BINS = [
  { key: "0to3", label: "0–3", min: 0, max: 3 },
  { key: "4to7", label: "4–7", min: 4, max: 7 },
  { key: "8to12", label: "8–12", min: 8, max: 12 },
  { key: "13plus", label: "13 or more", min: 13, max: Infinity },
]
const binOf = (exp) => BINS.find((b) => exp >= b.min && exp <= b.max).key

// The two synthetic aggregates, keyed like districts so they flow through the
// same code and sort first in every output.
const STATE = { districtCode: "state", district: "State of Connecticut", entityType: "state" }
const TOWNS = { districtCode: "towns", district: "Town districts (local + regional)", entityType: "towns" }

const ANDOVER = "0010011"

// ------------------------------------------------------------------ helpers

const sum = (xs) => xs.reduce((a, b) => a + b, 0)
const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d)
const sorted = (xs) => [...xs].sort((a, b) => a - b)
const quantile = (xsSorted, q) => {
  if (!xsSorted.length) return null
  const pos = (xsSorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return xsSorted[lo] + (xsSorted[hi] - xsSorted[lo]) * (pos - lo)
}
const counter = (xs, key = (x) => x) =>
  xs.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map())
const sumBy = (xs, key, val) =>
  xs.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + val(x)), new Map())
const fmt = (n) => (n == null ? "" : n.toLocaleString("en-US"))
const pct = (x, d = 1) => (x == null ? "" : `${(x * 100).toFixed(d)}%`)

// --------------------------------------------------------------------- load

const rawFile = () => {
  const names = readdirSync(RAW_DIR).filter((f) => f.toLowerCase().endsWith(".csv"))
  if (names.length !== 1) throw new Error(`expected exactly one .csv in ${RAW_DIR}, found ${names.length}`)
  return join(RAW_DIR, names[0])
}

const readRaw = () => {
  const file = rawFile()
  const text = readFileSync(file, "utf8")
  const rows = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  const header = rows[0].map((h) => h.trim())
  const col = (name) => {
    const i = header.indexOf(name)
    if (i < 0) throw new Error(`raw file is missing the ${name} column`)
    return i
  }
  const c = {
    foy: col("FallOfYear"),
    id: col("TEACHER_ID"),
    districtCode: col("ReportingDistrictCode"),
    district: col("DistrictName"),
    schoolCode: col("SchoolCode"),
    school: col("SchoolName"),
    sspType: col("X_SSPTypeCode"),
    roleCode: col("ProfEducJobClassificCode"),
    role: col("ProfEducJobClassificType"),
    degree: col("HighestDegree"),
    pre: col("Years_2002to2014"),
    fte: col("FullTimeEquivalency"),
  }
  const records = rows
    .slice(1)
    .filter((r) => r.length > 1)
    .map((r) => ({
      foy: Number(r[c.foy]),
      teacherId: r[c.id],
      districtCode: r[c.districtCode].trim(),
      district: r[c.district].trim(),
      schoolCode: r[c.schoolCode].trim(),
      school: r[c.school].trim(),
      sspType: r[c.sspType].trim(),
      roleCode: r[c.roleCode].trim(),
      role: r[c.role].trim(),
      degree: r[c.degree].trim(),
      pre: Number(r[c.pre]),
      fte: Number(r[c.fte]) || 0,
    }))
  return { file, header, records }
}

// --------------------------------------------------------- teacher-years

/*
 * Collapse one teacher's rows for one year into a single record. See the
 * header comment for the rules; this is where they live.
 */
const collapse = (rows) => {
  const fteByDistrict = sumBy(rows, (r) => r.districtCode, (r) => r.fte)
  const [home] = [...fteByDistrict.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  const homeRows = rows.filter((r) => r.districtCode === home)
  const main = homeRows.reduce((a, r) => (r.fte > a.fte ? r : a))
  const fteBySsp = sumBy(homeRows, (r) => r.sspType, (r) => r.fte)
  const [sspType] = [...fteBySsp.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  const fteRaw = round(sum(rows.map((r) => r.fte)), 4)
  const degrees = new Set(rows.map((r) => r.degree))
  return {
    teacherId: main.teacherId,
    foy: main.foy,
    districtCode: home,
    district: main.district,
    entityType: entityType(home, main.district),
    schoolCode: main.schoolCode,
    school: main.school,
    sspType,
    roleCode: main.roleCode,
    role: main.role,
    degree: main.degree,
    lane: LANES[main.degree] ?? "Unknown",
    pre: main.pre,
    fteRaw,
    fte: Math.min(1, fteRaw),
    fteCapped: fteRaw > 1.0001,
    assignments: rows.length,
    districts: fteByDistrict.size,
    mixedSsp: fteBySsp.size > 1,
    mixedDegree: degrees.size > 1,
  }
}

/*
 * Reduce the raw rows to teacher-year records with reconstructed experience
 * and the panel context (first/last year seen, gap years, where the teacher
 * was the year before and the year after). Returns the records plus the
 * per-teacher checks the sanity report needs.
 */
const buildTeacherYears = (records) => {
  // Hot path over half a million rows: one pass into nested maps.
  const byTeacher = new Map()
  for (const r of records) {
    const years = byTeacher.get(r.teacherId) ?? byTeacher.set(r.teacherId, new Map()).get(r.teacherId)
    const rows = years.get(r.foy) ?? years.set(r.foy, []).get(r.foy)
    rows.push(r)
  }

  const checks = { preVaries: 0, degreeVariesAcrossYears: 0, teachers: byTeacher.size }
  const out = []
  byTeacher.forEach((yearMap, teacherId) => {
    const years = sorted(yearMap.keys())
    const tys = years.map((y) => collapse(yearMap.get(y)))
    const pres = new Set(tys.map((t) => t.pre))
    const degs = new Set(tys.map((t) => t.degree))
    checks.preVaries += pres.size > 1 ? 1 : 0
    checks.degreeVariesAcrossYears += degs.size > 1 ? 1 : 0
    const first = years[0]
    const last = years[years.length - 1]
    const byYear = new Map(tys.map((t) => [t.foy, t]))
    tys.forEach((t, i) => {
      const panelYears = years.filter((y) => y <= t.foy && (PRE_PANEL_INCLUDES_2014 ? y > PANEL_START : y >= PANEL_START)).length
      const prev = byYear.get(t.foy - 1)
      const next = byYear.get(t.foy + 1)
      const experience = t.pre + panelYears
      out.push({
        ...t,
        experience,
        expCapped: Math.min(experience, CENSOR),
        firstSeen: first,
        lastSeen: last,
        gapYearsSoFar: t.foy - first - i,
        prevDistrict: prev?.districtCode ?? null,
        nextDistrict: next?.districtCode ?? null,
      })
    })
  })
  return { teacherYears: out, checks }
}

export const loadTeacherYears = () => {
  const { records, file, header } = readRaw()
  const built = buildTeacherYears(records)
  return { ...built, records, file, header }
}

// -------------------------------------------------------- district-years

const w1 = (histA, histB) => {
  // Earth-mover distance between two integer distributions, in years.
  const n = Math.max(histA.length, histB.length)
  const totA = sum(histA)
  const totB = sum(histB)
  if (!totA || !totB) return null
  let ca = 0
  let cb = 0
  let d = 0
  for (let k = 0; k < n; k++) {
    ca += (histA[k] ?? 0) / totA
    cb += (histB[k] ?? 0) / totB
    d += Math.abs(ca - cb)
  }
  return d
}

const histogram = (exps, maxExp) => {
  const h = Array.from({ length: maxExp + 1 }, () => 0)
  exps.forEach((e) => { h[e] += 1 })
  return h
}

const aggregate = (group, tys, foy, { firstFoy, lastFoy }) => {
  const exps = sorted(tys.map((t) => t.experience))
  const capped = tys.map((t) => t.expCapped)
  const n = tys.length
  const fte = sum(tys.map((t) => t.fte))
  const binCounts = counter(tys, (t) => binOf(t.experience))
  const binFte = sumBy(tys, (t) => binOf(t.experience), (t) => t.fte)
  const lanes = counter(tys, (t) => t.lane)
  const isHome = (code) => (group.districtCode === STATE.districtCode
    ? code != null
    : group.districtCode === TOWNS.districtCode
      ? code != null && isTownDistrict(entityType(code, ""))
      : code === group.districtCode)
  const newToDistrict = foy === firstFoy ? null : tys.filter((t) => !isHome(t.prevDistrict)).length
  const newToPanel = foy === firstFoy ? null : tys.filter((t) => t.prevDistrict == null).length
  const leftDistrict = foy === lastFoy ? null : tys.filter((t) => !isHome(t.nextDistrict)).length
  const leftPanel = foy === lastFoy ? null : tys.filter((t) => t.nextDistrict == null).length
  const row = {
    foy,
    schoolYear: `${foy}-${String(foy + 1).slice(2)}`,
    districtCode: group.districtCode,
    district: group.district,
    entityType: group.entityType,
    teachers: n,
    fte: round(fte, 2),
    fteCapped: tys.filter((t) => t.fteCapped).length,
    specialEd: tys.filter((t) => t.sspType === "SE").length,
    medianExp: quantile(exps, 0.5),
    p25Exp: quantile(exps, 0.25),
    p75Exp: quantile(exps, 0.75),
    meanExpCapped: round(sum(capped) / n, 2),
    meanExpCensored: round(sum(exps) / n, 2), // understates the senior end; see header
    // Exact only while below the year's censoring point of 13 + (foy − 2014).
    medianExact: quantile(exps, 0.5) < CENSOR + (foy - PANEL_START),
    newToDistrict,
    newToPanel,
    leftDistrict,
    leftPanel,
    retentionRate: leftDistrict == null ? null : round((n - leftDistrict) / n),
    medianChange: null,
    w1FromPrior: null,
    hist: histogram(capped, CENSOR),
  }
  BINS.forEach((b) => {
    row[`exp${b.key}`] = binCounts.get(b.key) ?? 0
    row[`share${b.key}`] = round((binCounts.get(b.key) ?? 0) / n)
    row[`fteShare${b.key}`] = round((binFte.get(b.key) ?? 0) / fte)
  })
  Object.entries(LANE_KEYS).forEach(([lane, key]) => {
    row[key] = lanes.get(lane) ?? 0
    row[`${key}Share`] = round((lanes.get(lane) ?? 0) / n)
  })
  return row
}

const buildDistrictYears = (teacherYears) => {
  const foys = sorted(new Set(teacherYears.map((t) => t.foy)))
  // reduce, not Math.max(...spread): half a million arguments overflows the stack
  const maxExp = teacherYears.reduce((m, t) => Math.max(m, t.experience), 0)
  const ctx = { firstFoy: foys[0], lastFoy: foys[foys.length - 1] }

  const groups = new Map([[STATE.districtCode, STATE], [TOWNS.districtCode, TOWNS]])
  teacherYears.forEach((t) => {
    if (!groups.has(t.districtCode)) groups.set(t.districtCode, { districtCode: t.districtCode, district: t.district, entityType: t.entityType })
  })
  // Districts rename occasionally; keep the latest name.
  teacherYears.forEach((t) => { groups.get(t.districtCode).district = t.district })

  const members = new Map()
  const push = (code, t) => (members.get(code) ?? members.set(code, []).get(code)).push(t)
  for (const t of teacherYears) {
    const k = `${t.foy}`
    push(`${t.districtCode}|${k}`, t)
    push(`${STATE.districtCode}|${k}`, t)
    if (isTownDistrict(t.entityType)) push(`${TOWNS.districtCode}|${k}`, t)
  }

  const rows = [...groups.values()].flatMap((g) => {
    const series = foys
      .map((foy) => members.get(`${g.districtCode}|${foy}`))
      .map((tys, i) => (tys ? aggregate(g, tys, foys[i], ctx) : null))
    series.forEach((row, i) => {
      const prior = i > 0 ? series[i - 1] : null
      if (row && prior) {
        row.medianChange = round(row.medianExp - prior.medianExp, 2)
        row.w1FromPrior = round(w1(prior.hist, row.hist))
      }
    })
    return series.filter(Boolean)
  })

  const rank = (g) => (g.districtCode === STATE.districtCode ? 0 : g.districtCode === TOWNS.districtCode ? 1 : 2)
  rows.sort((a, b) => rank(a) - rank(b) || a.district.localeCompare(b.district) || a.foy - b.foy)
  return { districtYears: rows, foys, maxExp: ctx.maxExp }
}

// ------------------------------------------------------------------ output

const TY_FIELDS = [
  "teacherId", "foy", "districtCode", "district", "entityType", "schoolCode", "school",
  "sspType", "roleCode", "role", "degree", "lane", "pre", "experience", "expCapped", "fte", "fteRaw",
  "fteCapped", "assignments", "districts", "mixedSsp", "firstSeen", "lastSeen",
  "gapYearsSoFar", "prevDistrict", "nextDistrict",
]
const DY_FIELDS = [
  "foy", "schoolYear", "districtCode", "district", "entityType", "teachers", "fte", "fteCapped",
  "specialEd", "medianExp", "medianExact", "p25Exp", "p75Exp", "meanExpCapped", "meanExpCensored",
  ...BINS.map((b) => `exp${b.key}`), ...BINS.map((b) => `share${b.key}`), ...BINS.map((b) => `fteShare${b.key}`),
  ...Object.values(LANE_KEYS), ...Object.values(LANE_KEYS).map((k) => `${k}Share`),
  "newToDistrict", "newToPanel", "leftDistrict", "leftPanel", "retentionRate", "medianChange", "w1FromPrior",
]

const writeXlsx = async (districtYears, foys, file) => {
  const wb = new ExcelJS.Workbook()
  wb.creator = "andoverct.info"
  wb.created = new Date()

  const wideSheets = [
    ["Teachers", (r) => r.teachers],
    ["FTE", (r) => r.fte],
    ["Median experience", (r) => r.medianExp],
    ["Share 0-3 years", (r) => r.share0to3],
    ["Share 13 or more", (r) => r.share13plus],
    ["Retention rate", (r) => r.retentionRate],
    ["Shift from prior year", (r) => r.w1FromPrior],
  ]
  const districts = [...new Map(districtYears.map((r) => [r.districtCode, r])).values()]
  wideSheets.forEach(([name, pick]) => {
    const sheet = wb.addWorksheet(name)
    sheet.columns = [
      { header: "District", key: "district", width: 44 },
      { header: "Code", key: "code", width: 10 },
      { header: "Type", key: "type", width: 16 },
      ...foys.map((y) => ({ header: `${y}-${String(y + 1).slice(2)}`, key: `${y}`, width: 10 })),
    ]
    districts.forEach((d) => {
      const row = { district: d.district, code: d.districtCode, type: d.entityType }
      districtYears
        .filter((r) => r.districtCode === d.districtCode)
        .forEach((r) => { row[`${r.foy}`] = pick(r) })
      sheet.addRow(row)
    })
    sheet.getRow(1).font = { bold: true }
    sheet.getRow(2).font = { bold: true }
    sheet.getRow(3).font = { bold: true }
    sheet.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }]
  })

  const all = wb.addWorksheet("District-years")
  all.columns = DY_FIELDS.map((f) => ({ header: f, key: f, width: f === "district" ? 44 : 14 }))
  all.getRow(1).font = { bold: true }
  all.views = [{ state: "frozen", ySplit: 1 }]
  districtYears.forEach((r) => all.addRow(r))

  await wb.xlsx.writeFile(file)
}

// ------------------------------------------------------------------ sanity

const table = (header, rows) => {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)))
  const line = (cells) => `| ${cells.map((c, i) => String(c).padEnd(widths[i])).join(" | ")} |`
  return [line(header), `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`, ...rows.map(line)].join("\n")
}

const sanityReport = ({ file, header, records, teacherYears, checks, districtYears, foys, maxExp }) => {
  const byFoyRows = counter(records, (r) => r.foy)
  const tyByFoy = counter(teacherYears, (t) => t.foy)
  const rowsPerTy = counter(teacherYears, (t) => t.assignments)
  const rawFte = counter(teacherYears, (t) => t.fteRaw)
  const multiDistrict = counter(teacherYears.filter((t) => t.districts > 1), (t) => t.districts)
  const preDist = counter(teacherYears, (t) => t.pre)
  const degrees = counter(records, (r) => r.degree)
  const ssp = counter(records, (r) => r.sspType)
  const roles = counter(records, (r) => `${r.roleCode}|${r.role}`)
  const nonTeaching = [...roles.keys()].filter((k) => !k.startsWith("90"))
  const byTeacher = new Map()
  teacherYears.forEach((t) => (byTeacher.get(t.teacherId) ?? byTeacher.set(t.teacherId, []).get(t.teacherId)).push(t))
  const gaps = counter([...byTeacher.values()], (tys) => tys[tys.length - 1].gapYearsSoFar)
  const spans = counter([...byTeacher.values()], (tys) => tys[0].lastSeen - tys[0].firstSeen + 1)
  const firstSeen = counter([...byTeacher.values()], (tys) => tys[0].firstSeen)
  const lastSeen = counter([...byTeacher.values()], (tys) => tys[0].lastSeen)
  const returners = [...byTeacher.values()].filter((tys) => tys[0].firstSeen > PANEL_START && tys[0].pre > 0).length
  const entity = counter([...new Map(teacherYears.map((t) => [t.districtCode, t])).values()], (t) => t.entityType)
  const others = [...new Map(teacherYears.filter((t) => t.entityType === "other").map((t) => [t.districtCode, t])).values()]
  const state = districtYears.filter((r) => r.districtCode === STATE.districtCode)
  const andover = districtYears.filter((r) => r.districtCode === ANDOVER)
  const sortedNum = (m) => [...m.entries()].sort((a, b) => a[0] - b[0])

  return `# Sanity report for the CSDE teacher panel

Generated ${new Date().toISOString().slice(0, 10)} by \`npm run build:teachers\` from
\`${file.split(/[\\/]/).pop()}\`. Every number here is recomputed on each run; the
methodology section of the report cites this file, not a hand-typed copy.

Experience rule in force: Years_2002to2014 + panel years ${PRE_PANEL_INCLUDES_2014 ? "after" : "from"} ${PANEL_START}
(\`PRE_PANEL_INCLUDES_2014 = ${PRE_PANEL_INCLUDES_2014}\`, pending CSDE confirmation).


## Raw file

- Columns: ${header.join(", ")}
- Data rows: ${fmt(records.length)}
- Unique TEACHER_ID: ${fmt(checks.teachers)}
- Teacher-years after collapsing: ${fmt(teacherYears.length)}
- Districts: ${fmt(new Set(teacherYears.map((t) => t.districtCode)).size)}
- Role codes: ${fmt(roles.size)}; codes outside 90xxx: ${nonTeaching.length ? nonTeaching.join(", ") : "none"}
- Max reconstructed experience: ${maxExp} (left-censored: Years_2002to2014 caps at ${CENSOR}, so bins and the shift measure use experience capped at ${CENSOR})

### Rows and teachers per Fall of Year

${table(["FOY", "Rows", "Teachers", "FTE (capped)", "New to panel", "Left panel after"],
  foys.map((y) => {
    const s = state.find((r) => r.foy === y)
    return [y, fmt(byFoyRows.get(y)), fmt(tyByFoy.get(y)), fmt(s.fte), fmt(s.newToPanel), fmt(s.leftPanel)]
  }))}

### X_SSPTypeCode (rows)

${table(["Code", "Rows"], [...ssp.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, fmt(v)]))}

### HighestDegree (rows)

${table(["Degree", "Lane", "Rows"], DEGREE_RANK.map((d) => [d, LANES[d], fmt(degrees.get(d) ?? 0)]))}

Degree changes within a teacher across years: **${fmt(checks.degreeVariesAcrossYears)}**
(zero means the field is a per-teacher snapshot, not a per-year value).
Teacher-years whose rows disagree on degree: ${fmt(teacherYears.filter((t) => t.mixedDegree).length)}.

### Years_2002to2014

Teachers whose value varies across rows: ${fmt(checks.preVaries)}.
Teachers first seen after ${PANEL_START} with a non-zero value (returners): ${fmt(returners)}.

${table(["Value", "Teacher-years"], sortedNum(preDist).map(([k, v]) => [k, fmt(v)]))}


## Collapsing

### Assignment rows per teacher-year

${table(["Rows", "Teacher-years"], sortedNum(rowsPerTy).map(([k, v]) => [k, fmt(v)]))}

### Summed FTE per teacher-year (before the 1.0 cap), most common

${table(["Summed FTE", "Teacher-years"], [...rawFte.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, fmt(v)]))}

Teacher-years above 1.0 (capped): ${fmt(teacherYears.filter((t) => t.fteCapped).length)},
of which in more than one district: ${fmt(teacherYears.filter((t) => t.fteCapped && t.districts > 1).length)}.

### Teacher-years in more than one district

${table(["Districts", "Teacher-years"], sortedNum(multiDistrict).map(([k, v]) => [k, fmt(v)]))}

Teacher-years with both GET and SE rows in the home district: ${fmt(teacherYears.filter((t) => t.mixedSsp).length)}.


## Panel structure

### Gap years per teacher (missing years between first and last appearance)

${table(["Gap years", "Teachers"], sortedNum(gaps).map(([k, v]) => [k, fmt(v)]))}

### Span (first to last appearance, years)

${table(["Span", "Teachers"], sortedNum(spans).map(([k, v]) => [k, fmt(v)]))}

### First and last appearance

${table(["FOY", "First seen", "Last seen"], foys.map((y) => [y, fmt(firstSeen.get(y) ?? 0), fmt(lastSeen.get(y) ?? 0)]))}


## Districts by entity type

${table(["Type", "Districts"], [...entity.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, fmt(v)]))}

Unclassified ("other"): ${others.length ? others.map((t) => `${t.district} (${t.districtCode})`).join("; ") : "none"}.


## Statewide composition

Shift is the earth-mover distance between consecutive years' distributions of
experience capped at ${CENSOR}, in years. Mean is of capped experience.

${table(["FOY", "Teachers", "Median", "Mean (cap 13)", "0–3", "4–7", "8–12", "13+", "Retention", "Shift (yrs)"],
  state.map((r) => [r.foy, fmt(r.teachers), r.medianExp, r.meanExpCapped, pct(r.share0to3), pct(r.share4to7), pct(r.share8to12), pct(r.share13plus), pct(r.retentionRate), r.w1FromPrior ?? ""]))}


## Andover (${ANDOVER})

${table(["FOY", "Teachers", "FTE", "Median", "0–3", "4–7", "8–12", "13+", "New", "Left after", "Shift (yrs)"],
  andover.map((r) => [r.foy, r.teachers, r.fte, r.medianExp, r.exp0to3, r.exp4to7, r.exp8to12, r.exp13plus, r.newToDistrict ?? "", r.leftDistrict ?? "", r.w1FromPrior ?? ""]))}
`
}

// -------------------------------------------------------------------- main

const main = async () => {
  const t0 = Date.now()
  const { records, file, header, teacherYears, checks } = loadTeacherYears()
  const { districtYears, foys, maxExp } = buildDistrictYears(teacherYears)

  writeFileSync(join(DIR, "teacher-years.csv"), toCsv([TY_FIELDS, ...teacherYears.map((t) => TY_FIELDS.map((f) => t[f] ?? ""))]))
  writeFileSync(join(DIR, "district-years.csv"), toCsv([DY_FIELDS, ...districtYears.map((r) => DY_FIELDS.map((f) => r[f] ?? ""))]))
  writeRecordsJson(
    join(DIR, "district-years.json"),
    {
      source: file.split(/[\\/]/).pop(),
      generated: new Date().toISOString(),
      experienceRule: `Years_2002to2014 + panel years ${PRE_PANEL_INCLUDES_2014 ? "after" : "from"} ${PANEL_START}; gap years earn nothing`,
      bins: BINS.map(({ key, label, min, max }) => ({ key, label, min, max: Number.isFinite(max) ? max : null })),
      lanes: LANES,
      censoredAt: CENSOR,
      maxReconstructedExperience: maxExp,
      histogramDomain: [0, CENSOR],
      fields: DY_FIELDS,
    },
    districtYears
  )
  await writeXlsx(districtYears, foys, join(DIR, "district-years.xlsx"))
  writeFileSync(join(DIR, "sanity.md"), sanityReport({ file, header, records, teacherYears, checks, districtYears, foys, maxExp }))

  console.log(`${fmt(records.length)} rows → ${fmt(teacherYears.length)} teacher-years → ${fmt(districtYears.length)} district-years in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(`wrote teacher-years.csv, district-years.{csv,json,xlsx}, sanity.md in ${DIR}`)
}

// Run only when invoked directly, so other scripts can import loadTeacherYears.
const norm = (p) => (p ?? "").replace(/\\/g, "/").toLowerCase()
if (norm(import.meta.filename) === norm(process.argv[1])) await main()
