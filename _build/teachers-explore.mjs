#!/usr/bin/env node
/*
 * Exploratory charts for the teacher-workforce question (plan 010, stage 3):
 *
 *   npm run explore:teachers      → data/csde/teachers/explore.html (gitignored)
 *
 * Reads the collapsed teacher-year records through loadTeacherYears() and the
 * district-year table, and renders one local HTML page of inline SVG charts:
 *
 *   1. Small-multiple histograms of experience (capped at 13) per year, for the
 *      town districts as a whole and for Glastonbury.
 *   2. Andover as a four-bin stack per year with its median beside it (small
 *      cells, so bins rather than a histogram).
 *   3. The aging counterfactual: each 2014 roster aged ten years with no
 *      entries or exits, against the actual 2024 roster. This is the direct
 *      test of the "in ten years they will all be at the top step" model.
 *   4. The 45 elementary-only peer districts' share of teachers at 13 or more
 *      years, Andover highlighted, with the peer median.
 *   5. The churn mechanism in the town districts: annual exit rate by years of
 *      experience, experience of entrants, and ten-year survival of the 2015
 *      roster by starting experience.
 *
 * Nothing here publishes. The page is for looking at the shapes before any
 * report is drafted; what survives moves into the report's dataset and the
 * directive renderers. Colors are the bluegold navy ramp and gold accent,
 * validated with the dataviz skill's checker against the cream surface.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadTeacherYears } from "./teachers.mjs"
import { parseCsv, isTownDistrict } from "./edsight-client.mjs"

const ROOT = join(import.meta.dirname, "..")
const DIR = join(ROOT, "data/csde/teachers")
const OUT = join(DIR, "explore.html")
const PEERS_CSV = join(ROOT, "reports/aes/peer-spending/peer_comparison_2024-25.csv")

const CENSOR = 13
const ANDOVER = "0010011"
const GLASTONBURY = "0540011"
const BINS = [
  { key: "1to3", label: "1–3", min: 0, max: 3 },
  { key: "4to7", label: "4–7", min: 4, max: 7 },
  { key: "8to12", label: "8–12", min: 8, max: 12 },
  { key: "13plus", label: "13+", min: 13, max: Infinity },
]
const binIndex = (exp) => BINS.findIndex((b) => exp >= b.min && exp <= b.max)

// Validated 2026-10-24 with dataviz/scripts/validate_palette.js on #FBF8F1:
// ordinal ramp passes all four checks; gold vs navy ΔE 30 under CVD.
const C = {
  surface: "#FBF8F1", ink: "#2b2b2b", sub: "#6a6453", grid: "#E3DDCE", axis: "#5a5446",
  ramp: ["#9db3cf", "#6687ad", "#3a5a84", "#13305a"],
  bar: "#3a5a84", accent: "#9a6f08", navy: "#13305a", dim: "#c7c1b2", predicted: "#9db3cf",
}

// ------------------------------------------------------------------ data

const { teacherYears } = loadTeacherYears()
const districtYears = JSON.parse(readFileSync(join(DIR, "district-years.json"), "utf8")).records
const foys = [...new Set(teacherYears.map((t) => t.foy))].sort()
const FIRST = foys[0]
const LAST = foys[foys.length - 1]

const peerNames = parseCsv(readFileSync(PEERS_CSV, "utf8"))
  .slice(1)
  .map((r) => r[0]?.trim())
  .filter((n) => n && n !== "Norwich") // Scott's standing exclusion: urban, 86% high-needs
const nameToCode = new Map(districtYears.map((r) => [r.district, r.districtCode]))
const peerCodes = peerNames.map((n) => nameToCode.get(`${n} School District`)).filter(Boolean)
const unmatchedPeers = peerNames.filter((n) => !nameToCode.has(`${n} School District`))
if (unmatchedPeers.length) console.warn("peers not found in the panel:", unmatchedPeers.join(", "))
const peerSet = new Set(peerCodes)

const towns = teacherYears.filter((t) => isTownDistrict(t.entityType))
const inDistrict = (code) => teacherYears.filter((t) => t.districtCode === code)
const inPeers = teacherYears.filter((t) => peerSet.has(t.districtCode))

// Experience counts the current year, so values run 1..13 (13 = 13 or more);
// histograms are indexed 1..CENSOR and the 0 slot is never used.
const hist = (tys) => {
  const h = Array.from({ length: CENSOR + 1 }, () => 0)
  tys.forEach((t) => { h[t.expCapped] += 1 })
  return h.slice(1)
}
const expLabel = (k) => (k === CENSOR ? "13+" : String(k))
const LEVELS = Array.from({ length: CENSOR }, (_, i) => i + 1)
const binCounts = (exps) => {
  const b = [0, 0, 0, 0]
  exps.forEach((e) => { b[binIndex(e)] += 1 })
  return b
}
const shares = (counts) => {
  const n = counts.reduce((a, c) => a + c, 0)
  return counts.map((c) => (n ? c / n : 0))
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null
}
const pct = (x, d = 0) => `${(100 * x).toFixed(d)}%`
const fmt = (n) => n.toLocaleString("en-US")

// ------------------------------------------------------------------ svg

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")
const el = (tag, attrs, inner = "") =>
  `<${tag}${Object.entries(attrs).map(([k, v]) => (v == null ? "" : ` ${k}="${esc(v)}"`)).join("")}>${inner}</${tag}>`
const text = (x, y, s, attrs = {}) => el("text", { x, y, fill: C.axis, "font-size": 11, ...attrs }, esc(s))
const r1 = (x) => Math.round(x * 10) / 10

// A column with a 4px rounded cap and a square baseline, per the mark spec.
const column = (x, yTop, w, h, fill, title) => {
  if (h <= 0) return ""
  const r = Math.min(4, h, w / 2)
  const d = `M${r1(x)},${r1(yTop + h)} V${r1(yTop + r)} Q${r1(x)},${r1(yTop)} ${r1(x + r)},${r1(yTop)} H${r1(x + w - r)} Q${r1(x + w)},${r1(yTop)} ${r1(x + w)},${r1(yTop + r)} V${r1(yTop + h)} Z`
  return el("path", { d, fill }, title ? el("title", {}, esc(title)) : "")
}

/*
 * One histogram panel: twelve columns for years 1..12, shares on a fixed y
 * scale so the panels of a small-multiple grid compare directly. The censored
 * 13+ group holds half the teachers and would flatten the rest of the shape,
 * so it is reported as a figure in the panel header instead of a bar.
 */
const histPanel = ({ title, counts, yMax, w = 220, h = 120, highlight }) => {
  const n = counts.reduce((a, c) => a + c, 0)
  const top = counts[CENSOR - 1]
  const bars = counts.slice(0, CENSOR - 1)
  const pad = { l: 8, r: 8, t: 22, b: 18 }
  const pw = w - pad.l - pad.r
  const ph = h - pad.t - pad.b
  const slot = pw / bars.length
  const bw = Math.min(24, slot - 2)
  const cols = bars
    .map((c, i) => {
      const share = n ? c / n : 0
      const bh = (share / yMax) * ph
      const label = expLabel(i + 1)
      return column(pad.l + i * slot + (slot - bw) / 2, pad.t + ph - bh, bw, bh, highlight ? C.accent : C.bar, `${label} years: ${c} teachers (${pct(share, 1)})`)
    })
    .join("")
  const ticks = [0, bars.length - 1].map((i) => text(pad.l + i * slot + slot / 2, h - 5, expLabel(i + 1), { "text-anchor": "middle", "font-size": 10 }))
  const gridY = [0.05, 0.1].filter((v) => v < yMax).map((v) => el("line", { x1: pad.l, x2: w - pad.r, y1: r1(pad.t + ph - (v / yMax) * ph), y2: r1(pad.t + ph - (v / yMax) * ph), stroke: C.grid, "stroke-width": 1 }))
  return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: "img", "aria-label": `${title}: experience distribution` },
    text(pad.l, 14, title, { fill: C.ink, "font-weight": 600 }) +
    text(w - pad.r, 14, `13+: ${pct(n ? top / n : 0)} · n = ${fmt(n)}`, { "text-anchor": "end", fill: C.sub, "font-size": 10 }) +
    gridY.join("") +
    el("line", { x1: pad.l, x2: w - pad.r, y1: r1(pad.t + ph), y2: r1(pad.t + ph), stroke: C.axis, "stroke-width": 1 }) +
    cols + ticks.join(""))
}

const smallMultiples = (byYear, { yMax }) =>
  `<div class="grid">${foys.map((y) => histPanel({ title: `${y}-${String(y + 1).slice(2)}`, counts: byYear.get(y), yMax })).join("")}</div>`

/*
 * Stacked columns, one per year, four ordered bins on the navy ramp, 2px surface
 * gaps between segments. Values are shares so districts of different sizes read
 * alike; the table view carries counts.
 */
const stackChart = ({ series, w = 720, h = 260, labelEvery = 1 }) => {
  const pad = { l: 44, r: 16, t: 16, b: 28 }
  const pw = w - pad.l - pad.r
  const ph = h - pad.t - pad.b
  const slot = pw / series.length
  const bw = Math.min(40, slot - 10)
  const gap = 2
  const cols = series
    .map(({ foy, counts }, i) => {
      const sh = shares(counts)
      const x = pad.l + i * slot + (slot - bw) / 2
      let yCursor = pad.t + ph
      const segs = sh.map((s, b) => {
        const segH = s * ph
        const top = yCursor - segH
        yCursor = top
        const visible = Math.max(0, segH - (b < 3 ? gap : 0))
        return visible > 0
          ? el("rect", { x: r1(x), y: r1(top + (b < 3 ? gap : 0)), width: r1(bw), height: r1(visible), fill: C.ramp[b] },
              el("title", {}, esc(`${foy}-${String(foy + 1).slice(2)} · ${BINS[b].label} years: ${counts[b]} (${pct(s)})`)))
          : ""
      })
      const label = i % labelEvery === 0 ? text(x + bw / 2, h - 8, String(foy), { "text-anchor": "middle" }) : ""
      return segs.join("") + label
    })
    .join("")
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((v) =>
    el("line", { x1: pad.l, x2: w - pad.r, y1: r1(pad.t + ph - v * ph), y2: r1(pad.t + ph - v * ph), stroke: C.grid, "stroke-width": 1 }) +
    text(pad.l - 6, pad.t + ph - v * ph + 4, pct(v), { "text-anchor": "end", "font-size": 10 }))
  return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: "img", "aria-label": "share of teachers by experience bin, by year" }, yTicks.join("") + cols)
}

const legend = (labels, colors) =>
  `<div class="legend">${labels.map((l, i) => `<span><i style="background:${colors[i]}"></i>${esc(l)}</span>`).join("")}</div>`

/*
 * Emphasis line chart: many series in the de-emphasis gray, one in the accent,
 * one reference (the peer median) in navy, direct-labeled at the right edge.
 */
const emphasisLines = ({ lines, accentKey, refKey, w = 720, h = 300, yMax = 1, yFmt = pct }) => {
  const pad = { l: 44, r: 96, t: 16, b: 28 }
  const pw = w - pad.l - pad.r
  const ph = h - pad.t - pad.b
  const x = (foy) => pad.l + ((foy - FIRST) / (LAST - FIRST)) * pw
  const y = (v) => pad.t + ph - (v / yMax) * ph
  const path = (pts) => pts.filter(([, v]) => v != null).map(([f, v], i) => `${i ? "L" : "M"}${r1(x(f))},${r1(y(v))}`).join(" ")
  const ordered = [...lines.filter((l) => l.key !== accentKey && l.key !== refKey), ...lines.filter((l) => l.key === refKey), ...lines.filter((l) => l.key === accentKey)]
  const paths = ordered
    .map((l) => {
      const isAccent = l.key === accentKey
      const isRef = l.key === refKey
      const stroke = isAccent ? C.accent : isRef ? C.navy : C.dim
      const end = l.points.filter(([, v]) => v != null).at(-1)
      const labelled = isAccent || isRef || lines.length <= 4
      const label = labelled && end ? text(x(end[0]) + 8, y(end[1]) + 4, `${l.label} ${yFmt(end[1])}`, { fill: C.ink, "font-size": 11 }) : ""
      return el("path", { d: path(l.points), fill: "none", stroke, "stroke-width": isAccent || isRef ? 2.5 : 1.25, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: isAccent || isRef ? 1 : 0.8 },
        el("title", {}, esc(l.label))) + label
    })
    .join("")
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((v) =>
    el("line", { x1: pad.l, x2: w - pad.r, y1: r1(y(v * yMax)), y2: r1(y(v * yMax)), stroke: C.grid, "stroke-width": 1 }) +
    text(pad.l - 6, y(v * yMax) + 4, yFmt(v * yMax), { "text-anchor": "end", "font-size": 10 }))
  const xTicks = foys.filter((f) => f % 2 === 1).map((f) => text(x(f), h - 8, String(f), { "text-anchor": "middle" }))
  return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: "img" }, yTicks.join("") + paths + xTicks.join(""))
}

const barChart = ({ rows, w = 720, h = 240, yMax, yFmt = pct, color = C.bar }) => {
  const pad = { l: 44, r: 16, t: 16, b: 28 }
  const pw = w - pad.l - pad.r
  const ph = h - pad.t - pad.b
  const slot = pw / rows.length
  const bw = Math.min(24, slot - 6)
  const cols = rows
    .map(({ label, value, title }, i) => {
      const bh = (value / yMax) * ph
      const x = pad.l + i * slot + (slot - bw) / 2
      return column(x, pad.t + ph - bh, bw, bh, color, title) + text(x + bw / 2, h - 8, label, { "text-anchor": "middle", "font-size": 10 })
    })
    .join("")
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((v) =>
    el("line", { x1: pad.l, x2: w - pad.r, y1: r1(pad.t + ph - v * ph), y2: r1(pad.t + ph - v * ph), stroke: C.grid, "stroke-width": 1 }) +
    text(pad.l - 6, pad.t + ph - v * ph + 4, yFmt(v * yMax), { "text-anchor": "end", "font-size": 10 }))
  return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: "img" }, ticks.join("") + cols)
}

const table = (header, rows) =>
  `<details><summary>Table</summary><table><thead><tr>${header.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></details>`

// ------------------------------------------------------------ analyses

// 1. Small multiples
const byYearHist = (tys) => new Map(foys.map((y) => [y, hist(tys.filter((t) => t.foy === y))]))
const townsHist = byYearHist(towns)
const glasHist = byYearHist(inDistrict(GLASTONBURY))
const histTable = (byYear) =>
  table(["FOY", ...LEVELS.map(expLabel)], foys.map((y) => [y, ...byYear.get(y)]))

// 2. Andover stack + median
const andoverRows = districtYears.filter((r) => r.districtCode === ANDOVER)
const andoverSeries = andoverRows.map((r) => ({ foy: r.foy, counts: BINS.map((b) => r[`exp${b.key}`]) }))
const medianLines = (codes) =>
  codes.map(({ code, label }) => ({
    key: code,
    label,
    points: foys.map((y) => [y, districtYears.find((r) => r.districtCode === code && r.foy === y)?.medianExp ?? null]),
  }))

// 3. Aging counterfactual
const counterfactual = (label, tys) => {
  const roster = tys.filter((t) => t.foy === FIRST)
  const aged = roster.map((t) => Math.min(t.experience + 10, CENSOR))
  const actual = tys.filter((t) => t.foy === FIRST + 10)
  const ids = new Set(actual.map((t) => t.teacherId))
  const stillThere = roster.filter((t) => ids.has(t.teacherId)).length
  return {
    label,
    n2014: roster.length,
    n2024: actual.length,
    predicted: binCounts(aged),
    actual: binCounts(actual.map((t) => t.expCapped)),
    stillThere,
    stillShare: roster.length ? stillThere / roster.length : null,
  }
}
const cfRows = [
  counterfactual("Town districts (local + regional)", towns),
  counterfactual("45 elementary-only peers", inPeers),
  counterfactual("Glastonbury", inDistrict(GLASTONBURY)),
  counterfactual("Andover", inDistrict(ANDOVER)),
]

const cfChart = (rows) => {
  const w = 720
  const h = 60 + rows.length * 72
  const pad = { l: 230, r: 60, t: 24 }
  const pw = w - pad.l - pad.r
  const barH = 20
  const gap = 2
  const stack = (counts, y, title) => {
    const sh = shares(counts)
    let xCursor = pad.l
    return sh
      .map((s, b) => {
        const segW = s * pw
        const x = xCursor
        xCursor += segW
        const visible = Math.max(0, segW - (b < 3 ? gap : 0))
        return visible > 0 ? el("rect", { x: r1(x), y, width: r1(visible), height: barH, fill: C.ramp[b] }, el("title", {}, esc(`${title} · ${BINS[b].label}: ${counts[b]} (${pct(s)})`))) : ""
      })
      .join("")
  }
  const body = rows
    .map((row, i) => {
      const y0 = pad.t + i * 72
      const pShare = shares(row.predicted)[3]
      const aShare = shares(row.actual)[3]
      return (
        text(pad.l - 10, y0 + 14, row.label, { "text-anchor": "end", fill: C.ink, "font-weight": 600 }) +
        text(pad.l - 10, y0 + 36, `if no one had left since ${FIRST} (n = ${fmt(row.n2014)})`, { "text-anchor": "end", "font-size": 10 }) +
        stack(row.predicted, y0 + 24, "Aged 2014 roster") +
        text(w - pad.r + 6, y0 + 38, pct(pShare), { fill: C.ink }) +
        text(pad.l - 10, y0 + 60, `actual ${FIRST + 10} (n = ${fmt(row.n2024)})`, { "text-anchor": "end", "font-size": 10 }) +
        stack(row.actual, y0 + 48, `Actual ${FIRST + 10}`) +
        text(w - pad.r + 6, y0 + 62, pct(aShare), { fill: C.ink })
      )
    })
    .join("")
  return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: "img" },
    text(pad.l, 12, "share of teachers by experience bin", { "font-size": 10 }) + text(w - pad.r + 6, 12, "13+", { "font-size": 10 }) + body)
}

// 4. Peers
const share13 = (code, y) => districtYears.find((r) => r.districtCode === code && r.foy === y)?.share13plus ?? null
const peerLines = peerCodes.map((code) => ({
  key: code,
  label: districtYears.find((r) => r.districtCode === code)?.district.replace(" School District", "") ?? code,
  points: foys.map((y) => [y, share13(code, y)]),
}))
const peerMedianLine = {
  key: "peer-median",
  label: "Peer median",
  points: foys.map((y) => [y, median(peerCodes.map((c) => share13(c, y)).filter((v) => v != null))]),
}
const townsLine = { key: "towns", label: "All town districts", points: foys.map((y) => [y, districtYears.find((r) => r.districtCode === "towns" && r.foy === y)?.share13plus ?? null]) }

// Peer-level drift: change in 13+ share, first full year (2015) to last.
const peerDrift = peerCodes
  .map((code) => ({ code, label: peerLines.find((l) => l.key === code).label, from: share13(code, FIRST + 1), to: share13(code, LAST) }))
  .filter((d) => d.from != null && d.to != null)
  .map((d) => ({ ...d, change: d.to - d.from }))
  .sort((a, b) => a.change - b.change)

// 5. Churn, town districts, pooled over 2015..2024 (2014 is short; 2025 has no "next")
const pooled = towns.filter((t) => t.foy > FIRST && t.foy < LAST)
const exitByExp = LEVELS.map((k) => {
  const at = pooled.filter((t) => t.expCapped === k)
  return {
    k,
    n: at.length,
    leftPanel: at.filter((t) => t.nextDistrict == null).length / (at.length || 1),
    leftDistrict: at.filter((t) => t.nextDistrict !== t.districtCode).length / (at.length || 1),
  }
})
const entrants = towns.filter((t) => t.foy > FIRST && t.prevDistrict == null)
const entrantHist = hist(entrants)
const movers = towns.filter((t) => t.foy > FIRST && t.prevDistrict != null && t.prevDistrict !== t.districtCode)
const moverHist = hist(movers)

// Ten-year survival of the 2015 town roster by starting experience.
const base = towns.filter((t) => t.foy === FIRST + 1)
const ids2025 = new Set(towns.filter((t) => t.foy === LAST).map((t) => t.teacherId))
const sameDistrict2025 = new Map(towns.filter((t) => t.foy === LAST).map((t) => [t.teacherId, t.districtCode]))
const survival = LEVELS.map((k) => {
  const at = base.filter((t) => t.expCapped === k)
  return {
    k,
    n: at.length,
    inPanel: at.filter((t) => ids2025.has(t.teacherId)).length / (at.length || 1),
    inDistrict: at.filter((t) => sameDistrict2025.get(t.teacherId) === t.districtCode).length / (at.length || 1),
  }
})

// ------------------------------------------------------------------ page

// Scale the histogram panels to the tallest 1..12 bar, not the censored 13+ pile.
const yMaxHist = Math.max(...[...townsHist.values(), ...glasHist.values()].flatMap((h) => shares(h).slice(0, CENSOR - 1))) * 1.1

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Teacher experience: exploration</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --surface: ${C.surface}; --ink: ${C.ink}; --sub: ${C.sub}; --grid: ${C.grid}; }
  body { background: var(--surface); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 24px 16px 64px; }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 40px 0 6px; } p { margin: 6px 0 12px; color: var(--sub); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px 12px; }
  svg { display: block; max-width: 100%; height: auto; }
  .legend { display: flex; gap: 16px; font-size: 12px; color: var(--sub); margin: 6px 0; flex-wrap: wrap; }
  .legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 6px; vertical-align: -2px; }
  details { margin: 6px 0 0; font-size: 13px; } summary { cursor: pointer; color: var(--sub); }
  table { border-collapse: collapse; margin-top: 6px; font-variant-numeric: tabular-nums; } th, td { padding: 2px 8px; text-align: right; border-bottom: 1px solid var(--grid); } th:first-child, td:first-child { text-align: left; }
  .note { font-size: 13px; }
</style></head><body><main>
<h1>Teacher experience across Connecticut districts, ${FIRST}–${LAST}</h1>
<p class="note">Exploratory, not for publication. Experience is years in CT public schools since 2002, capped at 13 (the field CSDE supplied caps pre-2014 service there). Head counts, one record per teacher per year. Hover any mark for its value; each chart has a table.</p>

<h2>1. Shape by year: all town districts</h2>
<p>Share of teachers at each year of experience, years 1 through 12. The censored 13+ group (half of all teachers) is the figure in each panel header rather than a bar, so the shape of the first twelve years stays visible.</p>
${smallMultiples(townsHist, { yMax: yMaxHist })}
${histTable(townsHist)}

<h2>Shape by year: Glastonbury</h2>
${smallMultiples(glasHist, { yMax: yMaxHist })}
${histTable(glasHist)}

<h2>2. Andover</h2>
<p>Four bins rather than a histogram: with 21–27 teachers, single-year cells are people.</p>
${legend(BINS.map((b) => `${b.label} years`), C.ramp)}
${stackChart({ series: andoverSeries })}
${table(["FOY", "Teachers", ...BINS.map((b) => b.label), "Median"], andoverRows.map((r) => [r.foy, r.teachers, ...BINS.map((b) => r[`exp${b.key}`]), r.medianExp]))}
<p>Median years of experience, Andover against Glastonbury and all town districts.</p>
${emphasisLines({ lines: [...medianLines([{ code: ANDOVER, label: "Andover" }, { code: GLASTONBURY, label: "Glastonbury" }]), { key: "towns", label: "Town districts", points: foys.map((y) => [y, districtYears.find((r) => r.districtCode === "towns" && r.foy === y)?.medianExp ?? null]) }], accentKey: ANDOVER, refKey: "towns", yMax: 20, yFmt: (v) => `${v} yrs`, h: 240 })}

<h2>3. The ten-year test</h2>
<p>Take every teacher on the ${FIRST} roster, add ten years, and let nobody leave or arrive. That is the model behind "in ten years they will all be at the top step." Compare with who was actually teaching in ${FIRST + 10}.</p>
${legend(BINS.map((b) => `${b.label} years`), C.ramp)}
${cfChart(cfRows)}
${table(["Group", `${FIRST} roster`, "Predicted 13+ share", `Actual ${FIRST + 10} teachers`, "Actual 13+ share", `Of the ${FIRST} roster still there in ${FIRST + 10}`],
  cfRows.map((r) => [r.label, fmt(r.n2014), pct(shares(r.predicted)[3]), fmt(r.n2024), pct(shares(r.actual)[3]), `${fmt(r.stillThere)} (${pct(r.stillShare)})`]))}

<h2>4. Andover among its 45 peers</h2>
<p>Share of teachers at 13 or more years, every elementary-only peer district in gray, Andover in gold, the peer median in navy.</p>
${emphasisLines({ lines: [...peerLines, peerMedianLine, townsLine], accentKey: ANDOVER, refKey: "peer-median" })}
${table(["District", `13+ share ${FIRST + 1}`, `13+ share ${LAST}`, "Change"], peerDrift.map((d) => [d.label, pct(d.from), pct(d.to), `${d.change >= 0 ? "+" : ""}${(100 * d.change).toFixed(0)} pts`]))}

<h2>5. The mechanism: who leaves, who arrives</h2>
<p>Town districts, pooled over ${FIRST + 1}–${LAST - 1}. Annual share of teachers at each experience level who are not in any CT public school the next fall (left the panel) or not in the same district (left the district, including moves).</p>
${legend(["Left the district (incl. moves)", "Left CT public schools"], [C.ramp[0], C.bar])}
${el("svg", { viewBox: "0 0 720 240", width: 720, height: 240, role: "img" }, (() => {
  const pad = { l: 44, r: 16, t: 16, b: 28 }
  const pw = 720 - pad.l - pad.r
  const ph = 240 - pad.t - pad.b
  const yMax = 0.3
  const slot = pw / exitByExp.length
  const bw = Math.min(24, slot - 8)
  return [0, 0.1, 0.2, 0.3].map((v) => el("line", { x1: pad.l, x2: 720 - pad.r, y1: r1(pad.t + ph - (v / yMax) * ph), y2: r1(pad.t + ph - (v / yMax) * ph), stroke: C.grid }) + text(pad.l - 6, pad.t + ph - (v / yMax) * ph + 4, pct(v), { "text-anchor": "end", "font-size": 10 })).join("") +
    exitByExp.map((e, i) => {
      const x = pad.l + i * slot + (slot - bw) / 2
      const hD = (e.leftDistrict / yMax) * ph
      const hP = (e.leftPanel / yMax) * ph
      return column(x, pad.t + ph - hD, bw, hD, C.ramp[0], `${expLabel(e.k)} years: ${pct(e.leftDistrict, 1)} left the district (n = ${fmt(e.n)})`) +
        column(x, pad.t + ph - hP, bw, hP, C.bar, `${expLabel(e.k)} years: ${pct(e.leftPanel, 1)} left CT public schools (n = ${fmt(e.n)})`) +
        text(x + bw / 2, 232, expLabel(e.k), { "text-anchor": "middle", "font-size": 10 })
    }).join("")
})())}
${table(["Years", "Teacher-years", "Left district", "Left CT public"], exitByExp.map((e) => [expLabel(e.k), fmt(e.n), pct(e.leftDistrict, 1), pct(e.leftPanel, 1)]))}

<p>Experience of teachers new to CT public schools in a given fall (${fmt(entrants.length)} entrants), and of teachers who moved in from another CT district (${fmt(movers.length)} movers).</p>
${legend(["New to CT public schools", "Moved from another district"], [C.bar, C.ramp[0]])}
<div class="grid" style="grid-template-columns: 1fr 1fr">
${barChart({ rows: entrantHist.map((c, i) => ({ label: expLabel(i + 1), value: c / entrants.length, title: `${expLabel(i + 1)} years: ${fmt(c)} entrants` })), w: 360, h: 200, yMax: 0.8 })}
${barChart({ rows: moverHist.map((c, i) => ({ label: expLabel(i + 1), value: c / movers.length, title: `${expLabel(i + 1)} years: ${fmt(c)} movers` })), w: 360, h: 200, yMax: 0.8, color: C.ramp[0] })}
</div>

<p>Of the teachers in town districts in ${FIRST + 1}, the share still teaching in CT public schools in ${LAST}, and still in the same district, by their experience in ${FIRST + 1}.</p>
${legend([`Still in CT public schools ${LAST}`, "Still in the same district"], [C.ramp[0], C.bar])}
${el("svg", { viewBox: "0 0 720 240", width: 720, height: 240, role: "img" }, (() => {
  const pad = { l: 44, r: 16, t: 16, b: 28 }
  const pw = 720 - pad.l - pad.r
  const ph = 240 - pad.t - pad.b
  const slot = pw / survival.length
  const bw = Math.min(24, slot - 8)
  return [0, 0.25, 0.5, 0.75, 1].map((v) => el("line", { x1: pad.l, x2: 720 - pad.r, y1: r1(pad.t + ph - v * ph), y2: r1(pad.t + ph - v * ph), stroke: C.grid }) + text(pad.l - 6, pad.t + ph - v * ph + 4, pct(v), { "text-anchor": "end", "font-size": 10 })).join("") +
    survival.map((s, i) => {
      const x = pad.l + i * slot + (slot - bw) / 2
      return column(x, pad.t + ph - s.inPanel * ph, bw, s.inPanel * ph, C.ramp[0], `${expLabel(s.k)} years in ${FIRST + 1}: ${pct(s.inPanel)} still in CT public schools (n = ${fmt(s.n)})`) +
        column(x, pad.t + ph - s.inDistrict * ph, bw, s.inDistrict * ph, C.bar, `${expLabel(s.k)} years in ${FIRST + 1}: ${pct(s.inDistrict)} still in the same district`) +
        text(x + bw / 2, 232, expLabel(s.k), { "text-anchor": "middle", "font-size": 10 })
    }).join("")
})())}
${table([`Years in ${FIRST + 1}`, "Teachers", `In CT public ${LAST}`, "Same district"], survival.map((s) => [expLabel(s.k), fmt(s.n), pct(s.inPanel), pct(s.inDistrict)]))}
</main></body></html>
`

writeFileSync(OUT, html)

// Console digest of the numbers the plan wants to carry forward.
console.log(`peers matched: ${peerCodes.length} of ${peerNames.length}`)
cfRows.forEach((r) =>
  console.log(`${r.label}: ${FIRST} n=${r.n2014}, predicted 13+ ${pct(shares(r.predicted)[3])}, actual ${FIRST + 10} 13+ ${pct(shares(r.actual)[3])} (n=${r.n2024}), still there ${r.stillThere} (${pct(r.stillShare)})`))
console.log(`peer 13+ share ${FIRST + 1} → ${LAST}: median change ${(100 * median(peerDrift.map((d) => d.change))).toFixed(1)} pts; range ${(100 * peerDrift[0].change).toFixed(0)} to ${(100 * peerDrift.at(-1).change).toFixed(0)}`)
console.log(`exit rates (left CT) by experience: ${exitByExp.map((e) => `${expLabel(e.k)}:${pct(e.leftPanel, 1)}`).join(" ")}`)
console.log(`10-yr survival in CT by 2015 experience: ${survival.map((s) => `${expLabel(s.k)}:${pct(s.inPanel)}`).join(" ")}`)
console.log(`wrote ${OUT}`)
