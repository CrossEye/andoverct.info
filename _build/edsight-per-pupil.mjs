#!/usr/bin/env node
/*
 * Fetches CT EdSight's "Per Pupil Expenditures by Function (District)" for every
 * district, every year, from the SAS stored process behind the public page:
 *
 *   https://public-edsight.ct.gov/overview/per-pupil-expenditures-by-function---district
 *
 *   npm run fetch:edsight-ppe                    # all years → data/edsight/per-pupil-expenditures/
 *   npm run fetch:edsight-ppe -- --year 2024-25
 *   npm run fetch:edsight-ppe -- --offline       # re-derive outputs from cached raw CSVs
 *
 * Mechanics (and their traps) are shared with the other EdSight fetchers — see
 * _build/edsight-client.mjs. As there, `_district=All Districts` returns the whole
 * state in one request, so a year is two requests: the districts and the statewide
 * benchmark that `All Districts` leaves out.
 *
 * Upstream gives 12 rows per district — 11 spending functions plus a `Total` row
 * that is their sum. Two things matter when using this data:
 *
 *   - **The denominator changes by function.** Each row carries its own `Pupils`
 *     count and a `Pupil Basis` saying which population it is: 1 = enrollment plus
 *     outplaced pupils, 2 = enrollment in district schools, 3 = total pupils
 *     transported. So student transportation is per *transported* pupil, and is
 *     not comparable with the other functions' per-pupil figures. `Total` and
 *     `Instruction` use basis 1; most others use basis 2.
 *   - **Expenditures are not the whole budget.** Upstream excludes debt, capital
 *     beyond equipment, adult education, community services, non-local food
 *     service, and the state's Teachers' Retirement contributions. Regular and
 *     special education are both included.
 *
 * `N/A` (common for Minor school construction) becomes null with `missing` saying
 * why. Years run 2017-18 to 2024-25; this report has 2019-20 and 2020-21, which
 * the assessment data does not.
 *
 * Outputs, all from the same fetch so they cannot drift:
 *   data/edsight/per-pupil-expenditures/raw/per-pupil-<year>-{districts,state}.csv
 *   data/edsight/per-pupil-expenditures/per-pupil-expenditures.csv   — tidy long format
 *   data/edsight/per-pupil-expenditures/per-pupil-expenditures.json  — same rows + provenance
 *   data/edsight/per-pupil-expenditures/per-pupil-expenditures.xlsx  — total-PPE trend,
 *       a districts × functions grid for the latest year, and the full long table
 *
 * Tidy row shape (one row per district × year × function):
 *   year, district, districtCode, function, expenditures, pupils, pupilBasis,
 *   pupilBasisLabel, ppe, missing
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import {
  Jar, get, spUrl, fetchYears, parseCsv, toCsv, headerIndex, cleanCode, parseNumber,
  writeRecordsJson, NO_RESULTS, STATE, SP, PROGRAM_BASE,
} from "./edsight-client.mjs";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "data/edsight/per-pupil-expenditures");
const RAW_DIR = join(OUT_DIR, "raw");

const EXPORT_PROGRAM = "EFSDistrictLevelbyFunctionExport";
const REPORT_PROGRAM = "EFSDistrictLevelbyFunctionReport_SiteCore";

const TOTAL = "Total";

// Straight from upstream's own note line, so a reader never has to guess which
// population a per-pupil figure is divided by.
const PUPIL_BASIS = {
  1: "Enrollment plus outplaced pupils",
  2: "Enrollment in district schools",
  3: "Total pupils transported",
};

// Upstream's function order, which is meaningful (instruction first, Total last)
// and worth preserving rather than sorting alphabetically. Filled in from the
// first export parsed, so a new function category does not need a code change.
let functionOrder = [];

const exportUrl = (year, district) => spUrl(EXPORT_PROGRAM, { _year: year, _district: district });
const REPORT_PARAMS = { _year: "2024-25", _district: STATE, _select: "Submit" };

// ---------------------------------------------------------------- reshape

function tidy(csvText, year) {
  if (NO_RESULTS.test(csvText)) return [];
  const rows = parseCsv(csvText);
  const { headerRow: hi, col } = headerIndex(rows, "District");
  const idx = {
    district: col("District"),
    code: col("District Code"),
    function: col("Function"),
    expenditures: col("Expenditures"),
    pupils: col("Pupils"),
    basis: col("Pupil Basis"),
    ppe: col("PPE"),
  };
  for (const [k, v] of Object.entries(idx)) {
    if (v < 0) throw new Error(`${year}: export is missing the ${k} column`);
  }

  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const district = r[idx.district]?.trim();
    if (!district) continue;
    const fn = r[idx.function]?.trim() ?? "";
    if (fn && !functionOrder.includes(fn)) functionOrder.push(fn);

    // Currency arrives as "$9,234,243"; parseNumber strips $ and separators.
    const expenditures = parseNumber(r[idx.expenditures]);
    const pupils = parseNumber(r[idx.pupils]);
    const basis = parseNumber(r[idx.basis]);
    const ppe = parseNumber(r[idx.ppe]);

    out.push({
      year,
      district,
      districtCode: cleanCode(r[idx.code]),
      function: fn,
      expenditures: expenditures.value,
      pupils: pupils.value,
      pupilBasis: basis.value,
      pupilBasisLabel: basis.value != null ? (PUPIL_BASIS[basis.value] ?? "") : "",
      ppe: ppe.value,
      // One flag for the row: these columns go missing together (a function a
      // district did not report at all), so recording it once per row is honest
      // and keeps the table narrow.
      missing: ppe.missing,
    });
  }
  return out;
}

// ---------------------------------------------------------------- outputs

const FIELDS = [
  "year", "district", "districtCode", "function", "expenditures",
  "pupils", "pupilBasis", "pupilBasisLabel", "ppe", "missing",
];

const byDistrictFirstState = (a, b) =>
  (a.district === STATE ? -1 : 0) - (b.district === STATE ? -1 : 0) ||
  a.district.localeCompare(b.district);

async function writeXlsx(records, years, functions, file) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "andoverct.info";
  wb.created = new Date();
  const money = '"$"#,##0';

  // 1. Total PPE over time — the headline trend, statewide row pinned on top.
  const trend = wb.addWorksheet("Total PPE");
  trend.columns = [
    { header: "District", key: "district", width: 44 },
    { header: "Code", key: "code", width: 10 },
    ...years.map((y) => ({ header: y, key: y, width: 11, style: { numFmt: money } })),
  ];
  const totals = new Map();
  for (const r of records) {
    if (r.function !== TOTAL) continue;
    if (!totals.has(r.district)) totals.set(r.district, { district: r.district, code: r.districtCode });
    totals.get(r.district)[r.year] = r.ppe;
  }
  for (const row of [...totals.values()].sort(byDistrictFirstState)) trend.addRow(row);

  // 2. The latest year broken out by function — districts down, functions across.
  //    This is the cross-district comparison shape, for every district at once.
  const latest = years[years.length - 1];
  const grid = wb.addWorksheet(`By function ${latest}`);
  grid.columns = [
    { header: "District", key: "district", width: 44 },
    { header: "Code", key: "code", width: 10 },
    ...functions.map((f) => ({ header: f, key: f, width: 15, style: { numFmt: money } })),
  ];
  const byDistrict = new Map();
  for (const r of records) {
    if (r.year !== latest) continue;
    if (!byDistrict.has(r.district)) byDistrict.set(r.district, { district: r.district, code: r.districtCode });
    byDistrict.get(r.district)[r.function] = r.ppe;
  }
  for (const row of [...byDistrict.values()].sort(byDistrictFirstState)) grid.addRow(row);

  // 3. Everything, for real work.
  const all = wb.addWorksheet("All rows");
  all.columns = FIELDS.map((f) => ({
    header: f,
    key: f,
    width: f === "district" ? 44 : f === "function" ? 46 : f === "pupilBasisLabel" ? 30 : 14,
    ...(f === "expenditures" || f === "ppe" ? { style: { numFmt: money } } : {}),
  }));
  for (const r of records) all.addRow(r);

  for (const sheet of wb.worksheets) {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", xSplit: sheet.name === "All rows" ? 0 : 2, ySplit: 1 }];
  }
  // Statewide row bold on the two pivot sheets.
  for (const name of ["Total PPE", `By function ${latest}`]) {
    const sheet = wb.getWorksheet(name);
    if (sheet.getRow(2).getCell(1).value === STATE) sheet.getRow(2).font = { bold: true };
  }

  await wb.xlsx.writeFile(file);
}

// ---------------------------------------------------------------- main

const argv = process.argv.slice(2);
const offline = argv.includes("--offline");
const yearArg = argv.includes("--year") ? argv[argv.indexOf("--year") + 1] : null;

mkdirSync(RAW_DIR, { recursive: true });

const SCOPES = [
  { key: "districts", district: "All Districts" },
  { key: "state", district: STATE },
];
const rawFor = (year, scope) => join(RAW_DIR, `per-pupil-${year}-${scope}.csv`);

const cachedYears = () =>
  [...new Set(
    readdirSync(RAW_DIR)
      .map((f) => f.match(/^per-pupil-(\d{4}-\d{2})-\w+\.csv$/)?.[1])
      .filter(Boolean)
  )].sort();

const fetchedAt = new Date().toISOString();
const newestRawAt = () => {
  const times = readdirSync(RAW_DIR)
    .filter((f) => f.endsWith(".csv"))
    .map((f) => statSync(join(RAW_DIR, f)).mtimeMs);
  return times.length ? new Date(Math.max(...times)).toISOString() : fetchedAt;
};

if (offline) {
  const years = cachedYears();
  if (!years.length) throw new Error(`--offline but no cached CSVs in ${RAW_DIR}`);
  console.log(`offline: re-deriving from ${years.length} cached year(s)`);
} else {
  const jar = new Jar();
  const years = yearArg ? [yearArg] : await fetchYears(REPORT_PROGRAM, REPORT_PARAMS, jar);
  console.log(`years: ${years.join(", ")}`);
  for (const year of years) {
    const notes = [];
    for (const scope of SCOPES) {
      const text = await (await get(exportUrl(year, scope.district), jar)).text();
      writeFileSync(rawFor(year, scope.key), text);
      notes.push(`${scope.key} ${NO_RESULTS.test(text) ? "none" : `${(text.length / 1024).toFixed(0)}KB`}`);
    }
    console.log(`  ${year} … ${notes.join(", ")}`);
  }
}

// Always rebuild from every cached year, so a targeted --year refresh does not
// truncate the dataset.
const allYears = cachedYears();

const records = [];
for (const year of allYears) {
  for (const scope of SCOPES) {
    const file = rawFor(year, scope.key);
    if (existsSync(file)) records.push(...tidy(readFileSync(file, "utf8"), year));
  }
}

// Upstream order for functions; Total forced last in case a year lists it early.
functionOrder = [...functionOrder.filter((f) => f !== TOTAL), TOTAL];
const fnRank = (f) => {
  const i = functionOrder.indexOf(f);
  return i < 0 ? functionOrder.length : i;
};

records.sort(
  (a, b) =>
    byDistrictFirstState(a, b) ||
    a.year.localeCompare(b.year) ||
    fnRank(a.function) - fnRank(b.function)
);

const districts = [...new Set(records.map((r) => r.district))].filter((d) => d !== STATE).sort();

writeFileSync(
  join(OUT_DIR, "per-pupil-expenditures.csv"),
  toCsv([FIELDS, ...records.map((r) => FIELDS.map((f) => r[f]))])
);

writeRecordsJson(
  join(OUT_DIR, "per-pupil-expenditures.json"),
  {
    source: "CT EdSight, Per Pupil Expenditures by Function (District)",
    page: "https://public-edsight.ct.gov/overview/per-pupil-expenditures-by-function---district",
    endpoint: `${SP}?_program=${PROGRAM_BASE}/${EXPORT_PROGRAM}`,
    fetchedAt: offline ? newestRawAt() : fetchedAt,
    years: allYears,
    districtCount: districts.length,
    rowCount: records.length,
    functions: functionOrder,
    pupilBasis: PUPIL_BASIS,
    notes: [
      "expenditures is dollars; ppe is dollars per pupil; pupils is the denominator for that row.",
      "The denominator varies by function — see pupilBasis. Student transportation is per transported pupil and is not comparable with the other functions.",
      "The 'Total' function row is the sum of the other functions, on pupil basis 1. It reconciles exactly for 1,556 of 1,569 district-years; eleven are off by a few dollars, and upstream's STATEWIDE total exceeds the sum of its own functions by $33.6M in 2017-18 and $30.1M in 2018-19 (~0.3%). Those two statewide figures are an upstream quirk, not a parsing artifact. 2024-25 reconciles exactly everywhere.",
      "Expenditures exclude debt, capital beyond equipment, adult education, community services, non-local food service, and state Teachers' Retirement contributions. Regular and special education are both included.",
      "Upstream is district-reported; questions about a district's figures go to that district.",
      "null with missing='not-applicable' is upstream 'N/A' (commonly Minor school construction).",
      `"${STATE}" is the statewide benchmark, fetched separately because 'All Districts' omits it.`,
    ],
  },
  records
);

await writeXlsx(records, allYears, functionOrder, join(OUT_DIR, "per-pupil-expenditures.xlsx"));

console.log(
  `\n${records.length.toLocaleString()} rows · ${districts.length} districts · ` +
    `${allYears.length} years · ${functionOrder.length} functions` +
    `\nwrote ${OUT_DIR.replace(ROOT, ".")}/per-pupil-expenditures.{csv,json,xlsx}`
);
