// Scatter-plot builder for the superintendent-pay report. Reads
// compensation.json and enrollment.json, emits scatter.svg alongside
// the report's other artifacts.
//
// Front-matter directive on the report:
//   scatter:
//     source: ../../../../ct-super-scraper/compensation.json
//     enrollment: ../../../../ct-super-scraper/enrollment.json
//     out: scatter.svg
//
// Encoding:
//   x  student enrollment under supervision (joint K-12 = sum of member
//                                            towns' K-8 + regional HS)
//   y  FTE-equivalent total cash
//   shape  scope: circle=K-6/K-8, square=K-12 joint regional, triangle=HS-only
//   fill   Andover highlighted gold; peers slate; reference contracts open
//   ---
// The plot is generated once per build; changes require an npm run report.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// -- data selection --------------------------------------------------------

function isCurrent(vintage) {
  const m = String(vintage || "").match(/^(\d{4})/);
  if (!m) return false;
  const y = Number(m[1]);
  return y === 2024 || y === 2025 || y === 2026;
}

function classifyScope(scope) {
  const s = String(scope || "").toLowerCase();
  if (s.startsWith("hs-only")) return "hs";
  if (s.startsWith("k-12")) return "k12";
  return "k68"; // K-6, K-8, or default elementary
}

function dedupePoints(comp, enrol) {
  const enrolDistricts = enrol.districts || {};
  const hsSupp = enrolDistricts._hs_supplements || {};

  const groups = new Map();
  for (const [key, d] of Object.entries(comp.districts || {})) {
    if (!isCurrent(d.comp_year_used)) continue;
    if (!d.fte_equivalent_total_cash) continue;
    if (key === "Andover_FY27_proposed") continue;
    // Reference-only contracts are excluded from the ranking tables because
    // their FTE-equivalent figure is unreliable (e.g. Chaplin/Region 11, whose
    // FTE denominator is entangled with Skarzynski's separate Hampton contract).
    // Keep them off the scatter too, so a misleading pay point isn't plotted.
    if (d.ranked === false) continue;
    const term = d.contract_term || {};
    const gk = [d.supe_name || "", term.start || "", term.end || ""].join("|");
    let g = groups.get(gk);
    if (!g) {
      g = {
        supe: d.supe_name,
        scope: d.scope,
        scopeClass: classifyScope(d.scope),
        pay: d.fte_equivalent_total_cash,
        districts: [],
        joint: d.joint_contract,
      };
      groups.set(gk, g);
    }
    g.districts.push(key);
  }

  const points = [];
  for (const g of groups.values()) {
    let students = 0;
    let approxCount = 0;
    for (const dk of g.districts) {
      const rec = enrolDistricts[dk];
      if (rec && typeof rec.students === "number") {
        students += rec.students;
        if (rec.source && rec.source.startsWith("approx")) approxCount++;
      }
    }
    // Add regional HS supplement for joint K-12 (Region N pattern in scope).
    const rm = String(g.scope || "").match(/\(Region\s+(\d+)\)/i);
    if (rm) {
      const regionKey = `Region ${rm[1]} ${rm[1] === "1" ? "HVRHS"
        : rm[1] === "4" ? "HS"
        : rm[1] === "7" ? "HS"
        : rm[1] === "9" ? "Joel Barlow"
        : rm[1] === "11" ? "Parish Hill" : "HS"}`;
      if (hsSupp[regionKey]) students += hsSupp[regionKey];
    }
    // HS-only reference: use the HS enrollment for the whole point.
    if (g.scopeClass === "hs") {
      const m2 = String(g.scope || "").match(/Region\s+(\d+)/i);
      const key = g.districts[0]; // e.g. "Amity Region 5" or "Region 7"
      if (hsSupp[key]) students = hsSupp[key];
      else if (m2 && hsSupp[`Region ${m2[1]} HS`]) students = hsSupp[`Region ${m2[1]} HS`];
    }
    if (!students) continue;
    points.push({
      ...g,
      students,
      label: g.districts.join(" / "),
      approx: approxCount > 0,
      isAndover: g.districts.length === 1 && g.districts[0] === "Andover",
    });
  }
  return points;
}

// -- SVG rendering ---------------------------------------------------------

const W = 900, H = 560;
const M = { top: 30, right: 30, bottom: 70, left: 90 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;

function niceMax(v, step) {
  return Math.ceil(v / step) * step;
}

function fmt$(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function pearsonFit(pts) {
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((a, p) => a + p.students, 0) / n;
  const my = pts.reduce((a, p) => a + p.pay, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pts) {
    const dx = p.students - mx, dy = p.pay - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r = sxy / Math.sqrt(sxx * syy);
  return { slope, intercept, r, n };
}

function svgFor(points) {
  const maxStudents = niceMax(Math.max(...points.map(p => p.students), 0), 500);
  const maxPay = niceMax(Math.max(...points.map(p => p.pay), 0), 50000);
  const xScale = (v) => (v / maxStudents) * PW;
  const yScale = (v) => PH - (v / maxPay) * PH;

  // Fit a K-6/K-8-only linear regression so the plot's own trend line reflects
  // the cohort Andover actually competes in — not the full-cohort slope that
  // gets pulled up by the K-12 regional joint contracts.
  const k68Points = points.filter(p => p.scopeClass === "k68");
  const fit = pearsonFit(k68Points);

  // Axis ticks
  const xTicks = [];
  for (let v = 0; v <= maxStudents; v += 500) xTicks.push(v);
  const yTicks = [];
  for (let v = 0; v <= maxPay; v += 50000) yTicks.push(v);

  // Marker shape per scope + fill/stroke per role
  function marker(p, cx, cy) {
    const andover = p.isAndover;
    const fill = andover ? "#c8a85a" : "#3d5a80";
    const stroke = andover ? "#8b6e2e" : "#293b56";
    const r = andover ? 8 : 5;
    if (p.scopeClass === "k68") {
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
    }
    if (p.scopeClass === "k12") {
      return `<rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${r * 2}" height="${r * 2}" fill="${fill}" fill-opacity="0.75" stroke="${stroke}" stroke-width="1.2"/>`;
    }
    // HS-only triangle
    const h = r * 1.2;
    return `<polygon points="${cx.toFixed(1)},${(cy - h).toFixed(1)} ${(cx - h).toFixed(1)},${(cy + h * 0.7).toFixed(1)} ${(cx + h).toFixed(1)},${(cy + h * 0.7).toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="1.6"/>`;
  }

  const gridX = xTicks.map(v => {
    const x = xScale(v);
    return `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${PH}" stroke="#e5e0d0" stroke-width="1"/>`;
  }).join("\n    ");
  const gridY = yTicks.map(v => {
    const y = yScale(v);
    return `<line x1="0" y1="${y.toFixed(1)}" x2="${PW}" y2="${y.toFixed(1)}" stroke="#e5e0d0" stroke-width="1"/>`;
  }).join("\n    ");

  const xLabels = xTicks.map(v => {
    const x = xScale(v);
    return `<text x="${x.toFixed(1)}" y="${(PH + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="#555">${v.toLocaleString()}</text>`;
  }).join("\n    ");
  const yLabels = yTicks.map(v => {
    const y = yScale(v);
    return `<text x="-8" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="11" fill="#555">${fmt$(v)}</text>`;
  }).join("\n    ");

  const markers = points.map(p => {
    const cx = xScale(p.students);
    const cy = yScale(p.pay);
    return `<g><title>${escapeSvg(p.label)} — ${escapeSvg(p.supe || "")} — ${escapeSvg(p.scope || "")}\nEnrollment: ${p.students.toLocaleString()}\nFTE-equiv: ${fmt$(p.pay)}${p.approx ? " (enrollment approx)" : ""}</title>${marker(p, cx, cy)}</g>`;
  }).join("\n    ");

  // K-6/K-8 fit line — drawn only over the x-range of the K-6/K-8 points, so
  // it doesn't visually extend into the regional/K-12 territory it wasn't
  // fitted from.
  let fitLine = "";
  if (fit) {
    const xs = k68Points.map(p => p.students);
    const x1 = Math.min(...xs);
    const x2 = Math.max(...xs);
    const y1 = fit.intercept + fit.slope * x1;
    const y2 = fit.intercept + fit.slope * x2;
    const p1x = xScale(x1), p1y = yScale(y1);
    const p2x = xScale(x2), p2y = yScale(y2);
    const labelText = `K-6/K-8 fit, r = ${fit.r.toFixed(2)}`;
    fitLine = `
    <line x1="${p1x.toFixed(1)}" y1="${p1y.toFixed(1)}" x2="${p2x.toFixed(1)}" y2="${p2y.toFixed(1)}" stroke="#a52a2a" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.75"/>
    <text x="${(p2x + 6).toFixed(1)}" y="${(p2y + 3.5).toFixed(1)}" font-size="11" fill="#a52a2a" font-style="italic">${escapeSvg(labelText)}</text>`;
  }

  // Andover callout (short label beside the point)
  const andoverPoint = points.find(p => p.isAndover);
  const andoverCallout = andoverPoint ? (() => {
    const cx = xScale(andoverPoint.students);
    const cy = yScale(andoverPoint.pay);
    return `<text x="${(cx + 12).toFixed(1)}" y="${(cy + 4).toFixed(1)}" font-size="12" font-weight="700" fill="#8b6e2e">Andover</text>`;
  })() : "";

  // Legend
  const legend = `
    <g transform="translate(${PW - 220}, 10)">
      <rect x="0" y="0" width="220" height="90" fill="#ffffff" fill-opacity="0.9" stroke="#c8a85a" stroke-width="1" rx="3"/>
      <text x="10" y="18" font-size="12" font-weight="700" fill="#333">Scope</text>
      <circle cx="18" cy="36" r="5" fill="#3d5a80" stroke="#293b56"/>
      <text x="30" y="40" font-size="12" fill="#333">K-6 / K-8 solo</text>
      <rect x="13" y="49" width="10" height="10" fill="#3d5a80" fill-opacity="0.75" stroke="#293b56"/>
      <text x="30" y="58" font-size="12" fill="#333">K-12 joint (regional)</text>
      <polygon points="18,66 12,78 24,78" fill="none" stroke="#293b56" stroke-width="1.6"/>
      <text x="30" y="77" font-size="12" fill="#333">HS-only reference</text>
    </g>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" role="img" aria-label="Scatter plot of superintendent FTE-equivalent pay vs student enrollment supervised">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#fafaf7"/>
  <g transform="translate(${M.left}, ${M.top})">
    ${gridX}
    ${gridY}
    <line x1="0" y1="${PH}" x2="${PW}" y2="${PH}" stroke="#333" stroke-width="1.2"/>
    <line x1="0" y1="0" x2="0" y2="${PH}" stroke="#333" stroke-width="1.2"/>
    ${xLabels}
    ${yLabels}
    ${fitLine}
    ${markers}
    ${andoverCallout}
    <text x="${(PW / 2).toFixed(1)}" y="${(PH + 44).toFixed(1)}" text-anchor="middle" font-size="13" fill="#333">Student enrollment supervised (K–12 total)</text>
    <text transform="translate(-60, ${(PH / 2).toFixed(1)}) rotate(-90)" text-anchor="middle" font-size="13" fill="#333">FTE-equivalent total cash</text>
    ${legend}
  </g>
</svg>`;
}

function escapeSvg(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// -- public entry point ----------------------------------------------------

export async function buildScatterPlot(folder, meta) {
  const cfg = meta.scatter;
  if (!cfg) return;
  const compPath = resolve(folder, cfg.source || "");
  const enrolPath = resolve(folder, cfg.enrollment || "");
  const outName = cfg.out || "scatter.svg";
  if (!existsSync(compPath) || !existsSync(enrolPath)) {
    console.log("scatter: missing source or enrollment; skipping");
    return;
  }
  const comp = JSON.parse(readFileSync(compPath, "utf8"));
  const enrol = JSON.parse(readFileSync(enrolPath, "utf8"));
  const points = dedupePoints(comp, enrol);
  if (!points.length) {
    console.log("scatter: no plottable points; skipping");
    return;
  }
  const svg = svgFor(points);
  writeFileSync(resolve(folder, outName), svg, "utf8");
  console.log(`wrote ${outName} (${points.length} points)`);
}
