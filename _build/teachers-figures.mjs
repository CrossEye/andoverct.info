/*
 * Figures and published data for the teacher-experience report
 * (reports/conn/teacher-experience/). Reads the teacher-year table built by
 * teachers.mjs and writes, into the report folder:
 *
 *   fig01-shape-towns.svg        small-multiple histograms, town districts
 *   fig02-shape-glastonbury.svg  the same for Glastonbury (a hiring wave)
 *   fig03-ten-year-test.svg      each 2014 roster aged ten years with no churn,
 *                                against the actual 2024 roster
 *   fig04-exit-by-experience.svg yearly exit rates by year of experience
 *   fig05-entrants-movers.svg    experience of arrivals: new to CT, and movers
 *   fig06-survival.svg           where the 2015 roster was in 2025
 *   fig07-drift-distribution.svg change in the 13+ share across 160 districts
 *   fig08-drift-vs-turnover.svg  that change against annual turnover
 *   fig09-hiring-waves.svg       the 13 hiring-wave districts over time
 *   fig10-andover-stack.svg      Andover's four bins by year
 *   fig11-andover-peers.svg      13+ share, Andover among its 45 peers
 *   teacher-experience-districts.csv / .xlsx
 *                                the town-district aggregate, four bins only
 *
 * Nothing teacher-level is written. Figures are standalone SVG so the report
 * engine embeds them in HTML and WeasyPrint embeds them in the PDF; fonts and
 * the xmlns are set on the root element because an <img> inherits no CSS.
 * Colors come from teachers-charts.mjs (the bluegold ramp, validated against
 * the cream surface). Run: npm run figures:teachers
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import ExcelJS from "exceljs"
import { loadTeacherYears } from "./teachers.mjs"
import { parseCsv, isTownDistrict } from "./edsight-client.mjs"
import { C, esc, el, text, r1, column, emphasisLines, overlayColumns, histogramChart, scatter, pct, fmt, median, mean, shares } from "./teachers-charts.mjs"

const ROOT = join(import.meta.dirname, "..")
const DIR = join(ROOT, "data/csde/teachers")
const OUT = join(ROOT, "reports/conn/teacher-experience")
const PEERS_CSV = join(ROOT, "reports/aes/peer-spending/peer_comparison_2024-25.csv")

const CENSOR = 13
const TOP_STEP = 10 // AEA contract 2025-2029, Appendix B: ten steps, one per year
const ANDOVER = "0010011"
const GLASTONBURY = "0540011"
const MIN_TEACHERS = 10
const WAVE_CUT = 2.2
const BINS = [
  { key: "1to3", label: "1–3", min: 0, max: 3 },
  { key: "4to7", label: "4–7", min: 4, max: 7 },
  { key: "8to12", label: "8–12", min: 8, max: 12 },
  { key: "13plus", label: "13+", min: 13, max: Infinity },
]
const binIndex = (exp) => BINS.findIndex((b) => exp >= b.min && exp <= b.max)
const binCounts = (exps) => exps.reduce((b, e) => { b[binIndex(e)] += 1; return b }, [0, 0, 0, 0])
const FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

// ------------------------------------------------------------------ data

const { teacherYears } = loadTeacherYears()
const districtYears = JSON.parse(readFileSync(join(DIR, "district-years.json"), "utf8")).records
const foys = [...new Set(teacherYears.map((t) => t.foy))].sort()
const FIRST = foys[0]
const START = FIRST + 1
const LAST = foys[foys.length - 1]
const schoolYear = (y) => `${y}-${String(y + 1).slice(2)}`

const peerNames = parseCsv(readFileSync(PEERS_CSV, "utf8")).slice(1).map((r) => r[0]?.trim()).filter((n) => n && n !== "Norwich")
const nameToCode = new Map(districtYears.map((r) => [r.district, r.districtCode]))
const peerCodes = peerNames.map((n) => nameToCode.get(`${n} School District`)).filter(Boolean)
const peerSet = new Set(peerCodes)
const dy = (code, foy) => districtYears.find((r) => r.districtCode === code && r.foy === foy)
const shortName = (code) => (districtYears.find((r) => r.districtCode === code)?.district ?? code).replace(" School District", "")

const towns = teacherYears.filter((t) => isTownDistrict(t.entityType))
const inDistrict = (code) => teacherYears.filter((t) => t.districtCode === code)
const inPeers = teacherYears.filter((t) => peerSet.has(t.districtCode))

const hist = (tys) => {
  const h = Array.from({ length: CENSOR + 1 }, () => 0)
  tys.forEach((t) => { h[t.expCapped] += 1 })
  return h.slice(1)
}
const expLabel = (k) => (k === CENSOR ? "13+" : String(k))
const LEVELS = Array.from({ length: CENSOR }, (_, i) => i + 1)

// ------------------------------------------------------------------- svg

// A standalone file: xmlns and a font on the root, nothing else changed.
const standalone = (svg) => svg.replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" font-family="${FONT}" `)

// A legend drawn inside the SVG (an <img> has no HTML legend beside it),
// top-right, for charts whose helper draws none.
const withLegend = (svg, items, { x = 470, y = 6 } = {}) =>
  svg.replace("</svg>", el("g", { transform: `translate(${x},${y})` },
    items.map(([color, label], i) => el("rect", { x: 0, y: i * 14, width: 10, height: 10, rx: 2, fill: color }) + text(14, i * 14 + 9, label, { "font-size": 10 })).join("")) + "</svg>")

// One histogram panel as a <g> so twelve of them compose into one SVG. Years
// 1..12 as columns on a shared y scale; the censored 13+ group is the figure
// in the header, since as a bar it would flatten the rest of the shape.
const histPanel = ({ title, counts, yMax, x, y, w = 232, h = 118 }) => {
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
      return column(pad.l + i * slot + (slot - bw) / 2, pad.t + ph - bh, bw, bh, C.bar, `${title} · ${expLabel(i + 1)} years: ${fmt(c)} teachers (${pct(share, 1)})`)
    })
    .join("")
  const ticks = [0, bars.length - 1].map((i) => text(pad.l + i * slot + slot / 2, h - 5, expLabel(i + 1), { "text-anchor": "middle", "font-size": 10 }))
  const grid = [0.05, 0.1].filter((v) => v < yMax).map((v) => el("line", { x1: pad.l, x2: w - pad.r, y1: r1(pad.t + ph - (v / yMax) * ph), y2: r1(pad.t + ph - (v / yMax) * ph), stroke: C.grid, "stroke-width": 1 }))
  return el("g", { transform: `translate(${x},${y})` },
    text(pad.l, 14, title, { fill: C.ink, "font-weight": 600 }) +
    text(w - pad.r, 14, `13+: ${pct(n ? top / n : 0)} · n = ${fmt(n)}`, { "text-anchor": "end", fill: C.sub, "font-size": 10 }) +
    grid.join("") +
    el("line", { x1: pad.l, x2: w - pad.r, y1: r1(pad.t + ph), y2: r1(pad.t + ph), stroke: C.axis, "stroke-width": 1 }) +
    cols + ticks.join(""))
}

const smallMultiples = ({ byYear, yMax, label }) => {
  const cols = 3
  const pw = 232
  const ph = 118
  const gap = { x: 12, y: 10 }
  const years = foys.filter((y) => y >= START)
  const rows = Math.ceil(years.length / cols)
  const w = cols * pw + (cols - 1) * gap.x
  const h = rows * ph + (rows - 1) * gap.y + 16
  const panels = years.map((y, i) => histPanel({ title: schoolYear(y), counts: byYear.get(y), yMax, x: (i % cols) * (pw + gap.x), y: Math.floor(i / cols) * (ph + gap.y) }))
  return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: "img", "aria-label": label },
    panels.join("") + text(0, h - 2, "share of teachers at each year of experience, years 1 to 12; the 13+ share is the figure in each header", { "font-size": 10, fill: C.sub }))
}

// Paired stacked bars: the aged roster against the actual roster, per group.
const cfChart = (rows) => {
  const w = 720
  const h = 60 + rows.length * 72
  const pad = { l: 230, r: 96, t: 24 }
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
        return visible > 0 ? el("rect", { x: r1(x), y, width: r1(visible), height: barH, fill: C.ramp[b] }, el("title", {}, esc(`${title} · ${BINS[b].label} years: ${fmt(counts[b])} (${pct(s)})`))) : ""
      })
      .join("")
  }
  const body = rows
    .map((row, i) => {
      const y0 = pad.t + i * 72
      return (
        text(pad.l - 10, y0 + 14, row.label, { "text-anchor": "end", fill: C.ink, "font-weight": 600 }) +
        text(pad.l - 10, y0 + 36, `if no one had left since ${FIRST} (n = ${fmt(row.n2014)})`, { "text-anchor": "end", "font-size": 10 }) +
        stack(row.predicted, y0 + 24, `Aged ${FIRST} roster`) +
        text(w - pad.r + 6, y0 + 38, `${pct(row.predictedTop, 0)} · ${pct(shares(row.predicted)[3])}`, { fill: C.ink }) +
        text(pad.l - 10, y0 + 60, `actual ${FIRST + 10} (n = ${fmt(row.n2024)})`, { "text-anchor": "end", "font-size": 10 }) +
        stack(row.actual, y0 + 48, `Actual ${FIRST + 10}`) +
        text(w - pad.r + 6, y0 + 62, `${pct(row.actualTop, 0)} · ${pct(shares(row.actual)[3])}`, { fill: C.ink })
      )
    })
    .join("")
  const legend = BINS.map((b, i) => el("rect", { x: pad.l + i * 90, y: 4, width: 10, height: 10, rx: 2, fill: C.ramp[i] }) + text(pad.l + i * 90 + 14, 13, `${b.label} years`, { "font-size": 10 })).join("")
  return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: "img", "aria-label": "the ten-year test: aged roster against actual roster" },
    legend + text(w - pad.r + 6, 13, "10+ · 13+", { "font-size": 10 }) + body)
}

// Stacked columns, one per year, four ordered bins on the navy ramp.
const stackChart = ({ series, w = 720, h = 260 }) => {
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
              el("title", {}, esc(`${schoolYear(foy)} · ${BINS[b].label} years: ${counts[b]} (${pct(s)})`)))
          : ""
      })
      return segs.join("") + text(x + bw / 2, h - 8, String(foy), { "text-anchor": "middle" })
    })
    .join("")
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((v) =>
    el("line", { x1: pad.l, x2: w - pad.r, y1: r1(pad.t + ph - v * ph), y2: r1(pad.t + ph - v * ph), stroke: C.grid, "stroke-width": 1 }) +
    text(pad.l - 6, pad.t + ph - v * ph + 4, pct(v), { "text-anchor": "end", "font-size": 10 }))
  const legend = BINS.map((b, i) => el("rect", { x: pad.l + i * 90, y: 2, width: 10, height: 10, rx: 2, fill: C.ramp[i] }) + text(pad.l + i * 90 + 14, 11, `${b.label} years`, { "font-size": 10 })).join("")
  return el("svg", { viewBox: `0 0 ${w} ${h + 8}`, width: w, height: h + 8, role: "img", "aria-label": "share of teachers by experience bin, by year" },
    legend + el("g", { transform: "translate(0,8)" }, yTicks.join("") + cols))
}

// -------------------------------------------------------------- analyses

const byYearHist = (tys) => new Map(foys.map((y) => [y, hist(tys.filter((t) => t.foy === y))]))
const townsHist = byYearHist(towns)
const glasHist = byYearHist(inDistrict(GLASTONBURY))
const yMaxHist = Math.max(...[...townsHist.values(), ...glasHist.values()].flatMap((h) => shares(h).slice(0, CENSOR - 1))) * 1.1

const counterfactual = (label, tys) => {
  const roster = tys.filter((t) => t.foy === FIRST)
  const aged = roster.map((t) => Math.min(t.experience + 10, CENSOR))
  const actual = tys.filter((t) => t.foy === FIRST + 10)
  const atTop = (xs) => (xs.length ? xs.filter((e) => e >= TOP_STEP).length / xs.length : null)
  return {
    label,
    n2014: roster.length,
    n2024: actual.length,
    predicted: binCounts(aged),
    actual: binCounts(actual.map((t) => t.expCapped)),
    predictedTop: atTop(aged),
    actualTop: atTop(actual.map((t) => t.expCapped)),
  }
}
const cfRows = [
  counterfactual("Town districts (local + regional)", towns),
  counterfactual("45 elementary-only peers", inPeers),
  counterfactual("Glastonbury", inDistrict(GLASTONBURY)),
  counterfactual("Andover", inDistrict(ANDOVER)),
]

const pooled = towns.filter((t) => t.foy > FIRST && t.foy < LAST)
const exitByExp = LEVELS.map((k) => {
  const at = pooled.filter((t) => t.expCapped === k)
  return {
    label: expLabel(k),
    n: at.length,
    back: at.filter((t) => t.nextDistrict !== t.districtCode).length / (at.length || 1),
    front: at.filter((t) => t.nextDistrict == null).length / (at.length || 1),
  }
})
const entrants = towns.filter((t) => t.foy > FIRST && t.prevDistrict == null)
const movers = towns.filter((t) => t.foy > FIRST && t.prevDistrict != null && t.prevDistrict !== t.districtCode)
const entrantShares = shares(hist(entrants))
const moverShares = shares(hist(movers))
const arrivals = LEVELS.map((k, i) => ({ label: expLabel(k), back: entrantShares[i], front: moverShares[i] }))

const base = towns.filter((t) => t.foy === START)
const ids2025 = new Set(towns.filter((t) => t.foy === LAST).map((t) => t.teacherId))
const sameDistrict2025 = new Map(towns.filter((t) => t.foy === LAST).map((t) => [t.teacherId, t.districtCode]))
const survival = LEVELS.map((k) => {
  const at = base.filter((t) => t.expCapped === k)
  return {
    label: expLabel(k),
    n: at.length,
    back: at.filter((t) => ids2025.has(t.teacherId)).length / (at.length || 1),
    front: at.filter((t) => sameDistrict2025.get(t.teacherId) === t.districtCode).length / (at.length || 1),
  }
})

const townCodes = [...new Set(towns.map((t) => t.districtCode))]
const districts = townCodes
  .map((code) => {
    const a = dy(code, START)
    const b = dy(code, LAST)
    if (!a || !b || a.teachers < MIN_TEACHERS || b.teachers < MIN_TEACHERS) return null
    const turnoverYears = foys.filter((y) => y >= START && y < LAST).map((y) => dy(code, y)).filter((r) => r && r.leftDistrict != null)
    return {
      code,
      label: shortName(code),
      size: b.teachers,
      change: b.share13plus - a.share13plus,
      turnover: mean(turnoverYears.map((r) => r.leftDistrict / r.teachers)),
    }
  })
  .filter(Boolean)
const andoverDrift = districts.find((d) => d.code === ANDOVER)

const waves = townCodes
  .map((code) => {
    const r2014 = towns.filter((t) => t.districtCode === code && t.foy === FIRST)
    if (r2014.length < 100) return null
    const h = shares(hist(r2014))
    const ratio = mean(h.slice(0, 9)) ? mean(h.slice(9, 12)) / mean(h.slice(0, 9)) : null
    return { code, label: shortName(code), ratio }
  })
  .filter((w) => w && w.ratio >= WAVE_CUT)
const waveLines = waves.map((w) => ({ key: w.code, label: w.label, points: foys.map((y) => [y, dy(w.code, y)?.share13plus ?? null]) }))
const townsLine = (field) => ({ key: "towns", label: "All town districts", points: foys.map((y) => [y, dy("towns", y)?.[field] ?? null]) })

const andoverRows = districtYears.filter((r) => r.districtCode === ANDOVER && r.foy >= START)
const andoverSeries = andoverRows.map((r) => ({ foy: r.foy, counts: BINS.map((b) => r[`exp${b.key}`]) }))

const share13 = (code, y) => dy(code, y)?.share13plus ?? null
const peerLines = peerCodes.map((code) => ({ key: code, label: shortName(code), points: foys.map((y) => [y, share13(code, y)]) }))
const peerMedianLine = { key: "peer-median", label: "Peer median", points: foys.map((y) => [y, median(peerCodes.map((c) => share13(c, y)).filter((v) => v != null))]) }

// --------------------------------------------------------------- figures

const xTicks = foys.filter((f) => f % 2 === 1)
const figures = {
  "fig01-shape-towns.svg": smallMultiples({ byYear: townsHist, yMax: yMaxHist, label: "experience distribution of town-district teachers, by year" }),
  "fig02-shape-glastonbury.svg": smallMultiples({ byYear: glasHist, yMax: yMaxHist, label: "experience distribution of Glastonbury teachers, by year" }),
  "fig03-ten-year-test.svg": cfChart(cfRows),
  "fig04-exit-by-experience.svg": withLegend(
    overlayColumns({ rows: exitByExp, yMax: 0.25, yTicks: [0, 0.05, 0.1, 0.15, 0.2, 0.25], backTitle: (r) => `${r.label} years: ${pct(r.back, 1)} left the district (n = ${fmt(r.n)})`, frontTitle: (r) => `${r.label} years: ${pct(r.front, 1)} left CT public schools (n = ${fmt(r.n)})` }),
    [[C.ramp[0], "left the district (any reason)"], [C.bar, "of which: left CT public schools"]]),
  "fig05-entrants-movers.svg": withLegend(
    overlayColumns({ rows: arrivals, yMax: 0.8, yTicks: [0, 0.2, 0.4, 0.6, 0.8], backTitle: (r) => `${r.label} years: ${pct(r.back, 1)} of teachers new to CT public schools`, frontTitle: (r) => `${r.label} years: ${pct(r.front, 1)} of teachers who moved from another CT district` }),
    [[C.ramp[0], "new to CT public schools"], [C.bar, "moved from another CT district"]]),
  "fig06-survival.svg": withLegend(
    overlayColumns({ rows: survival, yMax: 0.8, yTicks: [0, 0.2, 0.4, 0.6, 0.8], backTitle: (r) => `${r.label} years in ${START}: ${pct(r.back)} teaching in a CT town district in ${LAST} (n = ${fmt(r.n)})`, frontTitle: (r) => `${r.label} years in ${START}: ${pct(r.front)} in the same district` }),
    [[C.ramp[0], `teaching in a CT town district in ${LAST}`], [C.bar, "of which: in the same district"]]),
  "fig07-drift-distribution.svg": histogramChart({ values: districts.map((d) => 100 * d.change), binWidth: 5, min: -40, max: 40, mark: andoverDrift ? 100 * andoverDrift.change : null, markLabel: "Andover", xFmt: (v) => `${v > 0 ? "+" : ""}${Math.round(v)}` }),
  "fig08-drift-vs-turnover.svg": scatter({ points: districts.map((d) => ({ key: d.code, label: d.label, x: d.turnover, y: d.change })), xLabel: "annual turnover (share of teachers who left the district)", yLabel: "change in 13+ share", xFmt: (v) => pct(v), accentKey: ANDOVER, w: 720, h: 320 }),
  "fig09-hiring-waves.svg": emphasisLines({ xDomain: [FIRST, LAST], xTicks, lines: [...waveLines, townsLine("share13plus")], accentKey: GLASTONBURY, refKey: "towns" }),
  "fig10-andover-stack.svg": stackChart({ series: andoverSeries }),
  "fig11-andover-peers.svg": emphasisLines({ xDomain: [FIRST, LAST], xTicks, lines: [...peerLines, peerMedianLine, townsLine("share13plus")], accentKey: ANDOVER, refKey: "peer-median" }),
}

// ------------------------------------------------------- published table

// Town districts and the two aggregates, four experience bins only: no
// thirteen-level histogram for a district, so no cell is a single teacher's
// year. Fields that depend on the next year are blank in the last year.
const PUB_FIELDS = [
  "schoolYear", "districtCode", "district", "entityType", "teachers", "fte", "enrollment", "teachersPer100",
  "medianExp", "exp1to3", "exp4to7", "exp8to12", "exp13plus", "exp10plus",
  "share1to3", "share4to7", "share8to12", "share13plus", "share10plus",
  "newToDistrict", "leftDistrict", "retentionRate", "w1FromPrior",
]
const pubRows = districtYears
  .filter((r) => isTownDistrict(r.entityType) || r.districtCode === "towns")
  .map((r) => Object.fromEntries(PUB_FIELDS.map((f) => [f, r.districtCode === "towns" && f === "district" ? "All town districts" : r[f] ?? ""])))
const csvCell = (v) => (typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v))
const csv = [PUB_FIELDS.join(","), ...pubRows.map((r) => PUB_FIELDS.map((f) => csvCell(r[f])).join(","))].join("\n") + "\n"

const writeXlsx = async (file) => {
  const wb = new ExcelJS.Workbook()
  wb.creator = "andoverct.info"
  const sheet = wb.addWorksheet("District-years")
  sheet.columns = PUB_FIELDS.map((f) => ({ header: f, key: f, width: f === "district" ? 36 : 12 }))
  pubRows.forEach((r) => sheet.addRow(r))
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  const notes = wb.addWorksheet("About")
  ;[
    ["Source", "CSDE Performance Office teacher-level staffing extract, FOY 2014 to 2025, delivered 2026-10-23; aggregated by andoverct.info."],
    ["Experience", "Years taught in CT public schools since 2002-03, counting the current year; pre-2014 service capped at 13. A floor on real experience."],
    ["Bins", "1–3, 4–7, 8–12, 13 or more years; exp10plus is the count at 10 or more (the Andover schedule's top step)."],
    ["Rows", "Local and regional school districts plus the All town districts aggregate. One record per teacher per year, assigned to the district with most of their FTE."],
    ["Blank cells", "leftDistrict, retentionRate blank in the last year (no following year); newToDistrict and w1FromPrior blank in the first."],
  ].forEach((r) => notes.addRow(r))
  notes.getColumn(1).width = 14
  notes.getColumn(2).width = 120
  await wb.xlsx.writeFile(file)
}

// ------------------------------------------------------------------ main

mkdirSync(OUT, { recursive: true })
Object.entries(figures).forEach(([name, svg]) => writeFileSync(join(OUT, name), standalone(svg) + "\n"))
writeFileSync(join(OUT, "teacher-experience-districts.csv"), csv)
await writeXlsx(join(OUT, "teacher-experience-districts.xlsx"))

console.log(`wrote ${Object.keys(figures).length} figures and the district table (${pubRows.length} rows) to ${OUT}`)
cfRows.forEach((r) => console.log(`${r.label}: predicted 10+ ${pct(r.predictedTop)} / 13+ ${pct(shares(r.predicted)[3])}, actual 10+ ${pct(r.actualTop)} / 13+ ${pct(shares(r.actual)[3])}`))
console.log(`hiring-wave districts: ${waves.map((w) => w.label).join(", ")}`)
console.log(`arrivals: new-to-CT at year 1 ${pct(entrantShares[0], 1)} (n = ${fmt(entrants.length)}); movers at 13+ ${pct(moverShares[12], 1)}, movers at years 1–3 ${pct(moverShares[0] + moverShares[1] + moverShares[2], 1)} (n = ${fmt(movers.length)})`)
console.log(`exit year 1: ${pct(exitByExp[0].back, 1)} / ${pct(exitByExp[0].front, 1)}; year 12: ${pct(exitByExp[11].back, 1)} / ${pct(exitByExp[11].front, 1)}; 13+: ${pct(exitByExp[12].back, 1)} / ${pct(exitByExp[12].front, 1)}`)
console.log(`drift: ${districts.length} districts, median change ${(100 * median(districts.map((d) => d.change))).toFixed(1)} pts, within 5: ${districts.filter((d) => Math.abs(d.change) <= 0.05).length}, within 10: ${districts.filter((d) => Math.abs(d.change) <= 0.1).length}`)
