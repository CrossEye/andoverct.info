#!/usr/bin/env node
/*
 * andoverct.info deploy — hash-delta FTP publisher.
 *
 * Walks the content "areas" declared in _build/site.manifest.json, hashes the
 * files each area publishes, diffs them against the last-deployed baseline in
 * .deploy-state.json, and uploads only what changed over plain FTP to the
 * origin web root (/www on pup.phpwebhosting.com — see the manifest).
 *
 *   npm run deploy              # DRY RUN (default): show the plan, transfer nothing
 *   npm run deploy -- --deploy  # actually connect and upload the delta
 *   npm run deploy -- --seed    # record current files as the baseline WITHOUT
 *                               #   uploading (use once, for content already live
 *                               #   on the server, so the first real deploy is a
 *                               #   true delta instead of "everything is new")
 *   npm run deploy -- --area video        # limit to one area (by id)
 *   npm run deploy -- --deploy --delete   # also remove remote files that are
 *                                         #   gone locally (off by default)
 *   npm run deploy -- --verbose           # full file lists + FTP protocol log
 *   npm run deploy -- --deploy --allow-untracked   # override the git guard
 *
 * Git guard: files that git does not track (and does not ignore) are refused
 * at --deploy/--seed time and flagged on dry runs. Untracked files in a deploy
 * area are almost always rehearsal fallout (a local town-asset promotion) or
 * uncommitted work-in-progress — never something to publish silently. Commit
 * the files, or pass --allow-untracked to publish them deliberately.
 *
 * The FTP password is read from $FTP_PASSWORD (or a gitignored .env at the repo
 * root: FTP_PASSWORD=...). Host/port/user/web-root are non-secret and live in
 * the manifest. .deploy-state.json is committed so any machine shares the same
 * published baseline.
 *
 * Manifest area fields: { id, src (dir, relative to repo root), remote (path
 * under the web root, "" = root), include? (globs — file must match one),
 * exclude? (globs) }. Manifest-level "ignore" globs apply to every area.
 * Globs support **, *, ?, matched against the area-relative POSIX path.
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { join, resolve, posix, relative } from "node:path";
import { Client } from "basic-ftp";

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, "..");
const MANIFEST_PATH = join(HERE, "site.manifest.json");
const STATE_PATH = join(ROOT, ".deploy-state.json");

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const valOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const DEPLOY = has("--deploy") || has("--go");
const SEED = has("--seed");
const DELETE = has("--delete");
const ONLY = valOf("--area");
const VERBOSE = has("--verbose") || has("-v");
const ALLOW_UNTRACKED = has("--allow-untracked");

if (DEPLOY && SEED) fail("Use either --deploy or --seed, not both.");

// ---------------------------------------------------------------------------
// Tiny glob -> RegExp (matches a POSIX relative path)
// ---------------------------------------------------------------------------
// Placeholder that can never occur in a glob. Written as an escape sequence,
// not a raw NUL byte, so git treats this file as text rather than binary.
const SLOT = "\u0000";
function globToRe(glob) {
  let re = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&"); // escape regex metachars
  re = re.replace(/\*\*\/?/g, SLOT);                  // ** (and **/) -> match across dirs
  re = re.replace(/\*/g, "[^/]*");                    // *  -> within a segment
  re = re.replace(/\?/g, "[^/]");                     // ?  -> one char, not a slash
  re = re.split(SLOT).join(".*");
  return new RegExp("^" + re + "$");
}
const matchAny = (res, p) => res.some((re) => re.test(p));

// ---------------------------------------------------------------------------
// Filesystem walk (prunes heavy/ignored dirs as it descends)
// ---------------------------------------------------------------------------
const PRUNE_DIRS = new Set(["node_modules", ".git", "Charter", ".meta"]);

function walk(absDir, recursive, relPrefix = "") {
  const out = [];
  for (const ent of readdirSync(absDir, { withFileTypes: true })) {
    const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (!recursive || PRUNE_DIRS.has(ent.name)) continue;
      out.push(...walk(join(absDir, ent.name), recursive, rel));
    } else if (ent.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function sha256(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

// ---------------------------------------------------------------------------
// .env loader (only used when actually deploying)
// ---------------------------------------------------------------------------
function loadDotenv() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const k = m[1];
    const v = m[2].replace(/^(["'])(.*)\1$/, "$2");
    if (!(k in process.env)) process.env[k] = v;
  }
}

function fail(msg) { console.error(`\n  deploy: ${msg}\n`); process.exit(1); }
const fmtBytes = (n) => n < 1024 ? `${n} B`
  : n < 1048576 ? `${(n / 1024).toFixed(1)} KB`
  : `${(n / 1048576).toFixed(1)} MB`;

// ---------------------------------------------------------------------------
// Build the local index for the selected areas
// ---------------------------------------------------------------------------
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const ignoreRes = (manifest.ignore || []).map(globToRe);

let areas = manifest.areas;
if (ONLY) {
  areas = areas.filter((a) => a.id === ONLY);
  if (!areas.length) fail(`unknown --area "${ONLY}". Known: ${manifest.areas.map((a) => a.id).join(", ")}`);
}

const REMOTE_ROOT = manifest.remote.root.replace(/\/+$/, ""); // e.g. /www

// remoteKey = path under the web root, the stable identity used in state.
const toKey = (areaRemote, rel) => posix.join(areaRemote || ".", rel).replace(/^\.\//, "");

const files = [];        // { key, abs, size, hash, areaId }
const perArea = new Map(); // id -> { new:0, changed:0, same:0, bytes:0, items:[] }

for (const area of areas) {
  perArea.set(area.id, { new: 0, changed: 0, same: 0, bytes: 0, items: [] });
  const absSrc = resolve(ROOT, area.src);
  if (!existsSync(absSrc)) fail(`area "${area.id}" src not found: ${area.src}`);

  const includeRes = (area.include || []).map(globToRe);
  const excludeRes = (area.exclude || []).map(globToRe);
  // Recurse unless every include pattern is a plain top-level name (no "/" / "**").
  const recursive = !area.include || area.include.some((g) => g.includes("/") || g.includes("**"));

  for (const rel of walk(absSrc, recursive)) {
    if (matchAny(ignoreRes, rel)) continue;
    if (excludeRes.length && matchAny(excludeRes, rel)) continue;
    if (includeRes.length && !matchAny(includeRes, rel)) continue;
    const abs = join(absSrc, rel);
    files.push({
      key: toKey(area.remote, rel),
      abs,
      size: statSync(abs).size,
      hash: sha256(abs),
      areaId: area.id,
    });
  }
}

// ---------------------------------------------------------------------------
// Diff against the committed baseline
// ---------------------------------------------------------------------------
const state = existsSync(STATE_PATH)
  ? JSON.parse(readFileSync(STATE_PATH, "utf8"))
  : { updatedAt: null, files: {} };
const baseline = state.files || {};

const localKeys = new Set(files.map((f) => f.key));
const upload = []; // files needing transfer (new or changed)

for (const f of files) {
  const prev = baseline[f.key];
  const bucket = perArea.get(f.areaId);
  if (prev === undefined) { bucket.new++; bucket.bytes += f.size; bucket.items.push(["NEW", f]); upload.push(f); }
  else if (prev !== f.hash) { bucket.changed++; bucket.bytes += f.size; bucket.items.push(["MOD", f]); upload.push(f); }
  else { bucket.same++; }
}

// Removed = baseline keys gone locally — only meaningful on a full run.
const removed = ONLY ? [] : Object.keys(baseline).filter((k) => !localKeys.has(k));

// ---------------------------------------------------------------------------
// Report the plan
// ---------------------------------------------------------------------------
const mode = SEED ? "SEED (record baseline, no upload)"
  : DEPLOY ? "DEPLOY (upload delta)"
  : "DRY RUN (no transfer)";
const totalBytes = upload.reduce((n, f) => n + f.size, 0);

console.log(`\n  andoverct.info deploy — ${mode}`);
console.log(`  target: ftp://${manifest.remote.user}@${manifest.remote.host}${REMOTE_ROOT}  (plain FTP)`);
console.log(`  areas:  ${areas.map((a) => a.id).join(", ")}${ONLY ? "  [filtered]" : ""}\n`);

for (const area of areas) {
  const b = perArea.get(area.id);
  const tag = b.new + b.changed === 0 ? "up to date" : `${b.new} new, ${b.changed} changed, ${fmtBytes(b.bytes)}`;
  console.log(`  • ${area.id.padEnd(13)} ${tag}  (${b.same} unchanged)`);
  const show = VERBOSE ? b.items : b.items.slice(0, 12);
  for (const [k, f] of show) console.log(`      ${k}  ${f.key}  (${fmtBytes(f.size)})`);
  if (!VERBOSE && b.items.length > 12) console.log(`      … and ${b.items.length - 12} more (use --verbose)`);
}

if (removed.length) {
  console.log(`\n  ${removed.length} file(s) in baseline no longer present locally${DELETE ? " (will be DELETED)" : " (use --delete to remove remotely)"}:`);
  for (const k of (VERBOSE ? removed : removed.slice(0, 12))) console.log(`      DEL  ${k}`);
  if (!VERBOSE && removed.length > 12) console.log(`      … and ${removed.length - 12} more`);
}

console.log(`\n  total to upload: ${upload.length} file(s), ${fmtBytes(totalBytes)}\n`);

// ---------------------------------------------------------------------------
// Git guard: refuse to publish (or seed) files git does not track. Gitignored
// files never trip it (ignoring is deliberate); untracked-and-not-ignored is
// the danger class — rehearsal fallout from a local town-asset promotion, or
// work-in-progress not yet committed. See the usage note in the header.
// ---------------------------------------------------------------------------
function untrackedOffenders(candidates) {
  let raw;
  try {
    raw = execSync("git ls-files --others --exclude-standard", {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return []; // not a git checkout / no git — guard degrades to a no-op
  }
  const untracked = new Set(raw.split(/\r?\n/).filter(Boolean));
  return candidates.filter((f) =>
    untracked.has(relative(ROOT, f.abs).replace(/\\/g, "/")));
}

{
  // Deploy publishes `upload`; seed records baseline for files new to it.
  const candidates = SEED ? files.filter((f) => baseline[f.key] === undefined) : upload;
  const offenders = untrackedOffenders(candidates);
  if (offenders.length && !ALLOW_UNTRACKED) {
    console.log(`  ! ${offenders.length} file(s) are NOT TRACKED BY GIT:`);
    for (const f of (VERBOSE ? offenders : offenders.slice(0, 12)))
      console.log(`      ??  ${f.key}`);
    if (!VERBOSE && offenders.length > 12) console.log(`      … and ${offenders.length - 12} more (use --verbose)`);
    if (DEPLOY || SEED) {
      fail(`refusing to ${SEED ? "seed" : "publish"} untracked files. Commit them first, `
        + `or pass --allow-untracked if this is deliberate.`);
    }
    console.log(`  ! a real deploy would refuse these (commit them, or --allow-untracked).\n`);
  }
}

// ---------------------------------------------------------------------------
// Act
// ---------------------------------------------------------------------------
function writeState(nextFiles) {
  const ordered = {};
  for (const k of Object.keys(nextFiles).sort()) ordered[k] = nextFiles[k];
  writeFileSync(STATE_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), files: ordered }, null, 2) + "\n");
}

if (SEED) {
  const next = { ...baseline };
  for (const f of files) next[f.key] = f.hash;
  for (const k of removed) delete next[k];
  writeState(next);
  console.log(`  seeded baseline: ${Object.keys(next).length} file(s) recorded in .deploy-state.json (nothing uploaded).\n`);
  process.exit(0);
}

if (!DEPLOY) {
  console.log(`  dry run only — re-run with --deploy to transfer.\n`);
  process.exit(0);
}

if (upload.length === 0 && !(DELETE && removed.length)) {
  console.log(`  nothing to do.\n`);
  process.exit(0);
}

loadDotenv();
const password = process.env[manifest.remote.passwordEnv];
if (!password) fail(`missing $${manifest.remote.passwordEnv} (set it in the environment or a .env file at the repo root).`);

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

  // Group uploads by remote directory so each dir is ensured once.
  const groups = new Map();
  for (const f of upload) {
    const remoteDir = posix.dirname(posix.join(REMOTE_ROOT, f.key));
    if (!groups.has(remoteDir)) groups.set(remoteDir, []);
    groups.get(remoteDir).push(f);
  }
  let done = 0;
  for (const [dir, groupFiles] of groups) {
    await client.ensureDir(dir); // creates as needed; leaves cwd in `dir`
    for (const f of groupFiles) {
      await client.uploadFrom(f.abs, posix.basename(f.key));
      next[f.key] = f.hash;
      done++;
      console.log(`  ↑ [${done}/${upload.length}] ${f.key}`);
    }
  }

  if (DELETE && removed.length) {
    await client.cd("/");
    for (const k of removed) {
      try { await client.remove(posix.join(REMOTE_ROOT, k)); delete next[k]; console.log(`  ✕ ${k}`); }
      catch (e) {
        if (e.code === 550) {
          // 550 = no such file: already removed out-of-band. Treat as done and
          // drop it from the baseline so it stops reappearing in the queue.
          delete next[k];
          console.log(`  ✕ ${k} (already gone remotely)`);
        } else {
          console.log(`  ! could not delete ${k}: ${e.message}`);
        }
      }
    }
    // Prune directories emptied by those deletions (deepest first), so a removed
    // page doesn't leave a bare dir behind that the server lists. removeEmptyDir
    // only removes truly-empty dirs, so dirs with other content are left alone.
    const dirs = new Set();
    for (const k of removed) {
      let d = posix.dirname(posix.join(REMOTE_ROOT, k));
      while (d.length > REMOTE_ROOT.length && d.startsWith(REMOTE_ROOT)) {
        dirs.add(d);
        d = posix.dirname(d);
      }
    }
    for (const d of [...dirs].sort((a, b) => b.split("/").length - a.split("/").length)) {
      try { await client.removeEmptyDir(d); console.log(`  ✕ (dir) ${d}`); }
      catch { /* not empty or already gone — leave it */ }
    }
  }

  writeState(next);
  console.log(`\n  done: ${done} uploaded${DELETE ? `, ${removed.length} removed` : ""}. Baseline updated.\n`);
} catch (e) {
  // Persist whatever we managed to upload so a retry only sends the rest.
  writeState(next);
  fail(`FTP error: ${e.message}\n  (partial progress saved to .deploy-state.json — re-run to resume.)`);
} finally {
  client.close();
}
