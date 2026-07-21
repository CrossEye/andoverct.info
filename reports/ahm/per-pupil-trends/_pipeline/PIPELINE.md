Data Pipeline: Per-Pupil Trends Dataset
=======================================

How to regenerate `dataset.json`, `towns_xy.json`, and `cpi_fy.json` from
primary sources. These files currently live in
`reports/ahm/per-pupil-trends/` and feed both the report directives and
the planned browser generator. Everything below runs offline except the
network fetches noted.


The Five Builds
---------------

Run in this order the first time; afterward, rerun only what changed.

1. `collect_towns.py` — fetches the F-33 series for every unit in the
   universe (Urban Institute API for FY1992-FY2021; Census unit files
   elsec21/22/23 for FY2021-FY2023) and writes `town_data.json`. Needs
   `town_universe.json`, `lea_overrides.json`, and the elsec files in cwd.
2. `build_state.py` — builds the denormalized statewide constant-universe
   series (`ct_state.json`). Network: Urban API. Needs the elsec files.
3. `build_cpi.py` — fiscal-year CPI-U averages from FRED
   (`cpi_fy.json`). Network: one FRED CSV.
4. `build_geometry.py` — two-level town geometry from TIGER
   (`towns_xy.json`). Needs `tl_2023_09_cousub.zip` and `npx mapshaper`.
5. `build_dataset.py` — assembles `dataset.json` from the outputs above
   plus `region_membership.csv` and `town_membership.csv` (both in the
   published f33-town-data package; copies can be regenerated from
   `collect_towns.py` output and the membership constants in
   `build_dataset.py` itself).


Load-Bearing Conventions (Do Not Rediscover These the Hard Way)
---------------------------------------------------------------

**Year labels.** Everything uses the Census fiscal year: FY2023 = school
year 2022-23, enrollment counted October 2022. The Urban API labels the
same data by school-year start (its "2020" is FY2021). `collect_towns.py`
normalizes; any new code touching the Urban API must add one.

**NCES vs. Census basis.** The Census unit files differ from the NCES
series two ways, and FY2021+ values are adjusted to the NCES basis:
payments to private schools (V91) are subtracted from TCURELSC and
TCURINST (Census folds them into instruction; NCES excludes them), and
state on-behalf benefits (the J-codes, chiefly teacher retirement) are
added into the support-service function lines and into total benefits
(Z34 + sum of J-codes). Both rules were validated to reconcile at 0.00%
against the NCES series on the FY2021 overlap, districts large and small.

**Constant statewide universe.** The recent Census unit files omit
charter-school LEAs, so the statewide series fixes its universe to the
districts in the latest unit file for all years. Statewide levels
therefore differ slightly from Census's published Table 8 (Census basis,
different universe); both are correct, and any document showing both
needs one reconciling sentence.

**Geometry must be simplified topologically.** The coarse layer comes
from mapshaper (`-simplify weighted 8% keep-shapes`), which simplifies
each shared boundary arc once. Per-polygon simplification (shapely
`simplify()`) makes different choices on each side of a shared border and
produces slivers and doubled lines. The full-resolution layer is used
only for zoom insets, clipped to the inset box at render time.

**CSDE town codes are not alphabetical.** Where CSDE district codes are
needed (MBR reports etc.), use the empirically built map, not a sorted
town list; the multiword-name clusters (East *, New *, North *) sort in
CSDE's own historic order. This bit us once (Easton vs. East Windsor).

**Land-only adjacency.** Rings derive from TIGER polygons with mapped
water erased, so river-centerline "borders" (Middletown-East Hampton,
Glastonbury-Rocky Hill) do not count, while genuine dry-land quirks
(Wethersfield-Glastonbury's old river channel) do.


Dataset Semantics
-----------------

- `units`: towns (`local_district` true/false, `regions` list), regional
  districts (`members`, `grades`), and one `state` unit (precomputed, not
  the sum of the others). Series are columnar arrays aligned to `years`;
  null = not reported. FY1993-94 are absent from the sources.
- `groups`: pure membership lists. Inclusion/exclusion is derived at
  render time from unit attributes, so honesty notes cannot drift.
- Blocks include a regional district only when all member towns fall
  inside. Regional districts are separate LEAs from their towns' local
  districts, so group sums count each student and dollar exactly once.
- Aggregation is enrollment-weighted: sums divided by sums.


Refresh Cadence and Extension
-----------------------------

- FY2024 F-33 should publish roughly spring 2026 via a new Census unit
  file (elsec24); adding it means extending `collect_towns.py`'s Census
  era and rerunning builds 1, 2, and 5.
- Extending to the full state (for the generator's any-town mode) means
  removing the universe filter in `collect_towns.py` and adding the
  remaining regional districts to the overrides; the schema needs no
  change. Expect ~200 units, roughly 60 KB gzipped.
- The published `f33-town-data` package (per-town CSVs, 28 variables
  including the full function breakdown) is the wide version of the same
  collection; `dataset.json` intentionally carries only enrollment and
  current expenditure. Function-level directives would extend
  `collect_towns.py`'s retained fields into the dataset.
