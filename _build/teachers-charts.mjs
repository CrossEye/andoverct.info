/*
 * Shared chart helpers for the teacher-workforce exploration pages
 * (teachers-explore.mjs, teachers-drift.mjs). Inline SVG built from template
 * strings, no browser code: thin marks, 4px rounded column caps, 2px surface
 * gaps, hairline grids, hover values via <title>, and a table twin per chart.
 *
 * Colors are the bluegold navy ramp and gold accent, validated 2026-10-24 with
 * the dataviz skill's checker against the cream surface (#FBF8F1): the ordinal
 * ramp passes all four checks; gold against navy is ΔE 30 under CVD.
 */

export const C = {
  surface: "#FBF8F1", ink: "#2b2b2b", sub: "#6a6453", grid: "#E3DDCE", axis: "#5a5446",
  ramp: ["#9db3cf", "#6687ad", "#3a5a84", "#13305a"],
  bar: "#3a5a84", accent: "#9a6f08", navy: "#13305a", dim: "#c7c1b2", predicted: "#9db3cf",
}

// ------------------------------------------------------------- formatting

export const pct = (x, d = 0) => (x == null ? "" : `${(100 * x).toFixed(d)}%`)
export const fmt = (n) => (n == null ? "" : n.toLocaleString("en-US"))
export const shares = (counts) => {
  const n = counts.reduce((a, c) => a + c, 0)
  return counts.map((c) => (n ? c / n : 0))
}
export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null
}
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
export const pearson = (pairs) => {
  const xs = pairs.map(([x]) => x)
  const ys = pairs.map(([, y]) => y)
  const mx = mean(xs)
  const my = mean(ys)
  const sxy = pairs.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0)
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0)
  const syy = ys.reduce((a, y) => a + (y - my) ** 2, 0)
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null
}

// -------------------------------------------------------------------- svg

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")
export const el = (tag, attrs, inner = "") =>
  `<${tag}${Object.entries(attrs).map(([k, v]) => (v == null ? "" : ` ${k}="${esc(v)}"`)).join("")}>${inner}</${tag}>`
export const text = (x, y, s, attrs = {}) => el("text", { x, y, fill: C.axis, "font-size": 11, ...attrs }, esc(s))
export const r1 = (x) => Math.round(x * 10) / 10

// A column with a 4px rounded cap and a square baseline, per the mark spec.
export const column = (x, yTop, w, h, fill, title) => {
  if (h <= 0) return ""
  const r = Math.min(4, h, w / 2)
  const d = `M${r1(x)},${r1(yTop + h)} V${r1(yTop + r)} Q${r1(x)},${r1(yTop)} ${r1(x + r)},${r1(yTop)} H${r1(x + w - r)} Q${r1(x + w)},${r1(yTop)} ${r1(x + w)},${r1(yTop + r)} V${r1(yTop + h)} Z`
  return el("path", { d, fill }, title ? el("title", {}, esc(title)) : "")
}

const gridLine = (x1, x2, y) => el("line", { x1, x2, y1: r1(y), y2: r1(y), stroke: C.grid, "stroke-width": 1 })

export const legend = (labels, colors) =>
  `<div class="legend">${labels.map((l, i) => `<span><i style="background:${colors[i]}"></i>${esc(l)}</span>`).join("")}</div>`

export const table = (header, rows, { open = false } = {}) =>
  `<details${open ? " open" : ""}><summary>Table</summary><table><thead><tr>${header.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c ?? "")}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></details>`

/*
 * Emphasis line chart: many series in the de-emphasis gray, one in the accent,
 * one reference in navy, direct-labeled at the right edge. With four or fewer
 * series every line is labeled.
 */
export const emphasisLines = ({ lines, accentKey, refKey, xDomain, xTicks, w = 720, h = 300, yMax = 1, yFmt = pct }) => {
  const pad = { l: 44, r: 110, t: 16, b: 28 }
  const pw = w - pad.l - pad.r
  const ph = h - pad.t - pad.b
  const [x0, x1] = xDomain
  const x = (v) => pad.l + ((v - x0) / (x1 - x0)) * pw
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
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((v) => gridLine(pad.l, w - pad.r, y(v * yMax)) + text(pad.l - 6, y(v * yMax) + 4, yFmt(v * yMax), { "text-anchor": "end", "font-size": 10 }))
  const xt = xTicks.map((f) => text(x(f), h - 8, String(f), { "text-anchor": "middle" }))
  return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: "img" }, yTicks.join("") + paths + xt.join(""))
}

export const barChart = ({ rows, w = 720, h = 240, yMax, yFmt = pct, color = C.bar }) => {
  const pad = { l: 44, r: 16, t: 16, b: 28 }
  const pw = w - pad.l - pad.r
  const ph = h - pad.t - pad.b
  const slot = pw / rows.length
  const bw = Math.min(24, slot - 6)
  const cols = rows
    .map(({ label, value, title, fill }, i) => {
      const bh = (value / yMax) * ph
      const x = pad.l + i * slot + (slot - bw) / 2
      return column(x, pad.t + ph - bh, bw, bh, fill ?? color, title) + text(x + bw / 2, h - 8, label, { "text-anchor": "middle", "font-size": 10 })
    })
    .join("")
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((v) => gridLine(pad.l, w - pad.r, pad.t + ph - v * ph) + text(pad.l - 6, pad.t + ph - v * ph + 4, yFmt(v * yMax), { "text-anchor": "end", "font-size": 10 }))
  return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: "img" }, ticks.join("") + cols)
}

/*
 * Two overlaid columns per category where the front value is a subset of the
 * back one (left the district ⊇ left the profession): back in the light step,
 * front in the base hue, same baseline. Not a stack.
 */
export const overlayColumns = ({ rows, yMax, yTicks, backTitle, frontTitle, w = 720, h = 240 }) => {
  const pad = { l: 44, r: 16, t: 16, b: 28 }
  const pw = w - pad.l - pad.r
  const ph = h - pad.t - pad.b
  const slot = pw / rows.length
  const bw = Math.min(24, slot - 8)
  const grid = yTicks.map((v) => gridLine(pad.l, w - pad.r, pad.t + ph - (v / yMax) * ph) + text(pad.l - 6, pad.t + ph - (v / yMax) * ph + 4, pct(v), { "text-anchor": "end", "font-size": 10 })).join("")
  const cols = rows
    .map((r, i) => {
      const x = pad.l + i * slot + (slot - bw) / 2
      const hb = (r.back / yMax) * ph
      const hf = (r.front / yMax) * ph
      return column(x, pad.t + ph - hb, bw, hb, C.ramp[0], backTitle(r)) + column(x, pad.t + ph - hf, bw, hf, C.bar, frontTitle(r)) +
        text(x + bw / 2, h - 8, r.label, { "text-anchor": "middle", "font-size": 10 })
    })
    .join("")
  return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: "img" }, grid + cols)
}

/*
 * Distribution of one measure across districts: fixed-width bins, one hue,
 * an optional marked value (a vertical rule with a label) for the district the
 * page is about.
 */
export const histogramChart = ({ values, binWidth, min, max, mark, markLabel, xFmt = (v) => String(v), w = 720, h = 220 }) => {
  const nBins = Math.ceil((max - min) / binWidth)
  const counts = Array.from({ length: nBins }, () => 0)
  values.forEach((v) => {
    const i = Math.min(nBins - 1, Math.max(0, Math.floor((v - min) / binWidth)))
    counts[i] += 1
  })
  const yMax = Math.max(...counts) * 1.15
  const pad = { l: 36, r: 16, t: 20, b: 28 }
  const pw = w - pad.l - pad.r
  const ph = h - pad.t - pad.b
  const slot = pw / nBins
  const bw = Math.min(24, slot - 2)
  const cols = counts
    .map((c, i) => {
      const bh = (c / yMax) * ph
      const lo = min + i * binWidth
      return column(pad.l + i * slot + (slot - bw) / 2, pad.t + ph - bh, bw, bh, C.bar, `${xFmt(lo)} to ${xFmt(lo + binWidth)}: ${c} districts`)
    })
    .join("")
  const xt = counts.map((_, i) => (i % 2 === 0 ? text(pad.l + i * slot, h - 8, xFmt(min + i * binWidth), { "text-anchor": "middle", "font-size": 10 }) : "")).join("")
  const yt = [0.5, 1].map((v) => gridLine(pad.l, w - pad.r, pad.t + ph - (v * yMax * 0.8) / yMax * ph)).join("")
  const marker = mark == null ? "" : (() => {
    const mx = pad.l + ((mark - min) / (max - min)) * pw
    return el("line", { x1: r1(mx), x2: r1(mx), y1: pad.t, y2: pad.t + ph, stroke: C.accent, "stroke-width": 2 }) +
      text(mx + 6, pad.t + 10, `${markLabel} ${xFmt(mark)}`, { fill: C.ink })
  })()
  return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: "img" }, yt + cols + marker + xt)
}

/*
 * Scatter with one hue, >= 8px markers with a 2px surface ring, an optional
 * accent point (direct-labeled), optional log x, and a zero line on y when the
 * domain crosses it.
 */
export const scatter = ({ points, xLabel, yLabel, xLog = false, xFmt = (v) => String(v), yFmt = pct, w = 360, h = 280, accentKey, r = 4 }) => {
  const pad = { l: 44, r: 16, t: 16, b: 40 }
  const pw = w - pad.l - pad.r
  const ph = h - pad.t - pad.b
  const tx = (v) => (xLog ? Math.log10(v) : v)
  const xs = points.map((p) => tx(p.x))
  const ys = points.map((p) => p.y)
  const [xmin, xmax] = [Math.min(...xs), Math.max(...xs)]
  const [ymin, ymax] = [Math.min(0, ...ys), Math.max(0, ...ys)]
  const x = (v) => pad.l + ((tx(v) - xmin) / (xmax - xmin || 1)) * pw
  const y = (v) => pad.t + ph - ((v - ymin) / (ymax - ymin || 1)) * ph
  const dots = [...points.filter((p) => p.key !== accentKey), ...points.filter((p) => p.key === accentKey)]
    .map((p) => {
      const isAccent = p.key === accentKey
      return el("circle", { cx: r1(x(p.x)), cy: r1(y(p.y)), r: isAccent ? r + 1 : r, fill: isAccent ? C.accent : C.bar, stroke: C.surface, "stroke-width": 2, opacity: isAccent ? 1 : 0.75 },
        el("title", {}, esc(`${p.label}: ${xFmt(p.x)}, ${yFmt(p.y)}`))) +
        (isAccent ? text(x(p.x) + 8, y(p.y) + 4, p.label, { fill: C.ink }) : "")
    })
    .join("")
  const zero = ymin < 0 && ymax > 0 ? el("line", { x1: pad.l, x2: w - pad.r, y1: r1(y(0)), y2: r1(y(0)), stroke: C.axis, "stroke-width": 1 }) : ""
  const yTicks = [ymin, ...(ymin < 0 && ymax > 0 ? [0] : [(ymin + ymax) / 2]), ymax].map((v) => text(pad.l - 6, y(v) + 4, yFmt(v), { "text-anchor": "end", "font-size": 10 }))
  const xTickVals = xLog
    ? [10, 30, 100, 300, 1000].filter((v) => Math.log10(v) >= xmin && Math.log10(v) <= xmax)
    : [xmin, (xmin + xmax) / 2, xmax]
  const xTicks = xTickVals.map((v) => text(x(v), h - 24, xFmt(v), { "text-anchor": "middle", "font-size": 10 }))
  return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: "img" },
    zero + dots + yTicks.join("") + xTicks.join("") +
    text(pad.l + pw / 2, h - 6, xLabel, { "text-anchor": "middle", fill: C.sub }) +
    text(12, pad.t + ph / 2, yLabel, { "text-anchor": "middle", fill: C.sub, transform: `rotate(-90 12 ${pad.t + ph / 2})` }))
}

// ------------------------------------------------------------------- page

export const pageShell = ({ title, intro, body }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --surface: ${C.surface}; --ink: ${C.ink}; --sub: ${C.sub}; --grid: ${C.grid}; }
  body { background: var(--surface); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 24px 16px 64px; }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 40px 0 6px; } h3 { font-size: 15px; margin: 24px 0 4px; } p { margin: 6px 0 12px; color: var(--sub); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px 12px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  svg { display: block; max-width: 100%; height: auto; }
  .legend { display: flex; gap: 16px; font-size: 12px; color: var(--sub); margin: 6px 0; flex-wrap: wrap; }
  .legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 6px; vertical-align: -2px; }
  details { margin: 6px 0 0; font-size: 13px; } summary { cursor: pointer; color: var(--sub); }
  table { border-collapse: collapse; margin-top: 6px; font-variant-numeric: tabular-nums; } th, td { padding: 2px 8px; text-align: right; border-bottom: 1px solid var(--grid); } th:first-child, td:first-child { text-align: left; }
  .note { font-size: 13px; }
</style></head><body><main>
<h1>${esc(title)}</h1>
<p class="note">${intro}</p>
${body}
</main></body></html>
`
