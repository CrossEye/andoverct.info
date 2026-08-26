#!/usr/bin/env node
//
// Drift check: every .htaccess that turns on mod_rewrite must carry the
// scheme-correcting directory redirect.
//
// Why this can drift silently
// ---------------------------
// TLS is terminated by the SSL front end, which proxies to Apache over plain
// HTTP and sends no protocol signal at all (probed 2026-08-26: no
// X-Forwarded-Proto, no X-Forwarded-Ssl, no Front-End-Https, HTTPS=off,
// SERVER_PORT=80). Any redirect Apache builds for itself therefore comes out
// as http:// — including mod_dir's trailing-slash redirect for a directory
// request. Browsers and curl quietly follow the extra hop back up to https, so
// the bug is invisible in normal use; strict clients refuse it and report "too
// many redirects", which is how /reports became unreadable to Anthropic's web
// fetcher while curl kept working.
//
// The document root fixes this by emitting the trailing-slash redirect itself
// with an explicit https:// target. But a per-directory .htaccess that declares
// `RewriteEngine On` does NOT inherit the root's rewrite ruleset, so each such
// directory needs its own copy — and a new subsection added months from now
// will silently regress unless something checks. That something is this file.
//
// Usage:  npm run check:htaccess        (exit 1 on failure)
//
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".git", ".meta"]);
const LIVE_HOST = "andoverct.info";

async function findHtaccess(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) await findHtaccess(join(dir, entry.name), out);
    } else if (entry.name === ".htaccess") {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

// Strip comments so a rule quoted in a comment block never counts as present.
const live = (text) =>
  text
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

// The redirect's signature, independent of how the target path is spelled:
// a -d test (this request names a directory) reached by a RewriteRule whose
// target is an absolute https URL on the live host. The root writes the target
// as /$1/, the children as %{REQUEST_URI}/; both are fine.
function hasDirectoryRedirect(text) {
  const lines = live(text).split("\n");
  let sawDirTest = false;
  for (const line of lines) {
    if (/^\s*RewriteCond\s+%\{REQUEST_FILENAME\}\s+-d\b/i.test(line)) {
      sawDirTest = true;
      continue;
    }
    if (/^\s*RewriteRule\b/i.test(line)) {
      if (
        sawDirTest &&
        new RegExp(`https://${LIVE_HOST.replace(/\./g, "\\.")}`, "i").test(line) &&
        /\[[^\]]*R=301[^\]]*\]/i.test(line)
      ) {
        return true;
      }
      sawDirTest = false; // conditions bind only to the rule that follows them
    }
  }
  return false;
}

// Advisory: a redirect whose target has no scheme is built relative to what
// Apache believes it is serving, i.e. http. That is correct only when the rule
// is scoped away from the live host (the plain-http dev box legitimately wants
// Apache's default behaviour).
//
// A deliberately scheme-less rule can silence this by carrying
//   # htaccess-check: allow-relative
// in the comment block above it. Runs on raw lines, not the comment-stripped
// text, so the pragma is visible.
const ALLOW_RELATIVE = /^\s*#\s*htaccess-check:\s*allow-relative\b/i;

// A whole file can opt out with `# htaccess-check: exempt — why`. Used by the
// deliberately-unfixed /temp diagnostic, which has to reproduce the bug for the
// host's support team. Exemptions are reported, not silently skipped, so an
// abandoned one stays visible.
const EXEMPT = /^\s*#\s*htaccess-check:\s*exempt\b[\s—:-]*(.*)$/im;

function relativeRedirects(text) {
  const found = [];
  let hostScoped = false;
  let allowed = false;
  text.split(/\r?\n/).forEach((line, i) => {
    if (ALLOW_RELATIVE.test(line)) {
      allowed = true;
      return;
    }
    if (/^\s*#/.test(line) || !line.trim()) return; // comments/blanks keep the pragma alive
    if (/^\s*RewriteCond\s+%\{HTTP_HOST\}/i.test(line)) {
      hostScoped = true;
      return;
    }
    if (/^\s*RewriteCond\b/i.test(line)) return; // other conds don't clear the scoping
    if (/^\s*RewriteRule\b/i.test(line)) {
      const isRedirect = /\[[^\]]*R=30\d[^\]]*\]/i.test(line);
      const absolute = /https?:\/\//i.test(line);
      if (isRedirect && !absolute && !hostScoped && !allowed) {
        found.push({ line: i + 1, text: line.trim() });
      }
      hostScoped = false;
      allowed = false;
      return;
    }
    allowed = false; // any other directive ends the pragma's reach
  });
  return found;
}

const files = (await findHtaccess(ROOT)).sort();
let failures = 0;
let warnings = 0;
let exemptions = 0;

console.log(`\n  Checking ${files.length} .htaccess file(s) for the https redirect rule\n`);

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join("/");
  const text = readFileSync(file, "utf-8");
  const rewrites = /^\s*RewriteEngine\s+On\b/im.test(live(text));

  if (!rewrites) {
    console.log(`  ·  ${rel}  — no RewriteEngine, inherits the root ruleset`);
    continue;
  }

  const exempt = text.match(EXEMPT);
  if (exempt) {
    exemptions++;
    console.log(`  ~  ${rel}  — EXEMPT: ${exempt[1].trim() || "no reason given"}`);
    continue;
  }

  if (hasDirectoryRedirect(text)) {
    console.log(`  ok ${rel}`);
  } else {
    failures++;
    console.log(`  ✗  ${rel}  — declares RewriteEngine On but has no https directory redirect`);
  }

  for (const r of relativeRedirects(text)) {
    warnings++;
    console.log(`     ! line ${r.line}: redirect with no scheme, not scoped to a host`);
    console.log(`       ${r.text}`);
  }
}

if (failures) {
  console.log(`
  ${failures} file(s) missing the rule. Because a directory that declares
  RewriteEngine On does not inherit the document root's rewrite ruleset, each
  needs its own copy:

      RewriteCond %{HTTP_HOST} ^${LIVE_HOST.replace(/\./g, "\\.")}$ [NC]
      RewriteCond %{REQUEST_FILENAME} -d
      RewriteCond %{REQUEST_URI} !/$
      RewriteRule ^ https://${LIVE_HOST}%{REQUEST_URI}/ [R=301,L]

  Use %{REQUEST_URI} rather than a captured path: in a per-directory context
  the match is relative to that directory, and empty for the directory itself.
`);
} else {
  console.log(`\n  All rewrite-enabled .htaccess files carry the rule.\n`);
}

if (exemptions) {
  console.log(`  ${exemptions} file(s) exempt by declaration. An exemption is a standing promise that
  the directory is meant to behave differently; if the reason no longer holds,
  delete the pragma (or the directory) rather than leaving it.
`);
}

if (warnings) {
  console.log(`  ${warnings} advisory warning(s): a scheme-less redirect resolves to http here.
  That is correct only for rules deliberately scoped to the dev host; if the
  rule can fire on ${LIVE_HOST}, give it an absolute https:// target.\n`);
}

process.exit(failures ? 1 : 0);
