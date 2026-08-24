#!/usr/bin/env node
/*
 * Distributes the canonical footer CSS (_build/footer.css) into every stylesheet
 * that styles .page-footer, replacing the content between the `@footer-css`
 * markers. The footer string lives in footer.json; the footer CSS lives here;
 * this keeps the five copies from drifting (plan 006).
 *
 *   npm run sync:footer-css            # write
 *   npm run sync:footer-css -- --check # verify in sync (non-zero exit if not)
 *
 * Every target must already contain a `/* @footer-css:start *\/ ... `
 * `/* @footer-css:end *\/` pair (CSS comments — valid in .css and inside a
 * <style> in .html). Per-surface extras (colours, body.dark overrides) stay
 * outside the markers and are untouched.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CHECK = process.argv.includes("--check");

const TARGETS = [
  "style.css",
  "_build/base.css",
  "town-charter/style.css",
  "the-facts/_build/template.html",
  "series/town-asset/explanation/index.html",
  "_build/templates/weir-votes.html",
];

const rules = readFileSync(join(ROOT, "_build/footer.css"), "utf8")
  .replace(/^\/\*[\s\S]*?\*\/\s*/, "") // drop the leading doc comment
  .trim();

const block =
  "/* @footer-css:start — generated from _build/footer.css; do not edit here, run: npm run sync:footer-css */\n" +
  rules +
  "\n/* @footer-css:end */";

const MARKER_RE = /\/\* @footer-css:start[\s\S]*?@footer-css:end \*\//;

let changed = 0;
let drift = 0;
for (const rel of TARGETS) {
  const path = join(ROOT, rel);
  const src = readFileSync(path, "utf8");
  if (!MARKER_RE.test(src)) {
    console.error(`  MISSING markers: ${rel} — add /* @footer-css:start */ .. /* @footer-css:end */`);
    process.exitCode = 1;
    continue;
  }
  const next = src.replace(MARKER_RE, block);
  if (next === src) {
    console.log(`  in sync   ${rel}`);
  } else if (CHECK) {
    console.error(`  OUT OF SYNC ${rel}`);
    drift++;
  } else {
    writeFileSync(path, next);
    console.log(`  synced    ${rel}`);
    changed++;
  }
}

if (CHECK && drift) {
  console.error(`\nfooter CSS drift in ${drift} file(s) — run: npm run sync:footer-css`);
  process.exit(1);
}
console.log(CHECK ? "\nfooter CSS: all in sync." : `\nfooter CSS: ${changed} file(s) updated.`);
