#!/usr/bin/env node
/*
 * town-asset reconcile — closes the drift loop after a promotion.
 *
 * THE FOOTGUN it exists for: `rebuild:links` regenerates links/index.html from
 * the repo's links/_src, which mid-run does NOT yet contain the promoted
 * campaign entries — a subsequent links-area deploy would clobber the live
 * index and silently de-list every published collection. Run this after each
 * promotion, and always before any links-area deploy during the run.
 *
 *   npm run reconcile:town-asset               # learn live step from the server
 *   npm run reconcile:town-asset -- --step N   # override (no FTP)
 *   npm run reconcile:town-asset -- --src <dir>     # default ../docs-sweep/v4/out-site
 *   npm run reconcile:town-asset -- --finalize      # end-of-run integration (see below)
 *
 * Normal run: copies steps/<live>/www/links/_src/*.yaml into links/_src/
 * (additive — register entries are never renumbered or removed), reruns
 * rebuild:links, and reminds about the links-area deploy.
 *
 * --finalize (one time, when live == last step): copies steps/<last>/www/series/
 * into a new repo series/ dir and adds a "series" area to site.manifest.json,
 * then prints the seed + deploy + commit steps. From then on the repo is
 * canonical for everything and ordinary workflows resume.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { Client } from "basic-ftp";

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, "..");
const MANIFEST_PATH = join(HERE, "site.manifest.json");

const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const valOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const SRC = resolve(ROOT, valOf("--src") || "../docs-sweep/v4/out-site");
const STEP_OVERRIDE = valOf("--step");
const FINALIZE = has("--finalize");

function fail(msg) { console.error(`\n  reconcile:town-asset: ${msg}\n`); process.exit(1); }

function loadDotenv() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

// ---------------------------------------------------------------------------
// Learn the live step: --step N, or download state.json from the server
// ---------------------------------------------------------------------------
async function liveStep() {
  if (STEP_OVERRIDE !== undefined) {
    if (!/^\d+$/.test(STEP_OVERRIDE)) fail(`--step must be a number, got "${STEP_OVERRIDE}"`);
    return parseInt(STEP_OVERRIDE, 10);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  loadDotenv();
  const password = process.env[manifest.remote.passwordEnv];
  if (!password) fail(`missing $${manifest.remote.passwordEnv} (or pass --step N to skip FTP).`);
  const client = new Client(30_000);
  try {
    await client.access({
      host: manifest.remote.host,
      port: manifest.remote.port || 21,
      user: manifest.remote.user,
      password,
      secure: manifest.remote.secure ?? false,
    });
    const tmp = join(tmpdir(), `ta-state-${Date.now()}.json`);
    try {
      await client.downloadTo(tmp, "/private-data/town-asset/state.json");
    } catch (e) {
      if (e.code === 550) return 0;              // no state yet: nothing promoted
      throw e;
    }
    const state = JSON.parse(readFileSync(tmp, "utf8"));
    return parseInt(state.live, 10) || 0;
  } finally {
    client.close();
  }
}

const live = await liveStep();
console.log(`\n  town-asset reconcile — live step: ${live}`);

if (live === 0) {
  console.log(`  nothing promoted yet; nothing to reconcile.\n`);
  process.exit(0);
}

const stepDir = join(SRC, "steps", String(live));
if (!existsSync(stepDir)) fail(`local render tree has no steps/${live} (src: ${SRC}). Re-render first.`);

// ---------------------------------------------------------------------------
// Copy the live step's register entries into the repo (additive)
// ---------------------------------------------------------------------------
const srcYaml = join(stepDir, "www", "links", "_src");
const destYaml = join(ROOT, "links", "_src");
let copied = 0, same = 0;
if (existsSync(srcYaml)) {
  for (const name of readdirSync(srcYaml)) {
    if (!name.endsWith(".yaml")) continue;
    const from = join(srcYaml, name);
    const to = join(destYaml, name);
    if (existsSync(to) && readFileSync(to, "utf8") === readFileSync(from, "utf8")) { same++; continue; }
    copyFileSync(from, to);
    copied++;
    console.log(`  + links/_src/${name}`);
  }
}
console.log(`  register entries: ${copied} copied, ${same} already current.`);

// ---------------------------------------------------------------------------
// Rebuild the local links pages so the repo index matches the live one
// ---------------------------------------------------------------------------
console.log(`  running rebuild:links …`);
execSync("npm run rebuild:links", { cwd: ROOT, stdio: "inherit" });

console.log(`\n  ✓ reconciled to step ${live}.`);
console.log(`  Reminder: npm run deploy -- --area links   (safe now; required before any links deploy mid-run)\n`);

// ---------------------------------------------------------------------------
// End-of-run integration (explicit, one time)
// ---------------------------------------------------------------------------
const stepsRoot = join(SRC, "steps");
const totalStaged = existsSync(stepsRoot)
  ? readdirSync(stepsRoot).filter((n) => /^\d+$/.test(n) && statSync(join(stepsRoot, n)).isDirectory()).length
  : 0;

if (!FINALIZE) {
  if (totalStaged > 0 && live >= totalStaged) {
    console.log(`  Live step ${live} is the last staged step — when the run is over, integrate the`);
    console.log(`  series into the repo with:  npm run reconcile:town-asset -- --finalize\n`);
  }
  process.exit(0);
}

if (totalStaged === 0 || live < totalStaged) {
  fail(`--finalize is for the end of the run (live=${live}, staged=${totalStaged}).`);
}

const srcSeries = join(stepDir, "www", "series");
if (!existsSync(srcSeries)) fail(`steps/${live}/www/series not found — cannot finalize.`);
const destSeries = join(ROOT, "series");

let integrated = 0;
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const ent of readdirSync(from, { withFileTypes: true })) {
    const f = join(from, ent.name), t = join(to, ent.name);
    if (ent.isDirectory()) copyTree(f, t);
    else if (ent.isFile()) { copyFileSync(f, t); integrated++; }
  }
}
copyTree(srcSeries, destSeries);
console.log(`  integrated ${integrated} file(s) into series/.`);

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
if (!manifest.areas.some((a) => a.id === "series")) {
  manifest.areas.push({ id: "series", src: "series", remote: "series" });
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`  added "series" area to site.manifest.json.`);
} else {
  console.log(`  "series" area already in site.manifest.json.`);
}

console.log(`\n  Finish by hand (deliberate steps, in order):`);
console.log(`    npm run deploy -- --seed --area series     # record what's already live`);
console.log(`    git add series _build/site.manifest.json && git commit`);
console.log(`  From here the repo is canonical and ordinary workflows resume.\n`);
