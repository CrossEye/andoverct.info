#!/usr/bin/env node
/**
 * preview.mjs — start/stop the local Apache preview of the site.
 *
 *   npm run preview          start Apache (if needed) and open the browser
 *   npm run preview:stop     stop Apache
 *   node _build/preview.mjs --status
 *
 * Serves the working tree at http://andoverct.local/ via a local Apache 2.4
 * + PHP 7.0.33 (FastCGI) install under C:\Users\scott\Dev\servers — see
 * _build/server-env.md for how that mirrors production. Apache runs in
 * console mode (no Windows service, no elevation); stop is a process kill,
 * which is safe here — nothing stateful is in flight on a dev preview.
 * .htaccess edits apply per-request; only httpd.conf/vhost changes need a
 * restart (npm run preview:stop && npm run preview).
 */

import { spawn, execSync } from "node:child_process";

const HTTPD = "C:/Users/scott/Dev/servers/Apache24/bin/httpd.exe";
const URL = "http://andoverct.local/";

const arg = process.argv[2] || "--start";

function running() {
  const out = execSync('tasklist /FI "IMAGENAME eq httpd.exe" /FO CSV /NH', { encoding: "utf8" });
  return out.includes("httpd.exe");
}

if (arg === "--status") {
  console.log(running() ? `running — ${URL}` : "not running");
} else if (arg === "--stop") {
  if (!running()) {
    console.log("not running");
  } else {
    execSync("taskkill /IM httpd.exe /F", { stdio: "ignore" });
    console.log("stopped");
  }
} else {
  if (running()) {
    console.log(`already running — ${URL}`);
  } else {
    spawn(HTTPD, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    console.log(`started — ${URL}`);
  }
  if (arg === "--open") {
    spawn("cmd", ["/c", "start", "", URL], { detached: true, stdio: "ignore" }).unref();
  }
}
