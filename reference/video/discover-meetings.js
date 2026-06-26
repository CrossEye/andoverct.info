#!/usr/bin/env node
/*
 * discover-meetings.js — populate meetings.json from live sources.
 *
 * Replaces the hand-maintained meeting list with discovery from the two places
 * the recordings actually come from:
 *
 *   - YouTube: enumerate the Town of Andover channel's uploads + past streams
 *     via yt-dlp, and add any videos not already listed.
 *   - BOE: scrape the Andover Elementary "Agendas, Minutes & Recordings" page
 *     for Zoom recording share links AND their passcodes, and add new ones.
 *
 * It is NON-DESTRUCTIVE: it only adds meetings whose YouTube id / Zoom
 * share-token isn't already in meetings.json; existing entries are never
 * modified. The whole list is kept sorted newest-first by date on every run,
 * so an entry lands in the right place no matter when it's discovered.
 *
 *   node discover-meetings.js            # discover both, write meetings.json
 *   node discover-meetings.js --dry-run  # report what WOULD be added; write nothing
 *   node discover-meetings.js --youtube  # only the YouTube channel
 *   node discover-meetings.js --boe      # only the BOE page
 *
 * BOE passcodes are scraped from hand-edited HTML, so each new BOE entry is
 * printed for review; a bad passcode just means the Deepgram step can't open
 * that recording (it fails loudly), so it's self-checking.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

const ROOT = __dirname;
const BIN_DIR = path.join(ROOT, "bin");
const YT_DLP = path.join(BIN_DIR, "yt-dlp.exe");
const MEETINGS_FILE = path.join(ROOT, "meetings.json");

const CHANNEL_URL = "https://www.youtube.com/@townofandoverct7881";
const BOE_PAGE_URL = "https://www.andoverelementaryct.org/index.php/boe/agendas-minutes-recordings";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run") || argv.includes("-n");
const doYouTube = !argv.includes("--boe");
const doBOE = !argv.includes("--youtube");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function ensureYtDlp() {
  if (!fs.existsSync(YT_DLP)) {
    console.log("Downloading yt-dlp...");
    const { YTDLP } = require("yt-dlp-node");
    await YTDLP.downloadYTDLP({ dst: BIN_DIR });
  }
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'");
}

function safeDecodeURI(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// The Zoom share token uniquely identifies a recording; use it as the dedup key.
function zoomToken(link) {
  if (!link) return null;
  for (const s of [link, safeDecodeURI(link)]) {
    const m = s.match(/rec\/share\/([A-Za-z0-9._-]+)/);
    if (m) return m[1];
  }
  return null;
}

// "M.D.YY" / "MM.DD.YYYY" (also with / separators) -> "YYYY-MM-DD"
function parseDate(text) {
  const m = text.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);
  if (!m) return null;
  let [, mo, d, y] = m;
  if (y.length === 2) y = "20" + y;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// YouTube discovery
// ---------------------------------------------------------------------------
async function discoverYouTube(existingYtIds) {
  await ensureYtDlp();

  // Scan recent uploads + past streams (newest-first). Capped for speed, since
  // new meetings are always at the top; pass --all to enumerate the whole channel.
  const limit = argv.includes("--all") ? [] : ["--playlist-end", "60"];
  const channelVideos = new Map(); // id -> title (which includes the meeting date)
  for (const tab of ["videos"]) {
    try {
      const { stdout } = await execFileAsync(
        YT_DLP,
        ["--flat-playlist", ...limit, "--print", "%(id)s\t%(title)s", `${CHANNEL_URL}/${tab}`],
        { maxBuffer: 64 * 1024 * 1024 }
      );
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const t = line.indexOf("\t");
        const id = t === -1 ? line : line.slice(0, t);
        const title = t === -1 ? "" : line.slice(t + 1);
        if (id && !channelVideos.has(id)) channelVideos.set(id, title);
      }
    } catch (e) {
      console.error(`  yt-dlp ${tab} listing failed: ${(e.stderr || e.message || "").trim()}`);
    }
  }

  const newIds = [...channelVideos.keys()].filter((id) => !existingYtIds.has(id));
  console.log(`YouTube: ${channelVideos.size} scanned, ${newIds.length} new`);

  const entries = [];
  for (const id of newIds) {
    const rawTitle = channelVideos.get(id);
    // The channel titles carry the meeting date ("... 6.17.26"); parse it and
    // strip it from the display name to match the existing entries' convention.
    let date = parseDate(rawTitle) || "";
    let meeting = rawTitle.replace(/\s*\b\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}\b\s*$/, "").trim() || rawTitle;
    if (!date) {
      // Title had no parseable date — fall back to the upload date.
      try {
        const { stdout } = await execFileAsync(
          YT_DLP,
          ["--print", "%(upload_date)s", `https://www.youtube.com/watch?v=${id}`],
          { maxBuffer: 8 * 1024 * 1024 }
        );
        const ud = stdout.trim();
        if (/^\d{8}$/.test(ud)) date = `${ud.slice(0, 4)}-${ud.slice(4, 6)}-${ud.slice(6, 8)}`;
      } catch (e) {
        console.error(`  [${id}] upload_date fetch failed: ${(e.stderr || e.message || "").trim()}`);
      }
    }
    entries.push({ id, date, meeting, link: `https://www.youtube.com/watch?v=${id}`, type: "YouTube" });
    console.log(`  + YouTube ${date || "????-??-??"}  ${meeting}  (${id})`);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// BOE (Zoom) discovery — scrape the AES recordings page
// ---------------------------------------------------------------------------
async function discoverBOE(existingTokens, usedIds) {
  let html;
  try {
    const res = await fetch(BOE_PAGE_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) { console.error(`  BOE page fetch failed: HTTP ${res.status}`); return []; }
    html = await res.text();
  } catch (e) {
    console.error(`  BOE page fetch failed: ${e.message}`);
    return [];
  }

  // Each meeting: <a href="...zoom.us/rec/share/TOKEN...">Title M.D.YY</a> [text] Passcode: CODE
  const re = /<a\b[^>]*href="([^"]*zoom\.us\/rec\/share\/[^"]+)"[^>]*>(.*?)<\/a>([^<]*)/gis;
  const entries = [];
  let m;
  while ((m = re.exec(html))) {
    const token = zoomToken(decodeEntities(m[1]));
    if (!token || existingTokens.has(token)) continue;

    const title = decodeEntities(m[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    const after = decodeEntities(m[3]);

    // Passcode: prefer the text after the link; fall back to one glued into the href.
    let passcode = "";
    const fromText = after.match(/Passcode\s*:?\s*([^\s<]+)/i);
    if (fromText) passcode = fromText[1];
    else {
      // Passcode crammed into the href (after a startTime param), e.g.
      //   ...?startTime=...%20Passcode:%20&amp;b0%8M9u
      // Decode entities (&amp;->&) but NOT %-escapes (passcodes contain a literal
      // %); skip the encoded/real space separator(s) after the label, then take
      // the rest verbatim up to the next space/quote (passcodes may contain &/%).
      const fromHref = decodeEntities(m[1]).match(/Passcode\s*:?\s*(?:%20|\s)*([^\s"]+)/i);
      if (fromHref) passcode = fromHref[1];
    }

    const date = parseDate(title);
    let id = date ? `boe-${date}` : `boe-${token.slice(0, 10)}`;
    for (let n = 2; usedIds.has(id); n++) id = `boe-${date || token.slice(0, 10)}-${n}`;
    usedIds.add(id);

    entries.push({ id, date: date || "", meeting: title, link: `https://us02web.zoom.us/rec/share/${token}`, passcode, type: "Zoom" });
    existingTokens.add(token);
    console.log(`  + BOE ${date || "????-??-??"}  ${title}  | passcode: ${passcode || "(NONE PARSED)"}`);
  }
  console.log(`BOE: ${entries.length} new`);
  return entries;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const meetings = JSON.parse(fs.readFileSync(MEETINGS_FILE, "utf-8"));
  const ytIds = new Set(meetings.filter((m) => m.type === "YouTube").map((m) => m.id));
  const allIds = new Set(meetings.map((m) => m.id));
  const zoomTokens = new Set(meetings.map((m) => zoomToken(m.link)).filter(Boolean));

  const added = [];
  if (doYouTube) added.push(...(await discoverYouTube(ytIds)));
  if (doBOE) added.push(...(await discoverBOE(zoomTokens, allIds)));

  if (!added.length) {
    console.log("\nNothing new to add.");
    return;
  }

  const needsReview = added.filter((e) => !e.date || (e.type === "Zoom" && !e.passcode));
  if (needsReview.length) {
    console.log(`\n  ⚠ ${needsReview.length} entr${needsReview.length > 1 ? "ies" : "y"} need a look (missing date or passcode):`);
    for (const e of needsReview) console.log(`     ${e.id}  date="${e.date}" passcode="${e.passcode || ""}"  ${e.meeting}`);
  }

  if (DRY) {
    console.log(`\n[dry-run] would add ${added.length} meeting(s); meetings.json unchanged.`);
    return;
  }

  // Keep the whole list sorted newest-first so every entry sits in date order
  // (stable, so same-date meetings keep their relative order).
  const merged = [...added, ...meetings].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  fs.writeFileSync(MEETINGS_FILE, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nAdded ${added.length} meeting(s) to meetings.json.`);
  console.log(`Next: review the additions above (especially BOE passcodes), then run`);
  console.log(`  npm run rebuild:videos      # YouTube transcripts`);
  console.log(`  npm run rebuild:videos:boe  # BOE (Zoom) transcripts`);
  console.log(`then 'npm run deploy:go' to publish.`);
})();
