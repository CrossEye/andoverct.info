#!/usr/bin/env node
/*
 * Fetches CT EdSight's public-school enrollment (October 1 counts), every
 * district and the statewide total, every year, from the SAS stored process
 * behind the legacy enrollment report:
 *
 *   https://public-edsight.ct.gov/students/enrollment-dashboard/enrollment-report-legacy
 *
 *   npm run fetch:edsight-enrollment                 # all years → data/edsight/enrollment/
 *   npm run fetch:edsight-enrollment -- --year 2024-25
 *   npm run fetch:edsight-enrollment -- --offline    # re-derive outputs from cached raw CSVs
 *
 * Mechanics are shared with the other EdSight fetchers (_build/edsight-client.mjs).
 * `EnrollmentTrendExport` with `_district=All Districts` and
 * `_subgroup=All Students` returns one row per district with the district code
 * (as `="0010011"`, which cleanCode strips) and one count column per year.
 * `_year=Trend` carries only the latest six years, so this fetches year by
 * year; the dropdown offers 2007-08 through the current year. The statewide
 * total is a second request with `_district=State of Connecticut`, whose header
 * row starts with TOTAL rather than DISTRICT. Other subgroups (Grade, Gender,
 * …) return a stored-process error from the export and are not fetched.
 *
 * Why this exists: a denominator for the CSDE teacher panel in
 * data/csde/teachers/ (teachers per 100 students) and a size measure for the
 * cross-district work. `npm run build:teachers` reads this fetcher's output
 * when present.
 *
 * Outputs, all from the same fetch so they cannot drift:
 *   data/edsight/enrollment/raw/enrollment-<year>-{districts,state}.csv — upstream bytes
 *   data/edsight/enrollment/enrollment.csv    — one row per district × year
 *   data/edsight/enrollment/enrollment.json   — same rows + provenance
 *   data/edsight/enrollment/enrollment.xlsx   — districts down, years across
 *
 * Row shape: year, level (state | district), district, districtCode, entityType,
 * enrollment.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import ExcelJS from "exceljs"
import {
  Jar, get, spUrl, fetchYears, parseCsv, toCsv, headerIndex, cleanCode, parseNumber,
  writeRecordsJson, NO_RESULTS, STATE, SP, PROGRAM_BASE, entityType,
} from "./edsight-client.mjs"

const ROOT = join(import.meta.dirname, "..")
const OUT_DIR = join(ROOT, "data/edsight/enrollment")
const RAW_DIR = join(OUT_DIR, "raw")

const EXPORT_PROGRAM = "EnrollmentTrendExport"
const REPORT_PROGRAM = "EnrollmentReport_SiteCore"

const REPORT_PARAMS = {
  _year: "Trend",
  _district: STATE,
  _school: "",
  _subgroup: "All Students ",
  _select: "Submit",
}

const SCOPES = [
  { key: "districts", district: "All Districts", level: "district", firstColumn: "DISTRICT" },
  { key: "state", district: STATE, level: "state", firstColumn: "TOTAL" },
]

const exportUrl = (year, district) =>
  spUrl(EXPORT_PROGRAM, { _year: year, _district: district, _school: " ", _subgroup: "All Students" })

/*
 * Both scopes are wide (one column per year) even for a single-year fetch, so
 * the year columns are read by header name and each becomes a row. The trailing
 * "Total" row is dropped; the statewide export's own row is kept.
 */
const tidy = (csvText, scope) => {
  if (NO_RESULTS.test(csvText)) return []
  const rows = parseCsv(csvText)
  const { headerRow: hi, header, col } = headerIndex(rows, scope.firstColumn)
  const yearCols = header.map((h, i) => ({ year: h, i })).filter(({ year }) => /^\d{4}-\d{2}$/.test(year))
  if (!yearCols.length) throw new Error(`${scope.key}: no year columns in export header`)
  const codeCol = col("District Code")
  return rows
    .slice(hi + 1)
    .filter((r) => r[0]?.trim() && r[0].trim() !== "Total")
    .flatMap((r) => {
      const district = r[0].trim()
      const districtCode = codeCol >= 0 ? cleanCode(r[codeCol]) : ""
      return yearCols.map(({ year, i }) => ({
        year,
        level: scope.level,
        district,
        districtCode,
        entityType: entityType(districtCode, district),
        enrollment: parseNumber(r[i]).value,
      }))
    })
}

const FIELDS = ["year", "level", "district", "districtCode", "entityType", "enrollment"]

const writeXlsx = async (records, years, file) => {
  const wb = new ExcelJS.Workbook()
  wb.creator = "andoverct.info"
  wb.created = new Date()
  const sheet = wb.addWorksheet("Enrollment")
  sheet.columns = [
    { header: "District", key: "district", width: 44 },
    { header: "Code", key: "code", width: 10 },
    { header: "Type", key: "type", width: 16 },
    ...years.map((y) => ({ header: y, key: y, width: 10 })),
  ]
  const byDistrict = new Map()
  records.forEach((r) => {
    const row = byDistrict.get(r.district) ?? byDistrict.set(r.district, { district: r.district, code: r.districtCode, type: r.entityType }).get(r.district)
    row[r.year] = r.enrollment
  })
  const ordered = [...byDistrict.values()].sort(
    (a, b) => (a.district === STATE ? -1 : 0) - (b.district === STATE ? -1 : 0) || a.district.localeCompare(b.district)
  )
  ordered.forEach((row) => sheet.addRow(row))
  sheet.getRow(1).font = { bold: true }
  if (ordered[0]?.district === STATE) sheet.getRow(2).font = { bold: true }
  sheet.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }]
  await wb.xlsx.writeFile(file)
}

// ------------------------------------------------------------------- main

const args = process.argv.slice(2)
const offline = args.includes("--offline")
const onlyYear = args.includes("--year") ? args[args.indexOf("--year") + 1] : null

mkdirSync(RAW_DIR, { recursive: true })
const rawFor = (year, scope) => join(RAW_DIR, `enrollment-${year}-${scope}.csv`)
const cachedYears = () =>
  [...new Set(readdirSync(RAW_DIR).map((f) => f.match(/^enrollment-(\d{4}-\d{2})-\w+\.csv$/)?.[1]).filter(Boolean))].sort()

const fetchedAt = new Date().toISOString()
const newestRawAt = () => {
  const times = readdirSync(RAW_DIR).filter((f) => f.endsWith(".csv")).map((f) => statSync(join(RAW_DIR, f)).mtimeMs)
  return times.length ? new Date(Math.max(...times)).toISOString() : fetchedAt
}

if (offline) {
  if (!cachedYears().length) throw new Error(`--offline but no cached CSVs in ${RAW_DIR}`)
  console.log(`offline: re-deriving from ${cachedYears().length} cached year(s)`)
} else {
  const jar = new Jar()
  const years = onlyYear ? [onlyYear] : await fetchYears(REPORT_PROGRAM, REPORT_PARAMS, jar)
  console.log(`years: ${years.join(", ")}`)
  for (const year of years) {
    for (const scope of SCOPES) {
      const text = await (await get(exportUrl(year, scope.district), jar)).text()
      writeFileSync(rawFor(year, scope.key), text)
      console.log(`  ${year} ${scope.key.padEnd(9)} … ${NO_RESULTS.test(text) ? "no results" : `${(text.length / 1024).toFixed(0)} KB`}`)
    }
  }
}

const allYears = cachedYears()
const records = allYears.flatMap((year) =>
  SCOPES.flatMap((scope) =>
    existsSync(rawFor(year, scope.key)) ? tidy(readFileSync(rawFor(year, scope.key), "utf8"), scope) : []
  )
)
records.sort(
  (a, b) =>
    (a.level === "state" ? 0 : 1) - (b.level === "state" ? 0 : 1) ||
    a.district.localeCompare(b.district) ||
    a.year.localeCompare(b.year)
)

const districts = new Set(records.filter((r) => r.level === "district").map((r) => r.districtCode))

writeFileSync(join(OUT_DIR, "enrollment.csv"), toCsv([FIELDS, ...records.map((r) => FIELDS.map((f) => r[f] ?? ""))]))
writeRecordsJson(
  join(OUT_DIR, "enrollment.json"),
  {
    source: "CT EdSight, Public School Enrollment (October 1 counts)",
    page: "https://public-edsight.ct.gov/students/enrollment-dashboard/enrollment-report-legacy",
    endpoint: `${SP}?_program=${PROGRAM_BASE}/${EXPORT_PROGRAM}`,
    fetchedAt: offline ? newestRawAt() : fetchedAt,
    years: allYears,
    districtCount: districts.size,
    rowCount: records.length,
    notes: [
      "One row per district (or the statewide row, level = state) per year; enrollment is the October 1 student count, all students.",
      "District codes arrive as =\"0010011\" and are stripped to the 7-digit code; entityType is derived from the code's last four digits.",
    ],
  },
  records
)
await writeXlsx(records, allYears, join(OUT_DIR, "enrollment.xlsx"))

console.log(
  `\n${records.length.toLocaleString()} rows · ${districts.size} districts · ${allYears.length} years` +
    `\nwrote ${OUT_DIR.replace(ROOT, ".")}/enrollment.{csv,json,xlsx}`
)
