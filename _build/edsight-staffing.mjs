#!/usr/bin/env node
/*
 * Fetches CT EdSight's "FTE Staffing" report, every district and the statewide
 * row, every year, from the SAS stored process behind:
 *
 *   https://public-edsight.ct.gov/educators/fte-staffing
 *
 *   npm run fetch:edsight-staffing                 # all years → data/edsight/fte-staffing/
 *   npm run fetch:edsight-staffing -- --year 2024-25
 *   npm run fetch:edsight-staffing -- --offline    # re-derive outputs from cached raw CSVs
 *
 * Mechanics are shared with the other EdSight fetchers (_build/edsight-client.mjs).
 * `FTEStaffingExport` takes `_year`, `_district`, `_school`, `_filterby` and
 * `_subgroup`; with `_district=All Districts`, `_filterby=All` and
 * `_subgroup=All Categories` one request returns every district's FTE in each of
 * the thirteen assignment categories (~2,300 rows). The statewide total is a
 * second request with `_district=State of Connecticut`, as in the other reports.
 * `_year=Trend` works but carries only the latest five years, so this fetches
 * year by year. The dropdown offers 2001-02 through the current year.
 *
 * Why this exists: it is the independent check on the CSDE teacher-level panel
 * in data/csde/teachers/. That pull is general-education (GET) and
 * special-education (SE) classroom teachers; EdSight's categories
 * "General Education - Teachers and Instructors" and "Special Education -
 * Teachers and Instructors" are the published equivalents. `npm run
 * build:teachers` reads this fetcher's output, when present, and compares the
 * two district by district and year by year in sanity.md.
 *
 * Upstream quirks, all verified against the live endpoint:
 *   - The export has no district code column, only names. Joins are by name.
 *   - Commas inside category names are replaced by two spaces upstream
 *     ("Administrators  Coordinators and Department Chairs"). Names are kept
 *     as delivered in raw/ and collapsed to single spaces in the tidy output.
 *   - The first two lines are a title and a blank; the header row starts with
 *     "District".
 *
 * Outputs, all from the same fetch so they cannot drift:
 *   data/edsight/fte-staffing/raw/fte-staffing-<year>-{districts,state}.csv — upstream bytes
 *   data/edsight/fte-staffing/fte-staffing.csv    — one row per district × year × category
 *   data/edsight/fte-staffing/fte-staffing.json   — same rows + provenance
 *   data/edsight/fte-staffing/fte-staffing.xlsx   — teachers by district and year, plus the long table
 *
 * Row shape: year, level (state | district), district, category, educatorType,
 * fte. `category` is the EdSight assignment category verbatim (single-spaced).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import ExcelJS from "exceljs"
import {
  Jar, get, spUrl, fetchYears, parseCsv, toCsv, headerIndex, parseNumber,
  writeRecordsJson, NO_RESULTS, STATE, SP, PROGRAM_BASE,
} from "./edsight-client.mjs"

const ROOT = join(import.meta.dirname, "..")
const OUT_DIR = join(ROOT, "data/edsight/fte-staffing")
const RAW_DIR = join(OUT_DIR, "raw")

const EXPORT_PROGRAM = "FTEStaffingExport"
const REPORT_PROGRAM = "FTEStaffingReport_SiteCore"

const REPORT_PARAMS = {
  _rpttype: "listing",
  _year: "Trend",
  _district: STATE,
  _school: "",
  _filterby: "All",
  _subgroup: "",
  _select: "Submit",
}

const SCOPES = [
  { key: "districts", district: "All Districts", level: "district" },
  { key: "state", district: STATE, level: "state" },
]

export const TEACHER_CATEGORIES = [
  "General Education - Teachers and Instructors",
  "Special Education - Teachers and Instructors",
]

const exportUrl = (year, district) =>
  spUrl(EXPORT_PROGRAM, {
    _year: year,
    _district: district,
    _school: " ",
    _filterby: "All",
    _subgroup: "All Categories",
  })

const tidy = (csvText, year, level) => {
  if (NO_RESULTS.test(csvText)) return []
  const rows = parseCsv(csvText)
  const { headerRow: hi, col } = headerIndex(rows, "District")
  const idx = {
    district: col("District"),
    category: col("Assignment Category"),
    educatorType: col("Educator Type"),
    fte: col("FTE Count"),
  }
  Object.entries(idx).forEach(([k, v]) => {
    if (v < 0) throw new Error(`${year}: export is missing the ${k} column`)
  })
  return rows
    .slice(hi + 1)
    .filter((r) => r[idx.district]?.trim())
    .map((r) => ({
      year,
      level,
      district: r[idx.district].trim(),
      category: r[idx.category].trim().replace(/\s{2,}/g, " "),
      educatorType: r[idx.educatorType].trim(),
      fte: parseNumber(r[idx.fte]).value,
    }))
}

const writeXlsx = async (records, years, file) => {
  const wb = new ExcelJS.Workbook()
  wb.creator = "andoverct.info"
  wb.created = new Date()

  // Teachers (general + special education) by district and year: the sheet a
  // person wants, and the one the CSDE panel is checked against.
  const sheet = wb.addWorksheet("Teachers")
  sheet.columns = [
    { header: "District", key: "district", width: 44 },
    ...years.map((y) => ({ header: y, key: y, width: 10 })),
  ]
  const teachers = new Map()
  records
    .filter((r) => TEACHER_CATEGORIES.includes(r.category))
    .forEach((r) => {
      const row = teachers.get(r.district) ?? teachers.set(r.district, { district: r.district }).get(r.district)
      row[r.year] = (row[r.year] ?? 0) + (r.fte ?? 0)
    })
  const ordered = [...teachers.values()].sort(
    (a, b) => (a.district === STATE ? -1 : 0) - (b.district === STATE ? -1 : 0) || a.district.localeCompare(b.district)
  )
  ordered.forEach((row) => sheet.addRow(row))
  sheet.getRow(1).font = { bold: true }
  if (ordered[0]?.district === STATE) sheet.getRow(2).font = { bold: true }
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }]

  const all = wb.addWorksheet("All categories")
  all.columns = FIELDS.map((f) => ({ header: f, key: f, width: f === "district" || f === "category" ? 44 : 14 }))
  all.getRow(1).font = { bold: true }
  all.views = [{ state: "frozen", ySplit: 1 }]
  records.forEach((r) => all.addRow(r))

  await wb.xlsx.writeFile(file)
}

const FIELDS = ["year", "level", "district", "category", "educatorType", "fte"]

// ------------------------------------------------------------------- main

const args = process.argv.slice(2)
const offline = args.includes("--offline")
const yearArg = args[args.indexOf("--year") + 1]
const onlyYear = args.includes("--year") ? yearArg : null

mkdirSync(RAW_DIR, { recursive: true })
const rawFor = (year, scope) => join(RAW_DIR, `fte-staffing-${year}-${scope}.csv`)
const cachedYears = () =>
  [...new Set(readdirSync(RAW_DIR).map((f) => f.match(/^fte-staffing-(\d{4}-\d{2})-\w+\.csv$/)?.[1]).filter(Boolean))].sort()

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
    existsSync(rawFor(year, scope.key)) ? tidy(readFileSync(rawFor(year, scope.key), "utf8"), year, scope.level) : []
  )
)
records.sort(
  (a, b) =>
    (a.level === "state" ? 0 : 1) - (b.level === "state" ? 0 : 1) ||
    a.district.localeCompare(b.district) ||
    a.year.localeCompare(b.year) ||
    a.category.localeCompare(b.category)
)

const districts = new Set(records.filter((r) => r.level === "district").map((r) => r.district))
const categories = [...new Set(records.map((r) => r.category))].sort()

writeFileSync(join(OUT_DIR, "fte-staffing.csv"), toCsv([FIELDS, ...records.map((r) => FIELDS.map((f) => r[f] ?? ""))]))
writeRecordsJson(
  join(OUT_DIR, "fte-staffing.json"),
  {
    source: "CT EdSight, FTE Staffing",
    page: "https://public-edsight.ct.gov/educators/fte-staffing",
    endpoint: `${SP}?_program=${PROGRAM_BASE}/${EXPORT_PROGRAM}`,
    fetchedAt: offline ? newestRawAt() : fetchedAt,
    years: allYears,
    districtCount: districts.size,
    rowCount: records.length,
    categories,
    teacherCategories: TEACHER_CATEGORIES,
    notes: [
      "One row per district (or the statewide row, level = state) per year per assignment category; fte is the published FTE count.",
      "The export carries district names only, no codes. Join to other datasets by name.",
      "Category names arrive with commas replaced by double spaces; they are single-spaced here and left as delivered in raw/.",
      "teacherCategories lists the two categories that correspond to the CSDE classroom-teacher panel in data/csde/teachers/.",
    ],
  },
  records
)
await writeXlsx(records, allYears, join(OUT_DIR, "fte-staffing.xlsx"))

console.log(
  `\n${records.length.toLocaleString()} rows · ${districts.size} districts · ${allYears.length} years · ${categories.length} categories` +
    `\nwrote ${OUT_DIR.replace(ROOT, ".")}/fte-staffing.{csv,json,xlsx}`
)
