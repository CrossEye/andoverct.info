#!/usr/bin/env node
/*
 * Fetches the CT EdSight "Performance Index" report for every district, every
 * year, straight from the SAS stored process that backs the public page:
 *
 *   https://public-edsight.ct.gov/performance/performance-index?language=en_US
 *
 *   npm run fetch:edsight            # all years, writes data/edsight/performance-index/
 *   npm run fetch:edsight -- --year 2025-26
 *   npm run fetch:edsight -- --offline     # re-derive outputs from cached raw CSVs
 *
 * How it works (no browser / Playwright needed):
 *
 * The Sitecore page is only a shell. The data comes from a SAS 9.4 stored
 * process on edsight.ct.gov, and the report's own "Export .csv file" link
 * points at a sibling stored process that returns CSV directly:
 *
 *   /SASStoredProcess/do?_program=/CTDOE/.../StoredProcesses/PerformanceIndexExport
 *     &_year=2025-26&_district=All+Districts&_school=+&_subgroup=+&_subject=All+Subjects
 *
 * Two things make this cheap. `_district=All Districts` returns every district
 * in one response (~200 districts, ~4,600 rows), and the endpoint authenticates
 * as an anonymous guest — the first request 302s through a CAS login dance that
 * needs nothing but cookie persistence. So the whole state, all years, is ~10
 * requests.
 *
 * Caveats worth knowing, all verified against the live endpoint:
 *
 *   - `_subgroup` must be a single space. Passing `All Groups` (what the form's
 *     dropdown shows) makes the export return "did not contain any results".
 *   - `_year=Trend` works but omits the *Count* columns, so this script fetches
 *     year by year instead and keeps the denominators.
 *   - `All Districts` returns only districts with data in that year, which is
 *     correct rather than lossy: Litchfield and Regional 06 appear through
 *     2022-23 and stop, Regional 20 picks up after they consolidate. Fetching
 *     per year therefore captures districts that no longer exist.
 *     Fetching every year this way reaches all 205 districts the dropdown offers,
 *     including ones that report in only a single year (DMHAS appears in 2016-17
 *     alone). Any one year covers only ~199 of them.
 *   - The district-level export carries the 2-level meal category only; the
 *     3-level breakdown is not in it.
 *   - `*` means suppressed for privacy (small n), `N/A` means the subject is not
 *     assessed at that grade. Both become null, with `suppressed` recording why.
 *
 * Outputs, all from the same fetch so they cannot drift:
 *   data/edsight/performance-index/raw/performance-index-<year>-{districts,state}.csv — upstream bytes, untouched
 *   data/edsight/performance-index/performance-index.csv             — tidy long format
 *   data/edsight/performance-index/performance-index.json            — same rows + provenance
 *   data/edsight/performance-index/performance-index.xlsx            — one sheet per subject
 *
 * Not every entry is a town: the 205 "districts" also include charter districts,
 * the six RESCs, state-agency schools and the three endowed academies. `entityType`
 * labels each row so cross-town work can filter to local + regional (167 of them).
 *
 * Tidy row shape (one row per district × year × student group × subject):
 *   year, district, districtCode, entityType, category, studentGroup, subject,
 *   count, index, suppressed
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import ExcelJS from "exceljs"
import {
  Jar, get, spUrl, fetchYears, parseCsv, toCsv, headerIndex, cleanCode, parseNumber,
  writeRecordsJson, NO_RESULTS, STATE, SP, PROGRAM_BASE, entityType,
} from "./edsight-client.mjs"

const ROOT = join(import.meta.dirname, "..")
const OUT_DIR = join(ROOT, "data/edsight/performance-index")
const RAW_DIR = join(OUT_DIR, "raw")

const EXPORT_PROGRAM = "PerformanceIndexExport"
const REPORT_PROGRAM = "PerformanceIndexReport_SiteCore"

const SUBJECTS = ["ELA", "Math", "Science"]
// The all-students headline row: "District" in a district export, "State" in the
// statewide one.
const HEADLINE_GROUPS = new Set(["District", "State"])

// `scope` is either "All Districts" (every district with data that year) or
// "State of Connecticut" (the statewide benchmark, which "All Districts" omits).
const exportUrl = (year, scope) =>
  spUrl(EXPORT_PROGRAM, {
    _year: year,
    _district: scope,
    _school: " ",
    _subgroup: " ", // must be a bare space — see header comment
    _subject: "All Subjects",
  })

const REPORT_PARAMS = {
  _year: "Trend",
  _district: STATE,
  _school: "",
  _subgroup: "  ",
  _subject: "All Subjects",
  _select: "Submit",
}

/*
 * Reshape one year's export into tidy long rows.
 *
 * Upstream is wide — ELACount, ELAPerformanceIndex, MathCount, … — so we locate
 * each subject's pair of columns by header name rather than by position, then
 * emit one row per subject.
 */
const tidy = (csvText, year) => {
  if (NO_RESULTS.test(csvText)) return []
  const rows = parseCsv(csvText)
  const { headerRow: hi, col } = headerIndex(rows, "District Name")
  const idx = {
    district: col("District Name"),
    code: col("District Code"), // absent from the statewide export
    category: col("Category"),
    group: col("Student Group"),
  }
  Object.entries(idx).forEach(([k, v]) => {
    if (v < 0 && k !== "code") throw new Error(`${year}: export is missing the ${k} column`)
  })
  const subjectCols = SUBJECTS.map((s) => ({
    subject: s,
    count: col(`${s}Count`),
    index: col(`${s}PerformanceIndex`),
  })).filter((s) => s.index >= 0)

  // This feed has no blank index cells (verified across all years), so a blank
  // and a `*` mean the same thing here: withheld.
  const num = (raw) => {
    const { value, missing } = parseNumber(raw)
    return { value, suppressed: missing === "blank" ? "suppressed" : missing }
  }

  const out = []
  for (const r of rows.slice(hi + 1)) {
    const district = r[idx.district]?.trim()
    if (!district) continue
    const districtCode = idx.code >= 0 ? cleanCode(r[idx.code]) : ""
    for (const s of subjectCols) {
      const index = num(r[s.index])
      const count = s.count >= 0 ? num(r[s.count]) : { value: null, suppressed: null }
      out.push({
        year,
        district,
        districtCode,
        entityType: entityType(districtCode, district),
        category: r[idx.category]?.trim() ?? "",
        studentGroup: r[idx.group]?.trim() ?? "",
        subject: s.subject,
        count: count.value,
        index: index.value,
        suppressed: index.suppressed,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------- outputs

const FIELDS = ["year", "district", "districtCode", "entityType", "category", "studentGroup", "subject", "count", "index", "suppressed"]

const writeXlsx = async (records, years, file) => {
  const wb = new ExcelJS.Workbook()
  wb.creator = "andoverct.info"
  wb.created = new Date()

  // One sheet per subject, districts down and years across, for the "All
  // Students" headline — the shape a person actually wants to eyeball. The
  // full long table gets its own sheet for anyone doing real work.
  for (const subject of SUBJECTS) {
    const sheet = wb.addWorksheet(subject)
    sheet.columns = [
      { header: "District", key: "district", width: 44 },
      { header: "Code", key: "code", width: 10 },
      ...years.map((y) => ({ header: y, key: y, width: 9 })),
    ]
    const byDistrict = new Map()
    for (const r of records) {
      // The headline row is labelled "District" per district and "State" in the
      // statewide export.
      if (r.subject !== subject || !HEADLINE_GROUPS.has(r.studentGroup)) continue
      if (!byDistrict.has(r.district)) {
        byDistrict.set(r.district, { district: r.district, code: r.districtCode })
      }
      byDistrict.get(r.district)[r.year] = r.index
    }
    // Statewide first so every district reads against the benchmark.
    const ordered = [...byDistrict.values()].sort(
      (a, b) =>
        (a.district === STATE ? -1 : 0) - (b.district === STATE ? -1 : 0) ||
        a.district.localeCompare(b.district)
    )
    for (const row of ordered) sheet.addRow(row)
    sheet.getRow(1).font = { bold: true }
    if (ordered[0]?.district === STATE) sheet.getRow(2).font = { bold: true }
    sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }]
  }

  const all = wb.addWorksheet("All groups")
  all.columns = FIELDS.map((f) => ({ header: f, key: f, width: f === "district" ? 44 : 16 }))
  all.getRow(1).font = { bold: true }
  all.views = [{ state: "frozen", ySplit: 1 }]
  for (const r of records) all.addRow(r)

  await wb.xlsx.writeFile(file)
}

// ---------------------------------------------------------------- main

const argv = process.argv.slice(2)
const offline = argv.includes("--offline")
const yearArg = argv.includes("--year") ? argv[argv.indexOf("--year") + 1] : null

mkdirSync(RAW_DIR, { recursive: true })

// Two raw files per year: the districts and the statewide benchmark.
const SCOPES = [
  { key: "districts", district: "All Districts" },
  { key: "state", district: "State of Connecticut" },
]
const rawFor = (year, scope) => join(RAW_DIR, `performance-index-${year}-${scope}.csv`)

const cachedYears = () =>
  [...new Set(
    readdirSync(RAW_DIR)
      .map((f) => f.match(/^performance-index-(\d{4}-\d{2})-\w+\.csv$/)?.[1])
      .filter(Boolean)
  )].sort()

let years = []
const fetchedAt = new Date().toISOString()

const newestRawAt = () => {
  const times = readdirSync(RAW_DIR)
    .filter((f) => f.endsWith(".csv"))
    .map((f) => statSync(join(RAW_DIR, f)).mtimeMs)
  return times.length ? new Date(Math.max(...times)).toISOString() : fetchedAt
}

if (offline) {
  years = cachedYears()
  if (!years.length) throw new Error(`--offline but no cached CSVs in ${RAW_DIR}`)
  console.log(`offline: re-deriving from ${years.length} cached year(s)`)
} else {
  const jar = new Jar()
  years = yearArg ? [yearArg] : await fetchYears(REPORT_PROGRAM, REPORT_PARAMS, jar)
  console.log(`years: ${years.join(", ")}`)
  for (const year of years) {
    const notes = []
    for (const scope of SCOPES) {
      const text = await (await get(exportUrl(year, scope.district), jar)).text()
      writeFileSync(rawFor(year, scope.key), text)
      notes.push(`${scope.key} ${NO_RESULTS.test(text) ? "none" : `${(text.length / 1024).toFixed(0)}KB`}`)
    }
    console.log(`  ${year} … ${notes.join(", ")}`)
  }
}

// Always rebuild the combined outputs from every cached year, so refreshing a
// single year with --year does not truncate the dataset.
const allYears = cachedYears()

const records = []
allYears.forEach((year) => {
  for (const scope of SCOPES) {
    const file = rawFor(year, scope.key)
    if (existsSync(file)) records.push(...tidy(readFileSync(file, "utf8"), year))
  }
})
records.sort(
  (a, b) =>
    (a.district === STATE ? -1 : 0) - (b.district === STATE ? -1 : 0) ||
    a.district.localeCompare(b.district) ||
    a.year.localeCompare(b.year) ||
    a.category.localeCompare(b.category) ||
    a.studentGroup.localeCompare(b.studentGroup) ||
    SUBJECTS.indexOf(a.subject) - SUBJECTS.indexOf(b.subject)
)

const districts = [...new Set(records.map((r) => r.district))].filter((d) => d !== STATE).sort()

writeFileSync(
  join(OUT_DIR, "performance-index.csv"),
  toCsv([FIELDS, ...records.map((r) => FIELDS.map((f) => r[f]))])
)

writeRecordsJson(
  join(OUT_DIR, "performance-index.json"),
    {
      source: "CT EdSight, Performance Index",
      page: "https://public-edsight.ct.gov/performance/performance-index?language=en_US",
      endpoint: `${SP}?_program=${PROGRAM_BASE}/${EXPORT_PROGRAM}`,
      // On an offline rebuild the meaningful date is when the cached raws were
      // captured, not when the reshape ran.
      fetchedAt: offline ? newestRawAt() : fetchedAt,
      years: allYears,
      districtCount: districts.length,
      rowCount: records.length,
      notes: [
        "index is the Performance Index (0-100); CT's target is 75.",
        "count is the number of assessed students behind that index.",
        "index null with suppressed='suppressed' means upstream '*' (small n, withheld).",
        "index null with suppressed='not-applicable' means the subject is not assessed at that grade.",
        "Science assessments changed in 2018-19; earlier science years are not comparable.",
        "Districts appear only in years they had data, so consolidated districts come and go.",
        `"${STATE}" is the statewide benchmark, fetched separately; its headline student group is "State" rather than "District" and it carries no districtCode.`,
      ],
    },
  records
)

await writeXlsx(records, allYears, join(OUT_DIR, "performance-index.xlsx"))

console.log(
  `\n${records.length.toLocaleString()} rows · ${districts.length} districts · ${allYears.length} years` +
    `\nwrote ${OUT_DIR.replace(ROOT, ".")}/performance-index.{csv,json,xlsx}`
)
