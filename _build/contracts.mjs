// Contracts-bundle builder. Triggered by a `contracts:` directive in the
// report's front matter. Reads compensation.json, dedupes by (supe + term)
// so a joint contract surfaces once, copies the underlying PDFs into a
// `contracts/{slug}/` subdir alongside the report, generates an index.html
// listing them, plus contracts.zip and contracts.xlsx for download.
//
// Front-matter shape:
//   contracts:
//     source: ../../../ct-super-scraper/compensation.json
//     pdfsBase: ../../../ct-super-scraper
//     subdir: contracts      # optional (default "contracts")
//     zip: contracts.zip     # optional
//     xlsx: contracts.xlsx   # optional

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync,
  createWriteStream,
} from "node:fs";
import { dirname, join, basename, resolve, relative } from "node:path";
import { ZipArchive } from "archiver";
import ExcelJS from "exceljs";

// ----------------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------------

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(n) {
  if (n === null || n === undefined || n === "") return "";
  const num = typeof n === "number" ? n : Number(n);
  if (Number.isNaN(num)) return "";
  return "$" + num.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtTerm(term) {
  if (!term || !term.start || !term.end) return "";
  return `${term.start.slice(0, 4)}–${term.end.slice(0, 4)}`;
}

// Vintage classification per the report's fallback rule:
//   2025-26 → primary, 2024-25 → primary (fallback), 2026-27 → future, else → stale
function classifyVintage(yearStr) {
  if (!yearStr) return "stale";
  const m = yearStr.match(/(\d{4})/);
  if (!m) return "stale";
  const start = Number(m[1]);
  if (start === 2025 || start === 2024) return "primary";
  if (start >= 2026) return "future";
  return "stale";
}

// Slug for a contract group. Joint contracts covering multiple peer districts
// get a region-style slug from `scope`; everything else uses the (first)
// district key.
function determineSlug(group) {
  if (group.entries.length > 1) {
    const m = (group.scope || "").match(/\((Region\s+\d+|ER\d+|Amity\s+Region\s+\d+)\)/i);
    if (m) return slugify(m[1]);
  }
  return slugify(group.entries[0].key);
}

// ----------------------------------------------------------------------------
// 1) Group: walk compensation.json, dedupe by (supe + start + end).
// ----------------------------------------------------------------------------

function collectGroups(data, pdfsBase) {
  const groups = new Map();
  const groupKeyFor = (d) => {
    const term = d.contract_term || {};
    return [d.supe_name || "", term.start || "", term.end || ""].join("|");
  };

  // Pass 1: districts whose source_pdf is on disk — these establish a group.
  // For a joint contract, the first member-town whose copy is found becomes
  // the canonical PDF; that's the file we copy into contracts/{slug}/.
  for (const [key, d] of Object.entries(data.districts || {})) {
    const src = d.source_pdf;
    if (!src || typeof src !== "string" || !src.toLowerCase().endsWith(".pdf")) continue;
    const srcAbs = resolve(pdfsBase, src);
    if (!existsSync(srcAbs)) continue;

    const groupKey = groupKeyFor(d);
    let g = groups.get(groupKey);
    if (!g) {
      g = {
        supe: d.supe_name,
        scope: d.scope,
        term: d.contract_term || {},
        vintage: d.comp_year_used,
        fteEquiv: d.fte_equivalent_total_cash,
        joint: d.joint_contract,
        sourceAbs: srcAbs,
        sourceFilename: basename(srcAbs),
        entries: [],
        notes: d.notes,
      };
      groups.set(groupKey, g);
    }
    g.entries.push({ key, district: d });
  }

  // Pass 2: districts whose source_pdf is missing on disk but match an
  // existing group via (supe + term) — attach them to that group so a joint
  // contract picks up all member districts even if the PDF lives in only one
  // town's folder.
  for (const [key, d] of Object.entries(data.districts || {})) {
    const src = d.source_pdf;
    if (!src || typeof src !== "string" || !src.toLowerCase().endsWith(".pdf")) continue;
    const srcAbs = resolve(pdfsBase, src);
    if (existsSync(srcAbs)) continue;

    const g = groups.get(groupKeyFor(d));
    if (g && !g.entries.some((e) => e.key === key)) {
      g.entries.push({ key, district: d });
    }
  }

  const groupList = [...groups.values()];
  for (const g of groupList) {
    g.slug = determineSlug(g);
    g.status = classifyVintage(g.vintage);
    g.displayName = g.entries.length > 1
      ? g.entries.map((e) => e.key).join(" / ")
      : g.entries[0].key;
  }

  groupList.sort((a, b) => {
    // primary first, then future, then stale; then by FTE-equivalent desc.
    const rank = { primary: 0, future: 1, stale: 2 };
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return (b.fteEquiv || 0) - (a.fteEquiv || 0);
  });

  return groupList;
}

// ----------------------------------------------------------------------------
// 2) Copy PDFs into contracts/{slug}/{filename}
// ----------------------------------------------------------------------------

function copyPdfs(groups, contractsDir) {
  for (const g of groups) {
    const destDir = join(contractsDir, g.slug);
    mkdirSync(destDir, { recursive: true });
    const destPdf = join(destDir, g.sourceFilename);
    copyFileSync(g.sourceAbs, destPdf);
    g.relPdf = `${g.slug}/${g.sourceFilename}`;
  }
}

// ----------------------------------------------------------------------------
// 3) Generate contracts/index.html
// ----------------------------------------------------------------------------

const STATUS_LABEL = {
  primary: "Primary",
  future: "Future",
  stale: "Stale ⚠",
};

// Convert the parent report's breadcrumb (whose final segment is the report
// title, marked `<span class="current">`) into one suitable for this subpage:
// turn the title into a link back to ../ and append "Contracts" as the new
// terminal `current` node. Keeps using base.css's `.page-banner .crumbs`
// styling unchanged.
function extendBreadcrumb(breadcrumb, reportHref, finalLabel) {
  if (!breadcrumb) return "";
  return breadcrumb.replace(
    /<span class="current">([^<]+)<\/span>/,
    `<a href="${reportHref}">$1</a><span class="sep">›</span><span class="current">${escapeHtml(finalLabel)}</span>`
  );
}

function buildIndexHtml(groups, meta, themeCss, baseCss, breadcrumb) {
  const title = `${meta.title || "Contracts"} — Contracts on file`;
  const extendedCrumbs = extendBreadcrumb(breadcrumb, "../", "Contracts");

  const rows = groups.map((g) => {
    const districts = g.entries.map((e) => escapeHtml(e.key)).join(", ");
    return `
        <tr class="status-${g.status}">
          <td><a href="${escapeHtml(g.relPdf)}" target="_blank" rel="noopener">${escapeHtml(g.sourceFilename)}</a></td>
          <td>${escapeHtml(g.supe || "")}</td>
          <td>${districts}</td>
          <td>${escapeHtml(g.scope || "")}</td>
          <td>${escapeHtml(fmtTerm(g.term))}</td>
          <td class="num">${escapeHtml(g.vintage || "")}</td>
          <td class="num">${formatMoney(g.fteEquiv)}</td>
          <td class="status-cell">${STATUS_LABEL[g.status] || g.status}</td>
        </tr>`;
  }).join("");

  const counts = { primary: 0, future: 0, stale: 0 };
  for (const g of groups) counts[g.status]++;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${baseCss}\n${themeCss}\n${LOCAL_CSS}</style>
</head>
<body${meta.draft ? ' data-draft="true"' : ""}>
<div class="page-banner">
  <nav class="page-banner-inner crumbs">
    ${extendedCrumbs}
  </nav>
</div>
<main class="container">
  <header class="report-head">
    <h1>Contracts on file</h1>
    <p class="subtitle">${escapeHtml(meta.title || "")} — ${groups.length} unique contracts (${counts.primary} primary, ${counts.future} future, ${counts.stale} stale).
       Click any filename to open the PDF. Joint contracts are listed once with all member districts in the District(s) column.
       <a href="../">← Back to report</a> · <a href="../contracts.zip">Download all as ZIP</a> · <a href="../contracts.xlsx">Spreadsheet (XLSX)</a>
    </p>
  </header>
  <section>
    <table class="contracts-table">
      <thead>
        <tr>
          <th>PDF</th>
          <th>Superintendent</th>
          <th>District(s)</th>
          <th>Scope</th>
          <th>Term</th>
          <th>Vintage</th>
          <th>FTE-equiv</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>
  </section>
</main>
</body>
</html>`;
}

const LOCAL_CSS = `
.container { max-width: 1200px; margin: 0 auto; padding: 24px; }
.report-head h1 { margin-bottom: 6px; }
.subtitle { color: #555; font-size: 14px; line-height: 1.5; }
table.contracts-table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
table.contracts-table th, table.contracts-table td {
  padding: 6px 10px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top;
}
table.contracts-table th { background: #f5f2e8; font-weight: 600; }
table.contracts-table td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
table.contracts-table .status-stale  { background: #faf4ee; color: #6b4a1a; }
table.contracts-table .status-future { background: #f5f3fc; color: #3a2a6b; }
table.contracts-table .status-cell { white-space: nowrap; font-weight: 500; }
`;

// ----------------------------------------------------------------------------
// 4) Build contracts.zip
// ----------------------------------------------------------------------------

async function buildZip(zipPath, groups, contractsDir, manifestRows) {
  return new Promise((resolveP, rejectP) => {
    const out = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    out.on("close", resolveP);
    archive.on("error", rejectP);
    archive.pipe(out);

    // Add each PDF under the same slug-folder layout used on the site.
    for (const g of groups) {
      const onDisk = join(contractsDir, g.slug, g.sourceFilename);
      archive.file(onDisk, { name: `contracts/${g.slug}/${g.sourceFilename}` });
    }
    // Add a manifest CSV so a reader who unzips can navigate without the HTML.
    const csv = ["pdf,supe,districts,scope,term,vintage,fte_equiv,status"]
      .concat(manifestRows.map((r) => r.map(csvCell).join(",")))
      .join("\n") + "\n";
    archive.append(csv, { name: "contracts/manifest.csv" });

    archive.finalize();
  });
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ----------------------------------------------------------------------------
// 5) Build contracts.xlsx (two sheets: By district, By contract)
// ----------------------------------------------------------------------------

// Resolve the absolute URL that each contract PDF will live at on the site.
// Built from `meta.publicUrl` (front matter) + the contracts subdir + slug/filename,
// so re-deploying the report anywhere is one front-matter line change away.
function makeContractUrlBuilder(meta, subdir) {
  const base = String(meta.publicUrl || "").replace(/\/+$/, "");
  return (slug, filename) => {
    if (!base) return ""; // no publicUrl set; degrade gracefully
    return `${base}/${subdir}/${encodeURIComponent(slug)}/${encodeURIComponent(filename)}`;
  };
}

// Build a sheet-cell hyperlink whose display text is short-and-readable while
// the actual link target is the full URL.
function linkCell(displayText, hyperlink) {
  if (!hyperlink) return displayText || "";
  return { text: displayText, hyperlink };
}

async function buildXlsx(xlsxPath, data, groups, meta, subdir) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "andoverct.info report build";
  wb.created = new Date();

  const urlFor = makeContractUrlBuilder(meta, subdir);

  // Map every district key to its group (so Sheet 1 rows can find the joint
  // contract's slug + canonical filename).
  const byDistrict = new Map();
  for (const g of groups) {
    for (const e of g.entries) byDistrict.set(e.key, g);
  }

  // Sheet 1 — every district entry, one row per district.
  const s1 = wb.addWorksheet("By district");
  s1.columns = [
    { header: "District", key: "district", width: 28 },
    { header: "Supe", key: "supe", width: 32 },
    { header: "Scope", key: "scope", width: 28 },
    { header: "Vintage (year used)", key: "vintage", width: 16 },
    { header: "Contract start", key: "start", width: 14 },
    { header: "Contract end", key: "end", width: 14 },
    { header: "Supe total FTE", key: "supeFte", width: 14 },
    { header: "This district share FTE", key: "shareFte", width: 18 },
    { header: "Base salary", key: "base", width: 14, style: { numFmt: "$#,##0" } },
    { header: "Annuity / 403(b)", key: "annuity", width: 14, style: { numFmt: "$#,##0" } },
    { header: "Longevity", key: "longevity", width: 12, style: { numFmt: "$#,##0" } },
    { header: "Transport allowance", key: "transport", width: 14, style: { numFmt: "$#,##0" } },
    { header: "Professional dues", key: "proDues", width: 14, style: { numFmt: "$#,##0" } },
    { header: "Other lump sums", key: "other", width: 14, style: { numFmt: "$#,##0" } },
    { header: "Total cash", key: "totalCash", width: 14, style: { numFmt: "$#,##0" } },
    { header: "FTE-equiv total cash", key: "fteEquiv", width: 16, style: { numFmt: "$#,##0" } },
    { header: "Data status", key: "dataStatus", width: 12 },
    { header: "Vintage status", key: "vintageStatus", width: 14 },
    { header: "Joint contract", key: "joint", width: 14 },
    { header: "Contract", key: "contract", width: 48 },
  ];
  s1.getRow(1).font = { bold: true };
  s1.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F2E8" } };

  for (const [key, d] of Object.entries(data.districts || {})) {
    if (!d.supe_full_cash_comp) continue;
    const comp = d.supe_full_cash_comp || {};
    const term = d.contract_term || {};
    const g = byDistrict.get(key);
    const linkText = g ? `${g.slug}/${g.sourceFilename}` : "";
    const linkHref = g ? urlFor(g.slug, g.sourceFilename) : "";
    s1.addRow({
      district: key,
      supe: d.supe_name || "",
      scope: d.scope || "",
      vintage: d.comp_year_used || "",
      start: term.start || "",
      end: term.end || "",
      supeFte: d.supe_total_work_fte ?? "",
      shareFte: d.this_district_share_fte ?? "",
      base: comp.base_salary ?? null,
      annuity: comp.annuity ?? null,
      longevity: comp.longevity ?? null,
      transport: comp.transportation_allowance ?? null,
      proDues: comp.professional_dues_paid ?? null,
      other: comp.other_lumpsum ?? null,
      totalCash: comp._total_known_cash ?? null,
      fteEquiv: d.fte_equivalent_total_cash ?? null,
      dataStatus: d.data_status || "",
      vintageStatus: classifyVintage(d.comp_year_used),
      joint: d.joint_contract ? "yes" : "no",
      contract: linkCell(linkText, linkHref),
    });
  }
  s1.views = [{ state: "frozen", ySplit: 1 }];
  s1.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s1.columnCount } };

  // Sheet 2 — one row per unique contract (joint contracts dedup'd), with the
  // same component-level cash breakdown as Sheet 1 so a reader can compare
  // contracts head-to-head without duplicating member-town rows.
  const s2 = wb.addWorksheet("By contract");
  s2.columns = [
    { header: "Slug", key: "slug", width: 22 },
    { header: "Supe", key: "supe", width: 32 },
    { header: "Scope", key: "scope", width: 28 },
    { header: "Districts (joint)", key: "districts", width: 50 },
    { header: "Term start", key: "start", width: 14 },
    { header: "Term end", key: "end", width: 14 },
    { header: "Vintage used", key: "vintage", width: 14 },
    { header: "Vintage status", key: "vintageStatus", width: 14 },
    { header: "Base salary", key: "base", width: 14, style: { numFmt: "$#,##0" } },
    { header: "Annuity / 403(b)", key: "annuity", width: 14, style: { numFmt: "$#,##0" } },
    { header: "Longevity", key: "longevity", width: 12, style: { numFmt: "$#,##0" } },
    { header: "Transport allowance", key: "transport", width: 14, style: { numFmt: "$#,##0" } },
    { header: "Professional dues", key: "proDues", width: 14, style: { numFmt: "$#,##0" } },
    { header: "Other lump sums", key: "other", width: 14, style: { numFmt: "$#,##0" } },
    { header: "Total cash", key: "totalCash", width: 14, style: { numFmt: "$#,##0" } },
    { header: "FTE-equiv total cash", key: "fteEquiv", width: 16, style: { numFmt: "$#,##0" } },
    { header: "Contract", key: "contract", width: 48 },
  ];
  s2.getRow(1).font = { bold: true };
  s2.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F2E8" } };

  for (const g of groups) {
    // Read the contract-level cash components from the first member district
    // (joint contracts share these — supe_full_cash_comp is the same).
    const d = g.entries[0]?.district || {};
    const comp = d.supe_full_cash_comp || {};
    s2.addRow({
      slug: g.slug,
      supe: g.supe || "",
      scope: g.scope || "",
      districts: g.entries.map((e) => e.key).join("; "),
      start: g.term?.start || "",
      end: g.term?.end || "",
      vintage: g.vintage || "",
      vintageStatus: g.status,
      base: comp.base_salary ?? null,
      annuity: comp.annuity ?? null,
      longevity: comp.longevity ?? null,
      transport: comp.transportation_allowance ?? null,
      proDues: comp.professional_dues_paid ?? null,
      other: comp.other_lumpsum ?? null,
      totalCash: comp._total_known_cash ?? null,
      fteEquiv: g.fteEquiv ?? null,
      contract: linkCell(`${g.slug}/${g.sourceFilename}`, urlFor(g.slug, g.sourceFilename)),
    });
  }
  s2.views = [{ state: "frozen", ySplit: 1 }];
  s2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s2.columnCount } };

  await wb.xlsx.writeFile(xlsxPath);
}

// ----------------------------------------------------------------------------
// Public entry point
// ----------------------------------------------------------------------------

export async function buildContractsBundle(folder, meta, themeCss, baseCss, breadcrumb) {
  const cfg = meta.contracts;
  if (!cfg) return;
  if (!cfg.source) throw new Error("contracts.source is required");
  if (!cfg.pdfsBase) throw new Error("contracts.pdfsBase is required");

  const sourcePath = resolve(folder, cfg.source);
  const pdfsBase = resolve(folder, cfg.pdfsBase);

  if (!existsSync(sourcePath)) {
    throw new Error(`contracts.source not found: ${sourcePath}`);
  }

  const data = JSON.parse(readFileSync(sourcePath, "utf8"));
  const groups = collectGroups(data, pdfsBase);
  if (!groups.length) {
    console.log("contracts: no PDFs found under pdfsBase; skipping");
    return;
  }

  const subdir = cfg.subdir || "contracts";
  const contractsDir = join(folder, subdir);
  mkdirSync(contractsDir, { recursive: true });

  copyPdfs(groups, contractsDir);

  const indexHtml = buildIndexHtml(groups, meta, themeCss, baseCss, breadcrumb);
  writeFileSync(join(contractsDir, "index.html"), indexHtml);

  const manifestRows = groups.map((g) => [
    `${g.slug}/${g.sourceFilename}`,
    g.supe || "",
    g.entries.map((e) => e.key).join("; "),
    g.scope || "",
    fmtTerm(g.term),
    g.vintage || "",
    g.fteEquiv ?? "",
    g.status,
  ]);

  const zipName = cfg.zip || "contracts.zip";
  await buildZip(join(folder, zipName), groups, contractsDir, manifestRows);

  const xlsxName = cfg.xlsx || "contracts.xlsx";
  await buildXlsx(join(folder, xlsxName), data, groups, meta, subdir);

  console.log(`wrote ${subdir}/ (${groups.length} contracts) + ${zipName} + ${xlsxName}`);
}
