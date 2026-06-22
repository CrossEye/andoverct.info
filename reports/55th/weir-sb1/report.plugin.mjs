/*
 * Report-specific transform for the SB 1 vote report: auto-link Connecticut
 * bill references (HB-7280, SB-1, etc.) to the CT General Assembly bill-status
 * page. Ported from the original build.py. Loaded by the engine because the
 * front matter names it (`plugin: report.plugin.mjs`); it runs after numeric
 * alignment and before confirmation marks.
 *
 * Two reference shapes are linked:
 *   1. Prose / list form: "HB-7280 (2025)" or "HB-7280, 2025" — year adjacent.
 *   2. Table form: a <td>2025</td> cell followed by a <td>HB-7280</td> cell —
 *      the row's first cell supplies the year for the bill cell.
 * Existing <a> links and anything inside <th> are left untouched.
 */

const CGA_BILL_URL =
  "https://www.cga.ct.gov/asp/cgabillstatus/cgabillstatus.asp" +
  "?selBillType=Bill&bill_num={billnum_padded}&which_year={year}";

const BILL_PREFIX = "(?:H[BJR]|S[BJR])";

function cgaUrl(year, billText) {
  const m = billText.match(new RegExp(`(${BILL_PREFIX})-?(\\d+)`));
  if (!m) return null;
  const padded = m[1] + String(parseInt(m[2], 10)).padStart(5, "0");
  return CGA_BILL_URL.replace("{billnum_padded}", padded).replace("{year}", String(year));
}

function linkBillReferences(html) {
  const makeLink = (billText, year, cls = "bill-ref") => {
    const url = cgaUrl(year, billText);
    return url ? `<a class="${cls}" href="${url}">${billText}</a>` : billText;
  };

  // ---- Pattern 1: "BILL (YEAR)" / "BILL, YEAR" outside <a> and <th> zones ----
  const skipRe = /(<a\b[^>]*>[\s\S]*?<\/a>|<th\b[^>]*>[\s\S]*?<\/th>)/gi;
  const proseRe = new RegExp(
    `(${BILL_PREFIX})-?(\\d+)(\\s*[\\(,]\\s*|\\s+)(\\d{4})(\\)|\\b)`,
    "g"
  );
  const proseRepl = (full, prefix, num, sep, year, close) => {
    if (!(sep.includes("(") || sep.includes(","))) return full; // need adjacent year
    return `${makeLink(`${prefix}-${num}`, year)}${sep}${year}${close}`;
  };

  const parts = [];
  let pos = 0;
  for (const skip of html.matchAll(skipRe)) {
    parts.push(html.slice(pos, skip.index).replace(proseRe, proseRepl));
    parts.push(skip[0]);
    pos = skip.index + skip[0].length;
  }
  parts.push(html.slice(pos).replace(proseRe, proseRepl));
  let body = parts.join("");

  // ---- Pattern 2: table rows where cell 1 is a 4-digit year, cell 2 a bill ----
  const linkifyRow = (rowHtml) => {
    const cells = [...rowHtml.matchAll(/(<td[^>]*>)([\s\S]*?)(<\/td>)/g)];
    if (cells.length < 2) return rowHtml;
    const yearText = cells[0][2].replace(/<[^>]+>/g, "").trim();
    const billText = cells[1][2].replace(/<[^>]+>/g, "").trim();
    if (!/^\d{4}$/.test(yearText)) return rowHtml;
    if (!new RegExp(`^${BILL_PREFIX}-?\\d+$`).test(billText)) return rowHtml;
    if (cells[1][2].includes("<a")) return rowHtml; // already linked
    const url = cgaUrl(yearText, billText);
    if (!url) return rowHtml;
    const bc = cells[1];
    const newInner = `${bc[1]}<a class="bill-ref" href="${url}">${bc[2]}</a>${bc[3]}`;
    return rowHtml.slice(0, bc.index) + newInner + rowHtml.slice(bc.index + bc[0].length);
  };

  body = body.replace(/<tbody>([\s\S]*?)<\/tbody>/g, (m, inner) => {
    const fixed = inner.replace(/<tr>([\s\S]*?)<\/tr>/g, (rm, r) => `<tr>${linkifyRow(r)}</tr>`);
    return `<tbody>${fixed}</tbody>`;
  });

  return body;
}

export function transform(html) {
  return linkBillReferences(html);
}
