Generator Plan: Browser Tool for Per-Pupil Trends
=================================================

Design decisions already made for the browser-only exploration tool, so
implementation can start without relitigating them. The tool lets a
visitor pick any town, group, or custom region and see the same
section-style output as the published report: locator map, decomposition
chart, and data table, with a shareable link.


Architecture
------------

- **Single static page**, no backend. Data inlined or fetched alongside:
  `dataset.json` (~15 KB gzipped now; ~60 KB at full state), the coarse
  geometry layer only (~60 KB gzipped), `cpi_fy.json`, and the
  land-adjacency graph (a few KB; generate from TIGER the same way the
  rings were built).
- **Share the report's renderers.** The skill's `scripts/directives/`
  modules (decomp, locmap, datatable, resolve, svg) are dependency-free
  string builders; wrap them for the browser (they are CommonJS; a tiny
  esbuild/rollup pass or a manual UMD wrapper both work). One code path
  for report and tool means they can never disagree visually or
  numerically.
- **Charts stay SVG in the DOM.** The page-weight concern that applies to
  ten inline maps in one report page does not apply here: geometry ships
  once as data and maps render on demand.
- **PNG download** via the standard canvas route: serialize the SVG, draw
  to canvas, `toBlob`. Requires all styles inline in the SVG (already
  true) and no external font fetches at draw time.


Selection Model
---------------

- Units: any town with a local district, any regional district, the
  named groups from `dataset.json` as presets, or a custom set built by
  clicking towns on the coarse map.
- **Ring growth**: from any selection, "add ring" adds all land-adjacent
  towns (first-order contiguity), repeatable.
- **Region closure (required rule)**: whenever a selection includes any
  member town of a regional district, add all of that region's member
  towns, then the region itself. Closure runs once, after ring
  computation, as a completion step; closure-added towns do NOT seed
  further ring growth (prevents snowballing; a selection touching Kent
  adds the other five Region 1 towns and stops). Surface it in the UI:
  "Kent's selection added five towns to complete Region 1."
- Towns with `local_district: false` are selectable only via their
  region and render hatched, with the reason shown (the resolver already
  produces it).
- Parameters: start year, end year, weighting (enrollment now; equal
  reserved; the resolver throws a clear message for unimplemented modes).


Shareable Links
---------------

Fragment identifier, human-readable, versioned:

    #v=1&g=block2&y0=2013&y1=2023&w=enrollment
    #v=1&u=Andover,Bolton,Coventry&y0=2013&y1=2023&w=enrollment

Groups by id (`g=`) or explicit unit lists (`u=`). No base64 unless the
parameters outgrow readability; hand-editable fragments are a feature in
a civic context where links get pasted into Facebook comments. Unknown
`v` values should show a friendly "made with a newer version" message
rather than guessing.


Honesty Requirements (Non-Negotiable, Inherited From the Report)
----------------------------------------------------------------

- The basis note (NCES F-33, state-paid teacher retirement included,
  levels not comparable to NCEP or town budgets) travels with every
  chart and table, not just an about page.
- Exclusions and their reasons render automatically from unit
  attributes, exactly as the report's datatable Notes do.
- Grade-span mixing gets a persistent one-line caveat whenever a
  selection mixes elementary-only, secondary-regional, and K-12 units.
- The statewide unit is precomputed on a constant universe; if the tool
  offers it, it is a preset, never a sum of visible selections.


Output Per Selection
--------------------

Mirrors a report section: title (group label or generated from the
selection), locator map (coarse main + full-res inset comes later; v1
can use coarse for both), the four-line decomposition chart, and the
year table. A "download data" link exports the selection's series as
CSV, assembled client-side.


Deferred, Deliberately
----------------------

- ~~Equal weighting~~ — implemented 2026-07-21. Defined as the plain mean
  of member districts' own per-pupil figures (one district, one vote).
  Because a group's member set is constant across the years returned, the
  student and spending totals (and their percent-change lines) are
  identical to enrollment weighting; only the per-pupil measure moves. The
  table Notes warn that per pupil no longer equals total spending over
  total students.
- Full-resolution inset geometry in the browser (fetch-on-demand per
  selection, or accept coarse insets in v1).
- Full-state dataset (pipeline extension documented in PIPELINE.md).
- Function-level breakdowns (instruction vs. support etc.); the wide
  collection already has the data, the dataset schema would grow
  additional parallel arrays.
- Rasterized map delivery for the report (resvg/sharp at build time) if
  the 3.4 MB report page ever feels heavy; no handler changes needed.
