/*
 * Shared client for CT EdSight's public data, used by the edsight-*.mjs fetchers.
 *
 * EdSight's public pages (public-edsight.ct.gov) are a Sitecore shell. The data
 * behind each one comes from a SAS 9.4 stored process on edsight.ct.gov, and
 * every report page carries an "Export .csv file" link pointing at a sibling
 * `…Export` stored process that returns CSV directly. So these fetchers need
 * nothing but fetch() and a cookie jar — no browser automation.
 *
 * Reports found so far, all on the same pattern:
 *   PerformanceIndexReport_SiteCore          / PerformanceIndexExport
 *   EFSDistrictLevelbyFunctionReport_SiteCore / EFSDistrictLevelbyFunctionExport
 * and a family of sibling finance reports (by object, by funding source,
 * special education, revenue sources, outplaced students) not yet wired up.
 *
 * Two conventions make bulk collection cheap: `_district=All Districts` returns
 * every district in one response, and the endpoint authenticates as an anonymous
 * guest — the first request 302s through SASLogon/CAS and needs only cookie
 * persistence across the hops.
 */
import { writeFileSync } from "node:fs";

export const HOST = "https://edsight.ct.gov";
export const SP = `${HOST}/SASStoredProcess/do`;
export const PROGRAM_BASE = "/CTDOE/EdSight/Release/Reporting/Public/Reports/StoredProcesses";

/** Upstream's marker for a parameter combination that yields nothing. */
export const NO_RESULTS = /did not contain any results/i;

/** The statewide row's district label, which `All Districts` never includes. */
export const STATE = "State of Connecticut";

// ---------------------------------------------------------------- http

/*
 * The stored process bounces through SASLogon/CAS to mint a guest session, so
 * the only state we need to carry across redirects is cookies. Keyed by name;
 * every hop is the same host.
 */
export class Jar {
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

export async function get(url, jar, { maxHops = 12 } = {}) {
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

/** Build a stored-process URL. `program` is a name under PROGRAM_BASE. */
export function spUrl(program, params) {
  const q = new URLSearchParams({ _program: `${PROGRAM_BASE}/${program}`, ...params });
  return `${SP}?${q}`;
}

export const fetchText = async (url, jar) => (await get(url, jar)).text();

/*
 * Read one <select>'s options out of a report page's HTML. The report pages
 * embed their own filter form, so the available years and districts come from
 * upstream rather than being hardcoded — a new school year shows up on its own.
 */
export function selectOptions(html, name) {
  const block = html.match(new RegExp(`<select name="${name}"[\\s\\S]*?</select>`, "i"));
  if (!block) return null;
  return [...block[0].matchAll(/<option[^>]*>([^<\n]*)/g)].map((m) => m[1].trim()).filter(Boolean);
}

/** The school years offered by a report, newest-last, with "Trend" dropped. */
export async function fetchYears(reportProgram, params, jar) {
  const html = await fetchText(spUrl(reportProgram, params), jar);
  const years = (selectOptions(html, "_year") ?? []).filter((y) => /^\d{4}-\d{2}$/.test(y));
  if (!years.length) throw new Error(`${reportProgram}: no school years in the _year dropdown`);
  return years.sort();
}

// ---------------------------------------------------------------- csv

/** RFC 4180 enough for these feeds: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text) {
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

export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/*
 * Locate a report's header row and give back a lookup from column name to index.
 * Columns are found by name rather than position because the statewide export
 * does not always carry the same columns as the district one.
 */
export function headerIndex(rows, firstColumn) {
  const i = rows.findIndex((r) => r[0]?.trim() === firstColumn);
  if (i < 0) throw new Error(`no "${firstColumn}" header row in export`);
  const header = rows[i].map((h) => h.trim());
  const col = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  return { headerRow: i, header, col };
}

/** District codes arrive Excel-armoured as ="0010011" so leading zeros survive. */
export const cleanCode = (v) => {
  const m = String(v).match(/^="?"?(\d+)"?"?$/);
  return m ? m[1] : String(v).replace(/[="]/g, "").trim();
};

/*
 * Upstream's two flavours of missing. `*` is a privacy suppression (small n);
 * `N/A` means the measure does not apply. Anything else non-numeric is handed
 * back verbatim so it shows up rather than being silently nulled.
 */
export function parseNumber(raw) {
  const v = String(raw ?? "").trim();
  if (v === "") return { value: null, missing: "blank" };
  if (v === "*") return { value: null, missing: "suppressed" };
  if (/^n\/?a$/i.test(v)) return { value: null, missing: "not-applicable" };
  const n = Number(v.replace(/[$,%\s]/g, "")); // currency and thousands separators
  return Number.isFinite(n) ? { value: n, missing: null } : { value: null, missing: v };
}

// ---------------------------------------------------------------- output

/*
 * Metadata pretty-printed, then one record per line: a third the size of a fully
 * indented dump, and a readable diff when a single year is refreshed.
 */
export function writeRecordsJson(file, meta, records) {
  const head = JSON.stringify(meta, null, 2);
  writeFileSync(
    file,
    `${head.slice(0, -2)},\n  "records": [\n` +
      records.map((r) => `    ${JSON.stringify(r)}`).join(",\n") +
      "\n  ]\n}\n"
  );
}
