#!/usr/bin/env node
/*
 * town-asset stager — mirrors the locally rendered staging tree to the server.
 *
 * Sibling to deploy.mjs, but deliberately NOT a manifest area: it writes
 * OUTSIDE /www (the promotion source lives at ~/private-data/town-asset/,
 * which deploy.mjs's single remote root cannot express), and its baseline
 * describes unpublished content that must never be committed.
 *
 *   npm run stage:town-asset             # DRY RUN (default): show the plan
 *   npm run stage:town-asset -- --go     # actually connect and upload
 *   npm run stage:town-asset -- --src <dir>   # default ../docs-sweep/v4/out-site
 *   npm run stage:town-asset -- --verbose
 *
 * Source tree contract (filled by the plan-004 renderer):
 *   <src>/steps/<N>/...    -> ~/private-data/town-asset/steps/<N>/...
 *   <src>/preview/...      -> ~/www/private/subsections/town-asset/...
 *
 * Invariants:
 *   - Add/overwrite only. There is no delete operation anywhere in this file.
 *   - state.json and state.lock under town-asset/ belong to the PHP console;
 *     a staged tree that would touch them is a hard refusal.
 *   - Hash-delta against .town-asset-stage-state.json (gitignored, unlike
 *     .deploy-state.json — this baseline must not be committed).
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, posix } from "node:path";
import { Client } from "basic-ftp";

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, "..");
const MANIFEST_PATH = join(HERE, "site.manifest.json");
const STATE_PATH = join(ROOT, ".town-asset-stage-state.json");

const REMOTE_STEPS = "/private-data/town-asset/steps";      // ~ is the FTP landing dir
const REMOTE_PREVIEW = "/www/private/subsections/town-asset";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const valOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const GO = has("--go") || has("--deploy");
const VERBOSE = has("--verbose") || has("-v");
const SRC = resolve(ROOT, valOf("--src") || "../docs-sweep/v4/out-site");

function fail(msg) { console.error(`\n  stage:town-asset: ${msg}\n`); process.exit(1); }
const fmtBytes = (n) => n < 1024 ? `${n} B`
  : n < 1048576 ? `${(n / 1024).toFixed(1)} KB`
  : `${(n / 1048576).toFixed(1)} MB`;

if (!existsSync(SRC)) fail(`src not found: ${SRC}`);

// ---------------------------------------------------------------------------
// Walk the staging tree and map local rel -> absolute remote path
// ---------------------------------------------------------------------------
function walk(absDir, relPrefix = "") {
  const out = [];
  for (const ent of readdirSync(absDir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...walk(join(absDir, ent.name), rel));
    else if (ent.isFile()) out.push(rel);
  }
  return out;
}
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

const files = [];      // { rel, abs, remote, size, hash }
const skipped = [];    // top-level entries outside the contract (warned, not uploaded)

for (const rel of walk(SRC)) {
  const p = rel.replace(/\\/g, "/");
  if (p.includes("..") || p.includes("\0")) fail(`refusing suspicious path in staging tree: ${p}`);

  let remote;
  if (p.startsWith("steps/")) remote = posix.join(REMOTE_STEPS, p.slice("steps/".length));
  else if (p.startsWith("preview/")) remote = posix.join(REMOTE_PREVIEW, p.slice("preview/".length));
  else { skipped.push(p); continue; }

  // The console owns its state; a tree that would touch it is a hard refusal.
  const base = posix.basename(remote);
  if (remote.startsWith("/private-data/town-asset/") && (base === "state.json" || base === "state.lock")) {
    fail(`staging tree contains ${p}, which maps onto the console's ${base}. Refusing everything.`);
  }

  const abs = join(SRC, rel);
  files.push({ rel: p, abs, remote, size: statSync(abs).size, hash: sha256(abs) });
}

if (!files.length) fail(`nothing stageable under ${SRC} (expected steps/ and/or preview/).`);

// ---------------------------------------------------------------------------
// Diff against the (gitignored) baseline
// ---------------------------------------------------------------------------
const state = existsSync(STATE_PATH)
  ? JSON.parse(readFileSync(STATE_PATH, "utf8"))
  : { updatedAt: null, files: {} };
const baseline = state.files || {};

const upload = [];
let unchanged = 0;
for (const f of files) {
  const prev = baseline[f.remote];
  if (prev === f.hash) { unchanged++; continue; }
  upload.push({ ...f, tag: prev === undefined ? "NEW" : "MOD" });
}

// ---------------------------------------------------------------------------
// Report the plan
// ---------------------------------------------------------------------------
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
console.log(`\n  town-asset stage — ${GO ? "UPLOAD" : "DRY RUN (no transfer)"}`);
console.log(`  src:    ${SRC}`);
console.log(`  target: ftp://${manifest.remote.user}@${manifest.remote.host}  steps -> ${REMOTE_STEPS}, preview -> ${REMOTE_PREVIEW}\n`);

if (skipped.length) {
  console.log(`  ! ${skipped.length} entr${skipped.length === 1 ? "y" : "ies"} outside steps/ and preview/ ignored:`);
  for (const s of skipped.slice(0, 8)) console.log(`      ${s}`);
  if (skipped.length > 8) console.log(`      … and ${skipped.length - 8} more`);
  console.log("");
}

const totalBytes = upload.reduce((n, f) => n + f.size, 0);
if (!upload.length) {
  console.log(`  up to date — ${unchanged} file(s) already staged.\n`);
  process.exit(0);
}
const show = VERBOSE ? upload : upload.slice(0, 20);
for (const f of show) console.log(`  ${f.tag}  ${f.rel}  (${fmtBytes(f.size)})`);
if (!VERBOSE && upload.length > 20) console.log(`  … and ${upload.length - 20} more (use --verbose)`);
console.log(`\n  total to upload: ${upload.length} file(s), ${fmtBytes(totalBytes)}  (${unchanged} unchanged)\n`);

if (!GO) {
  console.log(`  dry run only — re-run with --go to transfer.\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Upload (add/overwrite only; no delete calls exist in this file)
// ---------------------------------------------------------------------------
function loadDotenv() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}
loadDotenv();
const password = process.env[manifest.remote.passwordEnv];
if (!password) fail(`missing $${manifest.remote.passwordEnv} (set it in the environment or a .env file at the repo root).`);

function writeState(nextFiles) {
  const ordered = {};
  for (const k of Object.keys(nextFiles).sort()) ordered[k] = nextFiles[k];
  writeFileSync(STATE_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), files: ordered }, null, 2) + "\n");
}

const client = new Client(30_000);
client.ftp.verbose = VERBOSE;
const next = { ...baseline };

try {
  await client.access({
    host: manifest.remote.host,
    port: manifest.remote.port || 21,
    user: manifest.remote.user,
    password,
    secure: manifest.remote.secure ?? false,
  });

  const groups = new Map();
  for (const f of upload) {
    const dir = posix.dirname(f.remote);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(f);
  }
  let done = 0;
  for (const [dir, groupFiles] of groups) {
    await client.ensureDir(dir);
    for (const f of groupFiles) {
      await client.uploadFrom(f.abs, posix.basename(f.remote));
      next[f.remote] = f.hash;
      done++;
      console.log(`  ↑ [${done}/${upload.length}] ${f.rel}`);
    }
  }
  writeState(next);
  console.log(`\n  done: ${done} uploaded. Staged baseline updated (not committed).\n`);
} catch (e) {
  writeState(next);
  fail(`FTP error: ${e.message}\n  (partial progress saved — re-run to resume.)`);
} finally {
  client.close();
}
