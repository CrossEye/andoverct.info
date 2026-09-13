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
 *   - Four entries in the dropdown (DMHAS and three closed academies) never
 *     return rows in any year.
 *   - The district-level export carries the 2-level meal category only; the
 *     3-level breakdown is not in it.
 *   - `*` means suppressed for privacy (small n), `N/A` means the subject is not
 *     assessed at that grade. Both become null, with `suppressed` recording why.
 *
 * Outputs, all from the same fetch so they cannot drift:
 *   data/edsight/performance-index/raw/performance-index-<year>.csv  — upstream bytes, untouched
 *   data/edsight/performance-index/performance-index.csv             — tidy long format
 *   data/edsight/performance-index/performance-index.json            — same rows + provenance
 *   data/edsight/performance-index/performance-index.xlsx            — one sheet per subject
 *
 * Tidy row shape (one row per district × year × student group × subject):
 *   year, district, districtCode, category, studentGroup, subject, count, index, suppressed
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "data/edsight/performance-index");
const RAW_DIR = join(OUT_DIR, "raw");

const HOST = "https://edsight.ct.gov";
const SP = `${HOST}/SASStoredProcess/do`;
const PROGRAM_BASE = "/CTDOE/EdSight/Release/Reporting/Public/Reports/StoredProcesses";
const EXPORT_PROGRAM = `${PROGRAM_BASE}/PerformanceIndexExport`;
const REPORT_PROGRAM = `${PROGRAM_BASE}/PerformanceIndexReport_SiteCore`;

const SUBJECTS = ["ELA", "Math", "Science"];
const STATE = "State of Connecticut";
// The all-students headline row: "District" in a district export, "State" in the
// statewide one.
const HEADLINE_GROUPS = new Set(["District", "State"]);

// ---------------------------------------------------------------- http

// The stored process bounces through SASLogon/CAS to mint a guest session, so
// the only thing we need to carry across redirects is cookies. Keyed by name;
// every hop is the same host.
class Jar {
  #c = new Map();
  absorb(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.#c.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  get header() {
    return [...this.#c].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function get(url, jar, { maxHops = 12 } = {}) {
  let current = url;
  for (let hop = 0; hop < maxHops; hop++) {
    const res = await fetch(current, {
      redirect: "manual",
      headers: {
        // A plain UA is enough; the endpoint does not gate on it, but being
        // identifiable is the polite thing to do against a public service.
        "user-agent": "andoverct.info data fetch (+https://andoverct.info)",
        // Required, not optional. SAS derives its session locale from this
        // header, and with no Accept-Language at all (Node's fetch sends none,
        // unlike curl or a browser) every request dies with "Stored Process
        // Error … The locale cannot be created."
        "accept-language": "en-US,en;q=0.9",
        ...(jar.header ? { cookie: jar.header } : {}),
      },
    });
    jar.absorb(res);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`${res.status} with no Location at ${current}`);
      current = new URL(loc, current).href;
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} at ${current}`);
    return res;
  }
  throw new Error(`too many redirects starting at ${url}`);
}

// `scope` is either "All Districts" (every district with data that year) or
// "State of Connecticut" (the statewide benchmark, which "All Districts" omits).
function exportUrl(year, scope) {
  const q = new URLSearchParams({
    _program: EXPORT_PROGRAM,
    _year: year,
    _district: scope,
    _school: " ",
    _subgroup: " ", // must be a bare space — see header comment
    _subject: "All Subjects",
  });
  return `${SP}?${q}`;
}

// The year dropdown lives in the report page's own HTML, so we read the list
// from upstream rather than hardcoding it — a new school year appears on its own.
async function fetchYears(jar) {
  const q = new URLSearchParams({
    _program: REPORT_PROGRAM,
    _year: "Trend",
    _district: "State of Connecticut",
    _school: "",
    _subgroup: "  ",
    _subject: "All Subjects",
    _select: "Submit",
  });
  const html = await (await get(`${SP}?${q}`, jar)).text();
  const sel = html.match(/<select name="_year"[\s\S]*?<\/select>/i);
  if (!sel) throw new Error("could not find the _year dropdown in the report page");
  const years = [...sel[0].matchAll(/<option[^>]*>([^<\n]*)/g)]
    .map((m) => m[1].trim())
    .filter((y) => /^\d{4}-\d{2}$/.test(y)); // drop "Trend"
  if (!years.length) throw new Error("_year dropdown contained no school years");
  return years;
}

// ---------------------------------------------------------------- csv

// RFC 4180 enough for this feed: quoted fields, doubled quotes, CRLF.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csvCell = (v) =>
  v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

// District codes arrive Excel-armoured as ="0010011" so leading zeros survive.
const cleanCode = (v) => {
  const m = String(v).match(/^="?"?(\d+)"?"?$/);
  return m ? m[1] : String(v).replace(/[="]/g, "").trim();
};

const NO_RESULTS = /did not contain any results/i;

/*
 * Reshape one year's export into tidy long rows.
 *
 * Upstream is wide — ELACount, ELAPerformanceIndex, MathCount, … — so we locate
 * each subject's pair of columns by header name rather than by position, then
 * emit one row per subject.
 */
function tidy(csvText, year) {
  if (NO_RESULTS.test(csvText)) return [];
  const rows = parseCsv(csvText);
  const hi = rows.findIndex((r) => r[0]?.trim() === "District Name");
  if (hi < 0) throw new Error(`${year}: no "District Name" header row in export`);

  const header = rows[hi].map((h) => h.trim());
  const col = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const idx = {
    district: col("District Name"),
    code: col("District Code"), // absent from the statewide export
    category: col("Category"),
    group: col("Student Group"),
  };
  for (const [k, v] of Object.entries(idx)) {
    if (v < 0 && k !== "code") throw new Error(`${year}: export is missing the ${k} column`);
  }
  const subjectCols = SUBJECTS.map((s) => ({
    subject: s,
    count: col(`${s}Count`),
    index: col(`${s}PerformanceIndex`),
  })).filter((s) => s.index >= 0);

  const num = (raw) => {
    const v = String(raw ?? "").trim();
    if (v === "" || v === "*") return { value: null, suppressed: "suppressed" };
    if (/^n\/?a$/i.test(v)) return { value: null, suppressed: "not-applicable" };
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? { value: n, suppressed: null } : { value: null, suppressed: v };
  };

  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const district = r[idx.district]?.trim();
    if (!district) continue;
    for (const s of subjectCols) {
      const index = num(r[s.index]);
      const count = s.count >= 0 ? num(r[s.count]) : { value: null, suppressed: null };
      out.push({
        year,
        district,
        districtCode: idx.code >= 0 ? cleanCode(r[idx.code]) : "",
        category: r[idx.category]?.trim() ?? "",
        studentGroup: r[idx.group]?.trim() ?? "",
        subject: s.subject,
        count: count.value,
        index: index.value,
        suppressed: index.suppressed,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- outputs

const FIELDS = ["year", "district", "districtCode", "category", "studentGroup", "subject", "count", "index", "suppressed"];

async function writeXlsx(records, years, file) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "andoverct.info";
  wb.created = new Date();

  // One sheet per subject, districts down and years across, for the "All
  // Students" headline — the shape a person actually wants to eyeball. The
  // full long table gets its own sheet for anyone doing real work.
  for (const subject of SUBJECTS) {
    const sheet = wb.addWorksheet(subject);
    sheet.columns = [
      { header: "District", key: "district", width: 44 },
      { header: "Code", key: "code", width: 10 },
      ...years.map((y) => ({ header: y, key: y, width: 9 })),
    ];
    const byDistrict = new Map();
    for (const r of records) {
      // The headline row is labelled "District" per district and "State" in the
      // statewide export.
      if (r.subject !== subject || !HEADLINE_GROUPS.has(r.studentGroup)) continue;
      if (!byDistrict.has(r.district)) {
        byDistrict.set(r.district, { district: r.district, code: r.districtCode });
      }
      byDistrict.get(r.district)[r.year] = r.index;
    }
    // Statewide first so every district reads against the benchmark.
    const ordered = [...byDistrict.values()].sort(
      (a, b) =>
        (a.district === STATE ? -1 : 0) - (b.district === STATE ? -1 : 0) ||
        a.district.localeCompare(b.district)
    );
    for (const row of ordered) sheet.addRow(row);
    sheet.getRow(1).font = { bold: true };
    if (ordered[0]?.district === STATE) sheet.getRow(2).font = { bold: true };
    sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  }

  const all = wb.addWorksheet("All groups");
  all.columns = FIELDS.map((f) => ({ header: f, key: f, width: f === "district" ? 44 : 16 }));
  all.getRow(1).font = { bold: true };
  all.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of records) all.addRow(r);

  await wb.xlsx.writeFile(file);
}

// ---------------------------------------------------------------- main

const argv = process.argv.slice(2);
const offline = argv.includes("--offline");
const yearArg = argv.includes("--year") ? argv[argv.indexOf("--year") + 1] : null;

mkdirSync(RAW_DIR, { recursive: true });

// Two raw files per year: the districts and the statewide benchmark.
const SCOPES = [
  { key: "districts", district: "All Districts" },
  { key: "state", district: "State of Connecticut" },
];
const rawFor = (year, scope) => join(RAW_DIR, `performance-index-${year}-${scope}.csv`);

const cachedYears = () =>
  [...new Set(
    readdirSync(RAW_DIR)
      .map((f) => f.match(/^performance-index-(\d{4}-\d{2})-\w+\.csv$/)?.[1])
      .filter(Boolean)
  )].sort();

let years = [];
const fetchedAt = new Date().toISOString();

const newestRawAt = () => {
  const times = readdirSync(RAW_DIR)
    .filter((f) => f.endsWith(".csv"))
    .map((f) => statSync(join(RAW_DIR, f)).mtimeMs);
  return times.length ? new Date(Math.max(...times)).toISOString() : fetchedAt;
};

if (offline) {
  years = cachedYears();
  if (!years.length) throw new Error(`--offline but no cached CSVs in ${RAW_DIR}`);
  console.log(`offline: re-deriving from ${years.length} cached year(s)`);
} else {
  const jar = new Jar();
  years = yearArg ? [yearArg] : (await fetchYears(jar)).sort();
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

// Always rebuild the combined outputs from every cached year, so refreshing a
// single year with --year does not truncate the dataset.
const allYears = cachedYears();

const records = [];
for (const year of allYears) {
  for (const scope of SCOPES) {
    const file = rawFor(year, scope.key);
    if (existsSync(file)) records.push(...tidy(readFileSync(file, "utf8"), year));
  }
}
records.sort(
  (a, b) =>
    (a.district === STATE ? -1 : 0) - (b.district === STATE ? -1 : 0) ||
    a.district.localeCompare(b.district) ||
    a.year.localeCompare(b.year) ||
    a.category.localeCompare(b.category) ||
    a.studentGroup.localeCompare(b.studentGroup) ||
    SUBJECTS.indexOf(a.subject) - SUBJECTS.indexOf(b.subject)
);

const districts = [...new Set(records.map((r) => r.district))].filter((d) => d !== STATE).sort();

writeFileSync(
  join(OUT_DIR, "performance-index.csv"),
  toCsv([FIELDS, ...records.map((r) => FIELDS.map((f) => r[f]))])
);

// Metadata pretty-printed, then one record per line: a third the size of a
// fully indented dump, and a readable diff when a year is refreshed.
const meta = JSON.stringify(
    {
      source: "CT EdSight, Performance Index",
      page: "https://public-edsight.ct.gov/performance/performance-index?language=en_US",
      endpoint: `${SP}?_program=${EXPORT_PROGRAM}`,
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
    null,
    2
);

writeFileSync(
  join(OUT_DIR, "performance-index.json"),
  `${meta.slice(0, -2)},\n  "records": [\n` +
    records.map((r) => `    ${JSON.stringify(r)}`).join(",\n") +
    "\n  ]\n}\n"
);

await writeXlsx(records, allYears, join(OUT_DIR, "performance-index.xlsx"));

console.log(
  `\n${records.length.toLocaleString()} rows · ${districts.length} districts · ${allYears.length} years` +
    `\nwrote ${OUT_DIR.replace(ROOT, ".")}/performance-index.{csv,json,xlsx}`
);
