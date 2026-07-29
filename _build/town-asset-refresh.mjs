#!/usr/bin/env node
/*
 * town-asset-refresh — rebuild the FINALIZED series from source (maintenance).
 *
 * After reconcile --finalize, the series' register entries live in the repo's
 * links/_src AND are still emitted by the campaign build, so a bare
 * render:town-asset collides on shared ids. (The renderer tolerates IDENTICAL
 * duplicates, but an entry changed at the source differs until the repo cache
 * catches up.) This refreshes in the order that avoids the clash:
 *
 *   1. sync links/_src from the source register (docs-sweep out/.../<last>/links)
 *   2. npm run rebuild:links      (regenerate the registry pages)
 *   3. npm run render:town-asset  (repo now matches source; the union is clean)
 *   4. copy steps/<last>/www/series -> repo series/   (article + pieces + landing)
 *
 * Run AFTER `python v4/build.py` in docs-sweep. The explanation page is not part
 * of the render; if cards or post text changed, regenerate it via docs-sweep's
 * wind-down/build_explanation.py and copy it into series/town-asset/explanation/.
 * The drip scripts (render/stage/reconcile/promote) are untouched and reusable.
 *
 *   npm run rebuild:town-asset
 *   npm run rebuild:town-asset -- --src <v4dir>   # default ../docs-sweep/v4
 */
import { readFileSync, readdirSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, "..");
const args = process.argv.slice(2);
const valOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const SRC = resolve(ROOT, valOf("--src") || "../docs-sweep/v4");
const STEPS_SRC = join(SRC, "out", "town-asset");

function fail(m) { console.error(`\n  town-asset-refresh: ${m}\n`); process.exit(1); }
if (!existsSync(STEPS_SRC)) fail(`no ${STEPS_SRC} — run 'python v4/build.py' in docs-sweep first.`);
const steps = readdirSync(STEPS_SRC).filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);
if (!steps.length) fail("no step dirs under out/town-asset.");
const last = steps[steps.length - 1];

// 1. sync links/_src from the source register (additive/overwrite; never deletes)
const srcLinks = join(STEPS_SRC, String(last), "links");
const dstLinks = join(ROOT, "links", "_src");
let synced = 0;
for (const f of readdirSync(srcLinks)) {
  if (!f.endsWith(".yaml")) continue;
  const from = join(srcLinks, f), to = join(dstLinks, f);
  if (!existsSync(to) || readFileSync(to, "utf8") !== readFileSync(from, "utf8")) { copyFileSync(from, to); synced++; }
}
console.log(`  synced ${synced} register entr${synced === 1 ? "y" : "ies"} into links/_src`);

// 2 + 3
execSync("npm run rebuild:links", { cwd: ROOT, stdio: "inherit" });
execSync("npm run render:town-asset", { cwd: ROOT, stdio: "inherit" });

// 4. copy the rendered series into the repo (overwrites; the explanation page,
//    which the render does not emit, is left in place)
const srcSeries = resolve(ROOT, "../docs-sweep/v4/out-site", "steps", String(last), "www", "series");
if (!existsSync(srcSeries)) fail(`render produced no steps/${last}/www/series.`);
const dstSeries = join(ROOT, "series");
let n = 0;
function copyTree(a, b) {
  mkdirSync(b, { recursive: true });
  for (const e of readdirSync(a, { withFileTypes: true })) {
    const f = join(a, e.name), t = join(b, e.name);
    if (e.isDirectory()) copyTree(f, t);
    else { copyFileSync(f, t); n++; }
  }
}
copyTree(srcSeries, dstSeries);
console.log(`  refreshed ${n} series file(s) into series/.`);
console.log(`  next: git add series links _build ; npm run deploy -- --area series --area links --deploy\n`);
