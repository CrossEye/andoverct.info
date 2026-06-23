// Downloads transcripts for Andover town meetings.
//
// YouTube meetings: downloads auto-generated VTT subtitles via yt-dlp
// Zoom meetings:    downloads recording via Playwright, extracts audio
//                   with ffmpeg, transcribes with OpenAI Whisper
//
// Prerequisites:
//   npm install          (installs yt-dlp-node)
//   npm install playwright  (for Zoom recordings)
//   pip install openai-whisper  (Python 3.12, for Zoom recordings)
//   ffmpeg               (for Zoom recordings)
//
// Usage:
//   node download-transcripts.js
//
// Environment variables:
//   REBUILD=all    — re-download everything and rebuild all HTML
//   REBUILD=html   — keep existing VTTs, regenerate all HTML + index
//   REBUILD=index  — regenerate only the index page
//   WHISPER_MODEL  — whisper model size (default: "base")
//   HEADLESS       — set to "false" to see the Zoom browser (default: true)
//
// Flags:
//   --since YYYY-MM-DD  — only process meetings on or after this date

const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");

const execFileAsync = promisify(execFile);

const BIN_DIR = path.join(__dirname, "bin");
const YT_DLP = path.join(BIN_DIR, "yt-dlp.exe");
const OUTPUT_DIR = path.join(__dirname, "output");
const VTT_DIR = path.join(OUTPUT_DIR, "vtt");
const TRANSCRIPTS_DIR = path.join(OUTPUT_DIR, "transcripts");
const VIDEO_DIR = path.join(OUTPUT_DIR, "video");
const MEETINGS_FILE = path.join(__dirname, "meetings.json");

const REBUILD = (process.env.REBUILD || "").toLowerCase();
const WHISPER_MODEL = process.env.WHISPER_MODEL || "base";
const HEADLESS = process.env.HEADLESS !== "false";
const YT_CONCURRENCY = 3;

// --since YYYY-MM-DD flag: only process meetings on or after this date
const sinceIdx = process.argv.indexOf("--since");
const SINCE = sinceIdx !== -1 && process.argv[sinceIdx + 1] ? process.argv[sinceIdx + 1] : null;

// ---------------------------------------------------------------------------
// Tool discovery (ffmpeg, Python 3.12, yt-dlp)
// ---------------------------------------------------------------------------

function findFFmpeg() {
  try {
    require("child_process").execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return "ffmpeg";
  } catch {}
  const base = path.join(process.env.LOCALAPPDATA || "", "Microsoft/WinGet/Packages");
  try {
    const dirs = fs.readdirSync(base).filter(d => d.startsWith("Gyan.FFmpeg"));
    for (const d of dirs) {
      const found = findFileRecursive(path.join(base, d), "ffmpeg.exe");
      if (found) return found;
    }
  } catch {}
  return "ffmpeg";
}

function findFileRecursive(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === name) return path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(path.join(dir, entry.name), name);
      if (found) return found;
    }
  }
  return null;
}

function findPython312() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Programs/Python/Python312/python.exe"),
    "py",
    "python3.12",
    "python",
  ];
  for (const c of candidates) {
    try {
      require("child_process").execFileSync(c, ["--version"], { stdio: "ignore" });
      return c;
    } catch {}
  }
  return "python";
}

const FFMPEG = findFFmpeg();
const PYTHON312 = findPython312();

// ---------------------------------------------------------------------------
// YouTube: download VTT via yt-dlp
// ---------------------------------------------------------------------------

async function ensureYtDlp() {
  if (!fs.existsSync(YT_DLP)) {
    console.log("Downloading yt-dlp...");
    const { YTDLP } = require("yt-dlp-node");
    await YTDLP.downloadYTDLP({ dst: BIN_DIR });
  }
}

async function downloadYouTubeVtt(id, link) {
  const outTemplate = path.join(VTT_DIR, `${id}.%(ext)s`);
  try {
    const args = [
      "--write-auto-sub",
      "--sub-lang", "en",
      "--sub-format", "vtt",
      "--skip-download",
      "-o", outTemplate,
      link,
    ];
    if (REBUILD !== "all") args.splice(5, 0, "--no-overwrites");
    const { stdout } = await execFileAsync(YT_DLP, args);
    if (stdout) console.log(stdout.trim());
    return true;
  } catch (err) {
    console.error(`[${id}] Error: ${err.stderr || err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Zoom: download recording via Playwright
// ---------------------------------------------------------------------------

async function downloadFromZoom(meeting) {
  const videoPath = path.join(VIDEO_DIR, `${meeting.id}.mp4`);
  if (REBUILD !== "all" && fs.existsSync(videoPath)) {
    console.log(`  [skip] Video already downloaded`);
    return videoPath;
  }

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  let videoUrl = null;
  page.on("response", (response) => {
    const url = response.url();
    if (
      (url.includes(".mp4") || url.includes("rec/play")) &&
      response.status() === 200 &&
      !url.includes("telemetry")
    ) {
      videoUrl = url;
    }
  });

  try {
    console.log(`  [browser] Navigating to Zoom recording...`);
    await page.goto(meeting.link, { waitUntil: "networkidle", timeout: 30000 });

    const passcodeInput = await page.$("#passcode");
    if (passcodeInput) {
      console.log(`  [browser] Entering passcode...`);
      await passcodeInput.fill(meeting.passcode);
      const submitBtn =
        (await page.$('button[type="submit"]')) ||
        (await page.$("button.submit")) ||
        (await page.$('#passcode_btn'));
      if (submitBtn) await submitBtn.click();
      await page.waitForLoadState("networkidle", { timeout: 30000 });
    }

    console.log(`  [browser] Waiting for video player...`);
    await page.waitForTimeout(5000);

    const downloadBtn =
      (await page.$('button[aria-label="Download"]')) ||
      (await page.$('a[aria-label="Download"]')) ||
      (await page.$(".download-btn")) ||
      (await page.$('button:has-text("Download")'));

    if (downloadBtn) {
      console.log(`  [browser] Found download button, initiating download...`);
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 120000 }),
        downloadBtn.click(),
      ]);
      await download.saveAs(videoPath);
      console.log(`  [download] Saved to ${videoPath}`);
    } else if (videoUrl) {
      console.log(`  [browser] No download button, using captured video URL...`);
      await browser.close();
      await downloadFile(videoUrl, videoPath);
      return videoPath;
    } else {
      console.log(`  [browser] Searching for video source in page...`);
      const src = await page.evaluate(() => {
        const video = document.querySelector("video");
        if (video) return video.src || video.querySelector("source")?.src;
        const player = document.querySelector("#vjs_video_3_html5_api");
        if (player) return player.src;
        return null;
      });
      if (src) {
        console.log(`  [browser] Found video source URL`);
        await browser.close();
        await downloadFile(src, videoPath);
        return videoPath;
      }
      console.error(`  [error] Could not find video URL. Try HEADLESS=false to debug.`);
      await browser.close();
      return null;
    }

    await browser.close();
    return videoPath;
  } catch (err) {
    console.error(`  [error] Browser error: ${err.message}`);
    await browser.close();
    return null;
  }
}

function downloadFile(url, dst) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(dst);
    let totalBytes = 0;
    let receivedBytes = 0;

    proto
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlinkSync(dst);
          return resolve(downloadFile(response.headers.location, dst));
        }
        totalBytes = parseInt(response.headers["content-length"] || "0", 10);
        response.on("data", (chunk) => {
          receivedBytes += chunk.length;
          if (totalBytes > 0) {
            const pct = ((receivedBytes / totalBytes) * 100).toFixed(1);
            process.stdout.write(`\r  [download] ${pct}% (${(receivedBytes / 1048576).toFixed(1)} MB)`);
          }
        });
        response.pipe(file);
        file.on("finish", () => { file.close(); console.log(`\n  [download] Complete: ${dst}`); resolve(); });
      })
      .on("error", (err) => { fs.unlink(dst, () => {}); reject(err); });
  });
}

// ---------------------------------------------------------------------------
// Audio extraction (ffmpeg) & Whisper transcription
// ---------------------------------------------------------------------------

async function extractAudio(videoPath, audioPath) {
  if (fs.existsSync(audioPath)) {
    console.log(`  [skip] Audio already extracted`);
    return;
  }
  console.log(`  [ffmpeg] Extracting audio...`);
  await execFileAsync(FFMPEG, [
    "-i", videoPath,
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    "-y",
    audioPath,
  ], { timeout: 600000 });
  console.log(`  [ffmpeg] Audio saved to ${audioPath}`);
}

async function transcribeWithWhisper(audioPath, vttPath) {
  if (REBUILD !== "all" && fs.existsSync(vttPath)) {
    console.log(`  [skip] VTT already exists`);
    return;
  }
  console.log(`  [whisper] Transcribing with model "${WHISPER_MODEL}"...`);

  const outDir = path.dirname(vttPath);
  const baseName = path.basename(audioPath, path.extname(audioPath));

  await new Promise((resolve, reject) => {
    const ffmpegDir = path.dirname(FFMPEG);
    const env = { ...process.env };
    if (ffmpegDir !== ".") {
      env.PATH = ffmpegDir + path.delimiter + (env.PATH || "");
    }

    const proc = spawn(PYTHON312, [
      "-m", "whisper",
      audioPath,
      "--model", WHISPER_MODEL,
      "--output_format", "vtt",
      "--output_dir", outDir,
      "--language", "en",
      "--verbose", "False",
    ], { stdio: ["ignore", "pipe", "pipe"], env });

    proc.stdout.on("data", (d) => process.stdout.write(d));
    proc.stderr.on("data", (d) => process.stderr.write(d));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Whisper exited with code ${code}`));
    });
    proc.on("error", reject);
  });

  const whisperOutput = path.join(outDir, `${baseName}.vtt`);
  if (whisperOutput !== vttPath && fs.existsSync(whisperOutput)) {
    fs.renameSync(whisperOutput, vttPath);
  }
  console.log(`  [whisper] Transcript saved to ${vttPath}`);
}

// ---------------------------------------------------------------------------
// VTT parsing — YouTube (with dedup, speaker changes, filler removal)
// ---------------------------------------------------------------------------

const FILLER_RE = /\b(?:um|uh|uh+|uhh+|umm+|er|err+|ah|ahh+|hmm+|hm+|mhm+|mm+)\b[,.]?\s*/gi;
function removeFiller(text) {
  return text.replace(FILLER_RE, "").replace(/\s{2,}/g, " ").trim();
}

function parseYouTubeVtt(vttText) {
  const cues = [];
  const blocks = vttText.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const timingIdx = lines.findIndex((l) => l.includes(" --> "));
    if (timingIdx === -1) continue;
    const startStr = lines[timingIdx].split(" --> ")[0].trim();
    const raw = lines
      .slice(timingIdx + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&")
      .trim();
    const segments = raw.split(/\s*>>\s*/);
    for (let si = 0; si < segments.length; si++) {
      const cleaned = removeFiller(segments[si]);
      if (!cleaned) continue;
      cues.push({
        start: startStr,
        seconds: vttTimeToSeconds(startStr),
        text: cleaned,
        speakerChange: si > 0,
      });
    }
  }
  return cues;
}

function dedupeCues(cues) {
  if (cues.length === 0) return cues;

  const kept = [];
  for (let i = 0; i < cues.length; i++) {
    const cur = cues[i].text;
    const next = i + 1 < cues.length ? cues[i + 1].text : null;
    if (next && next.includes(cur)) {
      if (cues[i].speakerChange) cues[i + 1].speakerChange = true;
      continue;
    }
    kept.push(cues[i]);
  }

  const result = [];
  for (let i = 0; i < kept.length; i++) {
    if (i === 0) { result.push(kept[i]); continue; }
    const prev = kept[i - 1].text;
    let text = kept[i].text;
    const maxOverlap = Math.min(prev.length, text.length);
    let overlap = 0;
    for (let len = maxOverlap; len > 0; len--) {
      if (text.startsWith(prev.slice(-len))) { overlap = len; break; }
    }
    if (overlap > 0) text = text.slice(overlap).trim();
    if (text) {
      result.push({ ...kept[i], text });
    } else if (kept[i].speakerChange && result.length > 0) {
      result[result.length - 1].speakerChange = true;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// VTT parsing — Whisper (clean cues, no dedup needed)
// ---------------------------------------------------------------------------

function parseWhisperVtt(vttText) {
  const cues = [];
  const blocks = vttText.split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const timingIdx = lines.findIndex((l) => l.includes(" --> "));
    if (timingIdx === -1) continue;
    const startStr = lines[timingIdx].split(" --> ")[0].trim();
    let text = lines
      .slice(timingIdx + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!text) continue;
    // A leading ">>" marks a speaker change (emitted by deepgramToVtt). Strip it
    // and flag the cue so buildParagraphs starts a new speaker-styled paragraph.
    let speakerChange = false;
    if (text.startsWith(">>")) {
      speakerChange = true;
      text = text.replace(/^>>\s*/, "").trim();
      if (!text) continue;
    }
    cues.push({ start: startStr, seconds: vttTimeToSeconds(startStr), text, speakerChange });
  }
  return cues;
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

function vttTimeToSeconds(timeStr) {
  const parts = timeStr.split(":");
  if (parts.length === 3) {
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  }
  return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
}

function formatTimestamp(timeStr) {
  const parts = timeStr.split(":");
  let h, m, s;
  if (parts.length === 3) {
    h = parseInt(parts[0]);
    m = parseInt(parts[1]);
    s = parseInt(parseFloat(parts[2]));
  } else {
    h = 0;
    m = parseInt(parts[0]);
    s = parseInt(parseFloat(parts[1]));
  }
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateLong(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// US short date, no leading zeros, 2-digit year: 2026-06-17 -> "6/17/26"
function formatDateShort(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}/${String(y).slice(-2)}`;
}

// ---------------------------------------------------------------------------
// Paragraph building (handles speaker changes when present)
// ---------------------------------------------------------------------------

function buildParagraphs(cues) {
  // First pass: split on speaker changes (YouTube cues have speakerChange flag)
  const speakerGroups = [];
  let current = [];
  for (const cue of cues) {
    if (cue.speakerChange && current.length > 0) {
      speakerGroups.push({ cues: current, isSpeakerChange: true });
      current = [];
    }
    current.push(cue);
  }
  if (current.length > 0) speakerGroups.push({ cues: current, isSpeakerChange: true });

  // Second pass: break long groups into ~200 word chunks at cue boundaries
  const TARGET = 200;
  const MIN = 100;
  const paragraphs = [];
  for (const group of speakerGroups) {
    let chunk = [];
    let words = 0;
    let threshold = TARGET + Math.floor((Math.random() - 0.5) * TARGET);
    if (threshold < MIN) threshold = MIN;

    for (const cue of group.cues) {
      const cueWords = cue.text.split(/\s+/).length;
      chunk.push(cue);
      words += cueWords;
      if (words >= threshold) {
        paragraphs.push({ cues: chunk, isSpeakerChange: group.isSpeakerChange });
        chunk = [];
        words = 0;
        group.isSpeakerChange = false;
        threshold = TARGET + Math.floor((Math.random() - 0.5) * TARGET);
        if (threshold < MIN) threshold = MIN;
      }
    }
    if (chunk.length > 0) {
      paragraphs.push({ cues: chunk, isSpeakerChange: group.isSpeakerChange });
    }
  }
  return paragraphs;
}

// ---------------------------------------------------------------------------
// VTT → HTML conversion (adapts to YouTube vs Zoom)
// ---------------------------------------------------------------------------

function convertVttToHtml(meeting, vttText) {
  const isZoom = meeting.type === "Zoom";

  // Parse and process cues based on type
  let cues;
  if (isZoom) {
    cues = parseWhisperVtt(vttText);
  } else {
    cues = dedupeCues(parseYouTubeVtt(vttText));
  }

  const paragraphs = buildParagraphs(cues);
  const videoUrl = meeting.link;

  // Assign time-based ids: t133, t133-1, t133-2, etc.
  const idCounts = {};
  const allCues = paragraphs.flatMap((p) => p.cues);
  for (const cue of allCues) {
    cue._t = Math.floor(cue.seconds);
    cue._label = formatTimestamp(cue.start);
    const key = cue._t;
    if (!(key in idCounts)) {
      idCounts[key] = 0;
      cue._id = `t${key}`;
    } else {
      idCounts[key]++;
      cue._id = `t${key}-${idCounts[key]}`;
    }
  }

  const paraHtml = paragraphs
    .map((para) => {
      const cues = para.cues;
      const firstLabel = cues[0]._label;
      const firstT = cues[0]._t;

      const spans = cues
        .map((cue) => `<span class="cue" id="${cue._id}" data-cue="${cue._id}" data-t="${cue._t}" data-label="${cue._label}">${escapeHtml(cue.text)}</span>`)
        .join(" ");

      const cls = para.isSpeakerChange ? "para speaker" : "para";
      return `      <div class="${cls}">
        <div class="timestamp" data-default-label="${firstLabel}" data-default-t="${firstT}">${firstLabel}</div>
        <div class="text">${spans}</div>
      </div>
      <div class="para-gap" aria-hidden="true">&nbsp;</div>`;
    })
    .join("\n");

  // Type-specific strings
  const videoLinkText = isZoom ? "Watch on Zoom" : "Watch on YouTube";
  const videoTarget = isZoom ? `target="_blank"` : `target="yt-meeting"`;
  const disclaimerSource = isZoom
    ? "This transcript was generated by OpenAI Whisper from a Zoom recording."
    : "This transcript was auto-generated by YouTube.";

  // Overlay buttons differ by type
  const overlayButtons = isZoom
    ? `${meeting.passcode ? `
        <button id="act-watch-zoom">
          <span class="icon">&#127909;</span>
          <span class="label">Watch on Zoom<br><span class="hint">Copies passcode to clipboard, then opens recording</span></span>
        </button>` : ''}
        <button id="act-copy-link">
          <span class="icon">&#128279;</span>
          <span class="label">Copy recording link<br><span class="hint" id="hint-link-url"></span></span>
        </button>
        <button id="act-bookmark">
          <span class="icon">&#128278;</span>
          <span class="label">Bookmark this spot<br><span class="hint">Copies link &amp; adds to navigation history</span></span>
        </button>`
    : `
        <button id="act-yt">
          <span class="icon">&#9654;</span>
          <span class="label">Watch on YouTube<br><span class="hint">Opens at this timestamp</span></span>
        </button>
        <button id="act-copy-link">
          <span class="icon">&#128279;</span>
          <span class="label">Copy YouTube link<br><span class="hint" id="hint-link-url"></span></span>
        </button>
        <button id="act-bookmark">
          <span class="icon">&#128278;</span>
          <span class="label">Bookmark this spot<br><span class="hint">Copies link &amp; adds to navigation history</span></span>
        </button>`;

  // Interaction JS is shared and externalized to
  // https://andoverct.info/reference/video/assets/transcripts.js — each page
  // only emits a small window.TX config (video URL, passcode, type) below.

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <title>${escapeHtml(meeting.meeting)} — ${formatDateLong(meeting.date)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://andoverct.info/style.css">
  <style>
    /* Transcript-specific components. Theme, palette, and page chrome
       (.page / .crumbs / .eyebrow / .title / .subtitle / footer.colophon)
       come from the shared style.css; these just use its variables. */
    .para { display: flex; gap: 1em; padding: 0.5em 0.75em; border-radius: 6px; }
    .para:nth-child(4n+1) { background: color-mix(in srgb, var(--ink) 4%, transparent); }
    .para-gap { font-size: 1px; line-height: 1px; height: 0; overflow: hidden; user-select: text; }
    .para.speaker { border-top: 1px solid var(--rule-soft); margin-top: 0.6em; padding-top: 1em; }
    .para.speaker:first-child { border-top: none; margin-top: 0; }

    .timestamp {
      flex: 0 0 5em; text-align: right;
      color: var(--ink-mute); font-family: var(--sans);
      font-size: 0.72rem; font-variant-numeric: tabular-nums; line-height: 1.9;
      cursor: pointer; white-space: nowrap; padding-top: 0.15em;
      transition: color 0.15s; user-select: none;
    }
    .timestamp:hover, .timestamp.hl { color: var(--accent); font-weight: 600; }

    .text { flex: 1; min-width: 0; }
    .cue { cursor: pointer; border-radius: 3px; transition: background-color 0.15s; }
    .cue.hl { background-color: var(--accent-bg); }
    @keyframes flash-highlight {
      0%   { background-color: rgba(232, 168, 0, 0.45); }
      100% { background-color: transparent; }
    }
    .cue.flash { animation: flash-highlight 4s ease-out forwards; }

    /* action dialog */
    #overlay { display: none; position: fixed; inset: 0; background: rgba(8, 22, 40, 0.5); z-index: 100; justify-content: center; align-items: center; }
    #overlay.visible { display: flex; }
    .dialog { background: var(--bg-card); border-radius: 10px; padding: 1.6rem 1.8rem; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28); max-width: 28rem; width: 90vw; border-top: 4px solid var(--accent); }
    .dialog-header { margin-bottom: 1.2em; }
    .dialog-title { font-family: var(--serif); font-size: 1.1rem; font-weight: 600; color: var(--ink); }
    .dialog-subtitle { font-family: var(--sans); font-size: 0.85rem; color: var(--ink-mute); margin-top: 0.2em; }
    .dialog .ts-label { color: var(--accent); font-weight: 600; }
    .dialog .actions { display: flex; flex-direction: column; gap: 0.5em; }
    .dialog button { display: flex; align-items: center; gap: 0.6em; padding: 0.6em 1em; border: 1px solid var(--rule); border-radius: 6px; background: transparent; color: var(--ink); cursor: pointer; font-family: var(--sans); font-size: 0.9rem; text-align: left; width: 100%; transition: background-color 0.12s, border-color 0.12s; }
    .dialog button:hover { background: var(--accent-bg); border-color: var(--accent); }
    .dialog button .icon { font-size: 1.1em; flex: 0 0 1.4em; text-align: center; }
    .dialog button .label { flex: 1; }
    .dialog button .hint { display: block; color: var(--ink-mute); font-size: 0.78rem; }
    .dialog .cancel { margin-top: 0.6em; text-align: center; }
    .dialog .cancel a { color: var(--ink-mute); font-family: var(--sans); font-size: 0.82rem; cursor: pointer; border-bottom: none; }
    .dialog .cancel a:hover { color: var(--accent); }

    /* toast */
    #toast { position: fixed; top: 1.5em; left: 50%; transform: translateX(-50%) translateY(-4em); background: var(--accent); color: #15233a; padding: 0.7em 1.6em; border-radius: 8px; font-family: var(--sans); font-size: 0.95rem; font-weight: 600; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25); opacity: 0; transition: transform 0.3s ease, opacity 0.3s ease; z-index: 200; pointer-events: none; text-align: center; max-width: 90vw; }
    #toast.visible { transform: translateX(-50%) translateY(0); opacity: 1; }

    @media (max-width: 480px) { .timestamp { flex-basis: 4em; } }
  </style>
</head>
<body class="bluegold">
  <div class="page-banner">
    <nav class="page-banner-inner crumbs">
      <a href="/">Home</a><span class="sep">›</span><a href="/reference/">Reference</a><span class="sep">›</span><a href="../index.html">Video</a><span class="sep">›</span><span class="current">${escapeHtml(meeting.meeting)} (${formatDateShort(meeting.date)})</span>
    </nav>
  </div>
  <main class="page">
    <header>
      <p class="eyebrow">Meeting transcript</p>
      <h1 class="title">${escapeHtml(meeting.meeting)}</h1>
      <p class="subtitle">${formatDateLong(meeting.date)} &middot; <a href="${videoUrl}" ${videoTarget}${isZoom && meeting.passcode ? ' id="top-watch-zoom"' : ""}>${videoLinkText}</a></p>
    </header>

    <hr class="rule">

    <div class="transcript">
${paraHtml}
    </div>

    <footer class="colophon">
      <p><strong>About this transcript.</strong> ${disclaimerSource} Names, numbers, and other details may be inaccurate &mdash; please refer to the ${isZoom ? "recording" : "video"} for authoritative content.</p>
      <p>Part of <code>andoverct.info</code>, an independent civic-reference site &mdash; not an official site of the Town of Andover. Compiled by <a href="mailto:scott@sauyet.com">Scott Sauyet</a>.</p>
    </footer>
  </main>

  <div id="overlay">
    <div class="dialog">
      <div class="dialog-header">
        <div class="dialog-title">${escapeHtml(meeting.meeting)}</div>
        <div class="dialog-subtitle">${formatDateLong(meeting.date)} at <span class="ts-label" id="overlay-ts"></span></div>
      </div>
      <div class="actions">${overlayButtons}
      </div>
      <div class="cancel"><a id="act-cancel">Cancel</a></div>
    </div>
  </div>

  <div id="toast"></div>

  <script>window.TX = { video: ${JSON.stringify(videoUrl)}, passcode: ${JSON.stringify(meeting.passcode || '')}, type: ${JSON.stringify(meeting.type)} };</script>
  <script src="https://andoverct.info/reference/video/assets/transcripts.js"></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Index page
// ---------------------------------------------------------------------------

function generateIndex(meetings, transcriptFiles) {
  const hasAnyPasscode = meetings.some((m) => m.passcode);

  const rows = meetings
    .filter((m) => m.link)
    .map((m) => {
      const hasTranscript = transcriptFiles.some(
        (f) => f.startsWith(m.id) && f.endsWith(".html")
      );
      const transcriptCell = hasTranscript
        ? `<a href="transcripts/${m.id}.html">Read Transcript</a>`
        : `<span class="unavailable">Transcript unavailable</span>`;
      const videoLabel = m.type === "Zoom" ? "Watch Recording" : "Watch YouTube Video";
      const passcodeCell = hasAnyPasscode
        ? `<td class="col-passcode">${
            m.passcode
              ? `<span class="passcode">${escapeHtml(m.passcode)}</span> <button class="copy-btn" data-copy="${escapeHtml(m.passcode)}" title="Copy passcode">Copy</button>`
              : ""
          }</td>`
        : "";
      return `        <tr>
          <td class="col-date">${formatDateLong(m.date)}</td>
          <td>${escapeHtml(m.meeting)}</td>
          ${passcodeCell}
          <td class="col-link"><a href="${m.link}" target="_blank">${videoLabel}</a></td>
          <td class="col-link">${transcriptCell}</td>
        </tr>`;
    })
    .join("\n");

  const passcodeHeader = hasAnyPasscode ? `<th>Passcode</th>` : "";
  const passcodeStyles = hasAnyPasscode
    ? `
    .col-passcode { white-space: nowrap; }
    .passcode { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-weight: 600; font-size: 0.9rem; color: var(--ink); }
    .copy-btn { background: var(--accent); color: #15233a; border: none; border-radius: 4px; padding: 0.15em 0.55em; font-family: var(--sans); font-size: 0.72rem; font-weight: 600; cursor: pointer; margin-left: 0.4em; }
    .copy-btn:hover { filter: brightness(1.08); }
    .copy-btn.copied { background: #5fb37a; color: #08210f; }`
    : "";

  const copyScript = hasAnyPasscode
    ? `
  <script>
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".copy-btn");
      if (!btn) return;
      navigator.clipboard.writeText(btn.dataset.copy).then(() => {
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 1500);
      });
    });
  </script>`
    : "";

  // Disclaimer adapts to content
  const hasZoom = meetings.some((m) => m.type === "Zoom");
  const hasYouTube = meetings.some((m) => m.type === "YouTube");
  let disclaimerText;
  if (hasZoom && hasYouTube) {
    disclaimerText = "Transcripts were auto-generated by YouTube or OpenAI Whisper.";
  } else if (hasZoom) {
    disclaimerText = "Transcripts were generated by OpenAI Whisper from Zoom recordings.";
  } else {
    disclaimerText = "Transcripts were auto-generated by YouTube.";
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <title>Town Meeting Videos &amp; Transcripts — andoverct.info</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://andoverct.info/style.css">
  <style>
    /* The index is a wide data table, so widen the shared content measure for
       this page. Theme, palette, and chrome come from style.css (body.dark). */
    .page { max-width: 58rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
    thead th { font-family: var(--sans); font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-mute); font-weight: 600; text-align: left; padding: 0 1em 0.6em; border-bottom: 1px solid var(--rule); }
    tbody tr { transition: background-color 0.12s; }
    tbody tr:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); }
    td { padding: 0.6em 1em; border-bottom: 1px solid var(--rule-soft); color: var(--ink-soft); vertical-align: baseline; }
    .col-date { white-space: nowrap; color: var(--ink-mute); font-family: var(--sans); font-size: 0.85rem; width: 11em; }
    .col-link { white-space: nowrap; }
    .unavailable { color: var(--ink-mute); font-style: italic; font-size: 0.9em; opacity: 0.7; }
${passcodeStyles}

    @media (max-width: 600px) {
      thead { display: none; }
      table, tbody, tr, td { display: block; width: 100%; }
      tr { padding: 0.6em 0; border-bottom: 1px solid var(--rule-soft); }
      td { border: 0; padding: 0.15em 0; }
      .col-date { font-size: 0.95rem; color: var(--accent); }
    }
  </style>
</head>
<body class="dark">
  <main class="page">
    <nav class="crumbs">
      <a href="/">Home</a><span class="sep">›</span><a href="/reference/">Reference</a><span class="sep">›</span><span class="current">Video</span>
    </nav>

    <header>
      <p class="eyebrow">Reference</p>
      <h1 class="title">Town Meeting Videos &amp; Transcripts</h1>
      <p class="subtitle">Searchable, timestamped transcripts of Andover town and Board of Education meetings.</p>
      <p class="lede">Each meeting links to its source video or recording and, where available, a full transcript you can read, search, and link to at any moment.</p>
    </header>

    <hr class="rule">

    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Meeting</th>
          ${passcodeHeader}
          <th>Video</th>
          <th>Transcript</th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>

    <footer class="colophon">
      <p><strong>About these transcripts.</strong> ${disclaimerText} Names, numbers, and other details may be inaccurate &mdash; please refer to the videos for authoritative content.</p>
      <p>Part of <code>andoverct.info</code>, an independent civic-reference site &mdash; not an official site of the Town of Andover. Compiled by <a href="mailto:scott@sauyet.com">Scott Sauyet</a>.</p>
    </footer>
  </main>${copyScript}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const meetings = JSON.parse(fs.readFileSync(MEETINGS_FILE, "utf-8"));

  // REBUILD=index — just regenerate index and exit
  if (REBUILD === "index") {
    fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
    const transcriptFiles = fs.readdirSync(TRANSCRIPTS_DIR);
    fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), generateIndex(meetings, transcriptFiles));
    console.log("Generated index.html");
    return;
  }

  fs.mkdirSync(VTT_DIR, { recursive: true });
  fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  fs.mkdirSync(VIDEO_DIR, { recursive: true });

  const afterSince = (m) => !SINCE || m.date >= SINCE;
  const ytMeetings = meetings.filter((m) => m.type === "YouTube" && m.link && afterSince(m));
  const zoomMeetings = meetings.filter((m) => m.type === "Zoom" && m.link && afterSince(m));

  // --- YouTube pipeline ---
  if (ytMeetings.length > 0 && REBUILD !== "html") {
    await ensureYtDlp();
    let vttFiles = fs.readdirSync(VTT_DIR);
    const pending = REBUILD === "all"
      ? ytMeetings
      : ytMeetings.filter((m) => !vttFiles.some((f) => f.startsWith(m.id) && f.endsWith(".vtt")));

    console.log(`YouTube: ${ytMeetings.length} meetings, ${pending.length} transcripts to download`);

    let dlSuccess = 0, dlFail = 0;
    for (let i = 0; i < pending.length; i += YT_CONCURRENCY) {
      const batch = pending.slice(i, i + YT_CONCURRENCY);
      const results = await Promise.all(
        batch.map((m) => {
          console.log(`[${m.id}] Downloading: ${m.date} - ${m.meeting}`);
          return downloadYouTubeVtt(m.id, m.link);
        })
      );
      results.forEach((ok) => (ok ? dlSuccess++ : dlFail++));
    }
    console.log(`YouTube downloads: ${dlSuccess} succeeded, ${dlFail} failed.\n`);
  }

  // --- Zoom pipeline ---
  if (zoomMeetings.length > 0 && REBUILD !== "html") {
    console.log(`Zoom: ${zoomMeetings.length} recordings\n`);

    for (const meeting of zoomMeetings) {
      const vttPath = path.join(VTT_DIR, `${meeting.id}.vtt`);
      if (REBUILD !== "all" && fs.existsSync(vttPath)) {
        console.log(`[${meeting.id}] VTT exists, skipping download/transcribe`);
        continue;
      }

      console.log(`[${meeting.id}] ${meeting.date} - ${meeting.meeting}`);

      const videoPath = await downloadFromZoom(meeting);
      if (!videoPath) {
        console.log(`  [skip] Could not download, skipping\n`);
        continue;
      }

      const audioPath = path.join(VIDEO_DIR, `${meeting.id}.wav`);
      try {
        await extractAudio(videoPath, audioPath);
      } catch (err) {
        console.error(`  [error] ffmpeg failed: ${err.message}\n`);
        continue;
      }

      try {
        await transcribeWithWhisper(audioPath, vttPath);
      } catch (err) {
        console.error(`  [error] Whisper failed: ${err.message}\n`);
        continue;
      }

      // Clean up large audio file (keep video for reference)
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      console.log();
    }
  }

  // --- Convert VTTs to HTML ---
  const vttFiles = fs.readdirSync(VTT_DIR).filter((f) => f.endsWith(".vtt"));
  let converted = 0;
  for (const vttFile of vttFiles) {
    // yt-dlp writes "<id>.en.vtt" with the language suffix; strip it so the id matches meetings.json
    const id = path.basename(vttFile, ".vtt").replace(/\.en$/, "");
    const htmlFile = path.join(TRANSCRIPTS_DIR, `${id}.html`);
    if (!REBUILD && fs.existsSync(htmlFile)) continue;

    const meeting = meetings.find((m) => m.id === id);
    if (!meeting) continue;

    const vttText = fs.readFileSync(path.join(VTT_DIR, vttFile), "utf-8");
    const html = convertVttToHtml(meeting, vttText);
    fs.writeFileSync(htmlFile, html);
    console.log(`[${id}] Converted to HTML`);
    converted++;
  }
  console.log(`Converted ${converted} transcripts to HTML.`);

  // --- Generate index ---
  const transcriptFiles = fs.readdirSync(TRANSCRIPTS_DIR);
  fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), generateIndex(meetings, transcriptFiles));
  console.log("Generated index.html");
}

// Exported so targeted build scripts (e.g. temp/build-boe-vtt.js) can reuse the
// converter without re-running the full download/transcribe pipeline.
module.exports = { convertVttToHtml, generateIndex, downloadYouTubeVtt, ensureYtDlp, OUTPUT_DIR, VTT_DIR, TRANSCRIPTS_DIR, MEETINGS_FILE };

if (require.main === module) {
  main().catch(console.error);
}
