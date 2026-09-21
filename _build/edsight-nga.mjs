#!/usr/bin/env node
/*
 * Fetches CT EdSight's "Next Generation Accountability" results — every district
 * AND every school, every year — from the SAS stored process behind:
 *
 *   https://public-edsight.ct.gov/overview/next-generation-accountability-dashboard/next-generation-accountability-results
 *
 *   npm run fetch:edsight-nga                    # all years → data/edsight/accountability/
 *   npm run fetch:edsight-nga -- --year 2024-25
 *   npm run fetch:edsight-nga -- --offline       # re-derive outputs from cached raw CSVs
 *
 * Mechanics are shared with the other EdSight fetchers — see _build/edsight-client.mjs.
 * This report is the cheapest of the three: `NGAExport_All` takes only `_year` and
 * returns districts, schools and the statewide row together (~1,200 rows, 120
 * columns), so the whole state for a year is ONE request. There is no
 * "All Districts" option in its dropdown because this export already is that.
 *
 * Years are 2014-15 through 2024-25 with 2019-20 and 2020-21 absent — accountability
 * was suspended for COVID. The 120 columns are identical in every year, verified.
 *
 * Three things this script normalizes, because upstream is inconsistent:
 *
 *   - **Rate scales are mixed.** Indicator 1 rates are Performance Indices on 0-100,
 *     but every other rate (Ind2-Ind12, graduation) is a FRACTION 0-1 — so growth
 *     arrives as 0.686 where the web page shows "68.6%". Mixing both scales in one
 *     table is a footgun, so all rates are emitted on 0-100, matching what EdSight
 *     displays. The untouched originals stay in raw/.
 *   - **`.` means missing**, becoming null.
 *   - `Category` becomes a plain `level` of state / district / school.
 *
 * It also derives an **academic-only index**, which the full Accountability Index is
 * not. Of Andover's 800 possible points, 150 are chronic absenteeism and physical
 * fitness; K-12 districts additionally carry arts access, college/career readiness
 * and postsecondary entrance. `academicPct` re-scores using only indicators 1
 * (performance index) and 2 (academic growth / EL progress). Note it is still not
 * comparable across grade spans — see the caveat below.
 *
 * CAVEAT for any cross-district comparison: `possiblePoints` varies (250 to 1,150
 * among town districts) because inapplicable indicators are dropped, so
 * `outcomeRatePct` is not a common scale between districts with different grade
 * spans. Districts that do not test older grades also score structurally higher:
 * statewide ELA performance falls from ~68 in grades 3-6 to ~61 in grades 7-11.
 *
 * Outputs, all from the same fetch so they cannot drift:
 *   data/edsight/accountability/raw/accountability-<year>.csv  — upstream bytes, untouched
 *   data/edsight/accountability/accountability.csv             — one row per entity per year
 *   data/edsight/accountability/accountability.json            — same rows + provenance
 *   data/edsight/accountability/accountability.xlsx            — districts, schools, and
 *       an Andover sheet
 *
 * Row shape: identity columns (year, level, district, districtCode, entityType,
 * school, schoolCode, orgType, lowGrade, highGrade, titleI), the index
 * (totalPoints, possiblePoints, outcomeRatePct, finalCategory, achievementGapFlag),
 * the derived academic-only trio (academicPoints, academicPossible, academicPct),
 * then all 105 upstream Ind* columns under their own names.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import ExcelJS from "exceljs"
import {
  Jar, get, spUrl, fetchYears, parseCsv, toCsv, headerIndex, cleanCode, parseNumber,
  writeRecordsJson, NO_RESULTS, STATE, SP, PROGRAM_BASE, entityType,
} from "./edsight-client.mjs"

const ROOT = join(import.meta.dirname, "..")
const OUT_DIR = join(ROOT, "data/edsight/accountability")
const RAW_DIR = join(OUT_DIR, "raw")

const EXPORT_PROGRAM = "NGAExport_All"
const REPORT_PROGRAM = "NGAReport_SiteCore"
const REPORT_PARAMS = { _year: "2024-25", _district: STATE, _school: "", _select: "Submit" }

const LEVELS = { StateTot: "state", DistrictTot: "district", SchoolTot: "school" }

// Indicators 1 (performance index) and 2 (academic growth / progress toward English
// proficiency) are the academic ones. 4 is chronic absenteeism, 5-10 are college and
// career readiness / graduation / postsecondary, 11 is physical fitness, 12 arts
// access. Indicator 3 is test participation and scores no points.
const ACADEMIC_INDICATORS = new Set([1, 2])

// Only Indicator 1's rates are already on 0-100 (they are Performance Indices);
// every other rate is a 0-1 fraction upstream. OutcomeRatePct is a percent already.
const isFractionRate = (col) =>
  /Rate$/i.test(col) && !/^Ind1(ELA|Math|Sci)_/.test(col) && col !== "OutcomeRatePct"

const indicatorOf = (col) => {
  const m = col.match(/^Ind(\d+)/)
  return m ? Number(m[1]) : null
}

// ---------------------------------------------------------------- reshape

const IDENTITY = [
  "year", "level", "district", "districtCode", "entityType",
  "school", "schoolCode", "orgType", "lowGrade", "highGrade", "titleI",
]
const INDEX_COLS = [
  "totalPoints", "possiblePoints", "outcomeRatePct", "finalCategory", "achievementGapFlag",
]
const DERIVED = ["academicPoints", "academicPossible", "academicPct"]

let indColumns = null; // upstream Ind* names, in upstream order, fixed on first parse

const tidy = (csvText, year) => {
  if (NO_RESULTS.test(csvText)) return []
  const rows = parseCsv(csvText)
  const { headerRow: hi, header } = headerIndex(rows, "FallOfYear")
  const at = (name) => header.indexOf(name)

  const indCols = header.filter((h) => indicatorOf(h) !== null)
  if (!indColumns) indColumns = indCols

  const out = []
  for (const r of rows.slice(hi + 1)) {
    if (!r || r.length < 13) continue
    const level = LEVELS[r[at("Category")]?.trim()]
    if (!level) continue

    const district = r[at("RptngDistrictName")]?.trim() ?? ""
    const districtCode = cleanCode(r[at("ReportingDistrictCode")])
    const school = r[at("SchoolName")]?.trim() ?? ""

    const rec = {
      year,
      level,
      district,
      districtCode,
      entityType: entityType(districtCode, district),
      // District rows carry the literal "District" as their school name; drop it so
      // the column means only what it says.
      school: level === "school" ? school : "",
      schoolCode: level === "school" ? cleanCode(r[at("SchoolCode")]) : "",
      orgType: r[at("SchoolOrgType")]?.trim() ?? "",
      lowGrade: r[at("SchoolLowGrade")]?.trim() ?? "",
      highGrade: r[at("SchoolHighGrade")]?.trim() ?? "",
      titleI: r[at("SchoolTitleIType")]?.trim() ?? "",
      totalPoints: parseNumber(r[at("TotalPoints")]).value,
      possiblePoints: parseNumber(r[at("TotalPossiblePoints")]).value,
      outcomeRatePct: parseNumber(r[at("OutcomeRatePct")]).value,
      finalCategory: parseNumber(r[at("FinalCategory")]).value,
      achievementGapFlag: r[at("AchievementGapFlag")]?.trim().replace(/^\.$/, "") ?? "",
    }
    for (const k of ["lowGrade", "highGrade", "titleI", "orgType"]) {
      if (rec[k] === "." || rec[k] === "District") rec[k] = ""
    }

    let aPts = 0
    let aPoss = 0
    for (const col of indCols) {
      const { value } = parseNumber(r[at(col)])
      rec[col] = value == null ? null : isFractionRate(col) ? value * 100 : value
      if (value == null) continue
      if (!ACADEMIC_INDICATORS.has(indicatorOf(col))) continue
      if (/PossiblePoints$/i.test(col)) aPoss += value
      else if (/Points$/i.test(col)) aPts += value
    }
    rec.academicPoints = aPoss ? Number(aPts.toFixed(6)) : null
    rec.academicPossible = aPoss || null
    rec.academicPct = aPoss ? Number(((100 * aPts) / aPoss).toFixed(6)) : null

    out.push(rec)
  }
  return out
}

// ---------------------------------------------------------------- outputs

const writeXlsx = async (records, years, file) => {
  const wb = new ExcelJS.Workbook()
  wb.creator = "andoverct.info"
  wb.created = new Date()
  const pct = "0.0"

  // Districts: the index and the academic-only index, years across.
  const mk = (name, rows, keyName) => {
    const sheet = wb.addWorksheet(name)
    sheet.columns = [
      { header: keyName, key: "k", width: 46 },
      { header: "Type", key: "type", width: 15 },
      { header: "Grades", key: "grades", width: 9 },
      ...years.flatMap((y) => [
        { header: `${y} index %`, key: `i${y}`, width: 12, style: { numFmt: pct } },
        { header: `${y} academic %`, key: `a${y}`, width: 13, style: { numFmt: pct } },
      ]),
    ]
    const by = new Map()
    for (const r of rows) {
      const k = keyName === "School" ? `${r.school} — ${r.district}` : r.district
      if (!by.has(k)) {
        by.set(k, {
          k,
          type: r.entityType,
          grades: r.lowGrade && r.highGrade ? `${r.lowGrade}-${r.highGrade}` : "",
        })
      }
      by.get(k)[`i${r.year}`] = r.outcomeRatePct
      by.get(k)[`a${r.year}`] = r.academicPct
    }
    const ordered = [...by.values()].sort(
      (a, b) => (a.k === STATE ? -1 : 0) - (b.k === STATE ? -1 : 0) || a.k.localeCompare(b.k)
    )
    for (const row of ordered) sheet.addRow(row)
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }]
  }

  mk("Districts", records.filter((r) => r.level !== "school"), "District")
  mk("Schools", records.filter((r) => r.level === "school"), "School")

  // Everything Andover, every indicator — the detail sheet for a local reader.
  const sheet = wb.addWorksheet("Andover detail")
  const cols = [...IDENTITY, ...INDEX_COLS, ...DERIVED, ...(indColumns ?? [])]
  sheet.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(30, Math.max(11, c.length + 2)) }))
  for (const r of records.filter((r) => r.district.startsWith("Andover"))) sheet.addRow(r)
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: "frozen", ySplit: 1 }]

  await wb.xlsx.writeFile(file)
}

// ---------------------------------------------------------------- main

const argv = process.argv.slice(2)
const offline = argv.includes("--offline")
const yearArg = argv.includes("--year") ? argv[argv.indexOf("--year") + 1] : null

mkdirSync(RAW_DIR, { recursive: true })
const rawFor = (year) => join(RAW_DIR, `accountability-${year}.csv`)
const cachedYears = () =>
  readdirSync(RAW_DIR)
    .map((f) => f.match(/^accountability-(\d{4}-\d{2})\.csv$/)?.[1])
    .filter(Boolean)
    .sort()

const fetchedAt = new Date().toISOString()
const newestRawAt = () => {
  const times = readdirSync(RAW_DIR)
    .filter((f) => f.endsWith(".csv"))
    .map((f) => statSync(join(RAW_DIR, f)).mtimeMs)
  return times.length ? new Date(Math.max(...times)).toISOString() : fetchedAt
}

if (offline) {
  const years = cachedYears()
  if (!years.length) throw new Error(`--offline but no cached CSVs in ${RAW_DIR}`)
  console.log(`offline: re-deriving from ${years.length} cached year(s)`)
} else {
  const jar = new Jar()
  const years = yearArg ? [yearArg] : await fetchYears(REPORT_PROGRAM, REPORT_PARAMS, jar)
  console.log(`years: ${years.join(", ")}`)
  for (const year of years) {
    const text = await (await get(spUrl(EXPORT_PROGRAM, { _year: year }), jar)).text()
    writeFileSync(rawFor(year), text)
    console.log(`  ${year} … ${NO_RESULTS.test(text) ? "no results" : `${(text.length / 1024).toFixed(0)} KB`}`)
  }
}

const allYears = cachedYears()
const records = []
for (const year of allYears) {
  if (existsSync(rawFor(year))) records.push(...tidy(readFileSync(rawFor(year), "utf8"), year))
}

const LEVEL_RANK = { state: 0, district: 1, school: 2 }
records.sort(
  (a, b) =>
    LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
    a.district.localeCompare(b.district) ||
    a.school.localeCompare(b.school) ||
    a.year.localeCompare(b.year)
)

const FIELDS = [...IDENTITY, ...INDEX_COLS, ...DERIVED, ...(indColumns ?? [])]
const districts = new Set(records.filter((r) => r.level === "district").map((r) => r.district))
const schools = new Set(records.filter((r) => r.level === "school").map((r) => r.schoolCode))

writeFileSync(
  join(OUT_DIR, "accountability.csv"),
  toCsv([FIELDS, ...records.map((r) => FIELDS.map((f) => r[f]))])
)

writeRecordsJson(
  join(OUT_DIR, "accountability.json"),
  {
    source: "CT EdSight, Next Generation Accountability",
    page: "https://public-edsight.ct.gov/overview/next-generation-accountability-dashboard/next-generation-accountability-results",
    endpoint: `${SP}?_program=${PROGRAM_BASE}/${EXPORT_PROGRAM}`,
    fetchedAt: offline ? newestRawAt() : fetchedAt,
    years: allYears,
    districtCount: districts.size,
    schoolCount: schools.size,
    rowCount: records.length,
    notes: [
      "One row per entity per year, at three levels: state, district, school (see `level`).",
      "ALL rates are emitted on 0-100. Upstream is inconsistent: Indicator 1 rates are Performance Indices on 0-100 while every other rate is a 0-1 fraction, so growth arrives as 0.686 where the site shows 68.6%. The untouched originals are in raw/.",
      "outcomeRatePct is the Accountability Index as a percent of points earned; totalPoints/possiblePoints are its parts.",
      "possiblePoints VARIES BY DISTRICT (250-1,150 among towns) because inapplicable indicators are dropped, so outcomeRatePct is NOT a common scale across different grade spans.",
      "academicPct re-scores using only indicators 1 (performance index) and 2 (academic growth / EL progress), excluding chronic absenteeism, CCR, graduation, postsecondary, physical fitness and arts access. For Andover that is 650 of 800 points; the full index is ~81% academic there and less in K-12 districts.",
      "Districts that do not test older grades score structurally higher: statewide ELA performance falls from ~68 in grades 3-6 to ~61 in grades 7-11. Controlling for student need, K-6 districts run about +3.4 on performance index and +6.7 on growth versus K-12.",
      "Accountability was suspended for COVID: no 2019-20 or 2020-21.",
      "Indicator 3 is test participation and scores no points.",
    ],
  },
  records
)

await writeXlsx(records, allYears, join(OUT_DIR, "accountability.xlsx"))

console.log(
  `\n${records.length.toLocaleString()} rows · ${districts.size} districts · ${schools.size} schools · ${allYears.length} years` +
    `\nwrote ${OUT_DIR.replace(ROOT, ".")}/accountability.{csv,json,xlsx}`
)
