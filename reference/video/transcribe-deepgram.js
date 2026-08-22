// Deepgram-based transcription for BOE Zoom meetings — a drop-in replacement for
// the local Whisper step. It acquires the recording's audio (.m4a) via Playwright
// (entering the passcode), sends it to Deepgram Nova-3, writes a WebVTT file to
// output/vtt/<id>.vtt, renders the HTML transcript, and regenerates the index.
//
// Why this exists: local Whisper (base model) gives low-quality transcripts of
// in-person BOE audio and takes hours. Deepgram is cloud, fast, and cheap, and
// supports diarization for future speaker-aware rendering.
//
// Prerequisites:
//   npm install playwright           (already a dependency)
//   export DEEPGRAM_API_KEY=...       (PowerShell: $env:DEEPGRAM_API_KEY="...")
//
// Usage:
//   node transcribe-deepgram.js boe-2026-05-13 [more ids...]
//   node transcribe-deepgram.js --all-boe       # every BOE Zoom meeting
//   node transcribe-deepgram.js --missing       # BOE Zoom meetings with no transcript yet
//   node transcribe-deepgram.js --missing-town  # YouTube meetings with no transcript yet
//
// YouTube meetings get their audio via yt-dlp (bin/yt-dlp.exe); Zoom meetings
// via Playwright. Entries with skipTranscribe: true in meetings.json are never
// selected by the --missing selectors (dead links, silent recordings).
//
// Env / flags:
//   DEEPGRAM_API_KEY   required — your Deepgram API key
//   DG_MODEL           Deepgram model (default: nova-3)
//   HEADLESS           "false" to watch the Zoom browser during audio download
//   REDO_AUDIO         "1" to re-download audio even if a local file exists
//   REDO_DG            "1" to re-call Deepgram even if a cached JSON exists
//
// Raw Deepgram responses are cached in temp/deepgram/<id>.json so re-rendering
// (or tweaking the VTT conversion) never re-bills the API.

const fs = require("node:fs");
const path = require("node:path");
const { convertVttToHtml, generateIndex } = require("./download-transcripts.js");

const ROOT = __dirname;
const OUTPUT_DIR = path.join(ROOT, "output");
const VTT_DIR = path.join(OUTPUT_DIR, "vtt");
const TRANSCRIPTS_DIR = path.join(OUTPUT_DIR, "transcripts");
const VIDEO_DIR = path.join(OUTPUT_DIR, "video");
const DG_CACHE = path.join(ROOT, "temp", "deepgram");
const MEETINGS_FILE = path.join(ROOT, "meetings.json");

// Load .env (if present) so DEEPGRAM_API_KEY can live in a gitignored file
// rather than the shell environment. Minimal parser — no dependency. A real
// shell env var takes precedence (we never overwrite an already-set key).
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue; // skips blanks and # comments
    const key = m[1];
    const val = m[2].replace(/^(['"])(.*)\1$/, "$2"); // strip matching quotes
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv(path.join(ROOT, ".env"));

const API_KEY = process.env.DEEPGRAM_API_KEY;
const DG_MODEL = process.env.DG_MODEL || "nova-3";
const HEADLESS = process.env.HEADLESS !== "false";
const REDO_AUDIO = process.env.REDO_AUDIO === "1";
const REDO_DG = process.env.REDO_DG === "1";

// ---------------------------------------------------------------------------
// Meeting selection
// ---------------------------------------------------------------------------

const meetings = JSON.parse(fs.readFileSync(MEETINGS_FILE, "utf-8"));

function selectTargets(argv) {
  const flags = argv.filter((a) => a.startsWith("--"));
  const ids = argv.filter((a) => !a.startsWith("--"));
  const isBoeZoom = (m) => m.type === "Zoom" && m.id.startsWith("boe-") && m.link;
  const isTown = (m) => m.type === "YouTube" && m.link;
  const transcribed = () =>
    new Set(fs.readdirSync(TRANSCRIPTS_DIR).filter((f) => f.endsWith(".html")).map((f) => f.replace(".html", "")));
  if (ids.length) return ids.map((id) => meetings.find((m) => m.id === id)).filter(Boolean);
  if (flags.includes("--all-boe")) {
    return meetings.filter(isBoeZoom).sort((a, b) => b.date.localeCompare(a.date));
  }
  if (flags.includes("--missing")) {
    const have = transcribed();
    return meetings
      .filter((m) => isBoeZoom(m) && !m.skipTranscribe && !have.has(m.id))
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  if (flags.includes("--missing-town")) {
    const have = transcribed();
    return meetings
      .filter((m) => isTown(m) && !m.skipTranscribe && !have.has(m.id))
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  return [];
}

// ---------------------------------------------------------------------------
// Audio acquisition.
//   YouTube: yt-dlp audio-only download (bestaudio m4a).
//   Zoom:    download the recording's .m4a (audio only, ~10x smaller than the
//            4K mp4) by clicking Zoom's "Download (N files)" bundle.
// ---------------------------------------------------------------------------

const YT_DLP = path.join(ROOT, "bin", "yt-dlp.exe");

async function ensureYouTubeAudio(meeting) {
  const m4a = path.join(VIDEO_DIR, `${meeting.id}.m4a`);
  if (fs.existsSync(m4a) && !REDO_AUDIO) {
    console.log(`  [audio] using existing ${path.basename(m4a)}`);
    return m4a;
  }
  if (!fs.existsSync(YT_DLP)) {
    console.log("  [audio] downloading yt-dlp…");
    const { YTDLP } = require("yt-dlp-node");
    await YTDLP.downloadYTDLP({ dst: path.dirname(YT_DLP) });
  }
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  const { execFile } = require("node:child_process");
  const exec = (cmd, args) =>
    new Promise((resolve, reject) =>
      execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
        err ? reject(err) : resolve({ stdout, stderr })));

  // Since mid-2026 YouTube serves deliberately garbled DASH audio (m4a/webm)
  // to clients it considers suspicious; ffprobe sees a well-formed container
  // but the AAC/Opus packets are junk and Deepgram rejects the upload as
  // "corrupt or unsupported data". The HLS audio renditions come down clean,
  // so prefer those, and decode-scan whatever we get before trusting it.
  const FORMATS = [
    "bestaudio[protocol*=m3u8][ext=mp4]",
    "bestaudio[ext=m4a]",
    "bestaudio",
  ];
  const stem = path.join(VIDEO_DIR, `${meeting.id}.dl`);
  const cleanupDl = () =>
    fs.readdirSync(VIDEO_DIR)
      .filter((f) => f.startsWith(`${meeting.id}.dl.`))
      .forEach((f) => fs.rmSync(path.join(VIDEO_DIR, f), { force: true }));
  const download = (fmt) =>
    // --js-runtimes node: without a JS runtime yt-dlp falls back to a client
    // that reports many valid (especially older) videos as "not available".
    exec(YT_DLP, ["-f", fmt, "--js-runtimes", "node", "--no-warnings",
      "-o", `${stem}.%(ext)s`, meeting.link]);
  const decodeErrors = async (file) => {
    const { stderr } = await exec("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"])
      .catch((err) => ({ stderr: String(err.stderr || err.message) }));
    return stderr.split("\n").filter((l) => l.trim()).length;
  };

  console.log(`  [audio] downloading via yt-dlp…`);
  let good = null;
  for (const fmt of FORMATS) {
    cleanupDl();
    try {
      await download(fmt);
    } catch (err) {
      // YouTube 403s and "not available" errors are frequently transient — one
      // immediate retry cures nearly all of them.
      const msg = String(err.message || err).split("\n").pop().slice(0, 120);
      if (/Requested format is not available/.test(msg)) { console.log(`  [audio] ${fmt}: not available`); continue; }
      console.log(`  [audio] ${fmt}: retrying after: ${msg}`);
      try { await download(fmt); } catch (err2) {
        console.log(`  [audio] ${fmt}: failed: ${String(err2.message || err2).split("\n").pop().slice(0, 120)}`);
        continue;
      }
    }
    const file = fs.readdirSync(VIDEO_DIR).find((f) => f.startsWith(`${meeting.id}.dl.`));
    if (!file) { console.log(`  [audio] ${fmt}: produced no file`); continue; }
    const errs = await decodeErrors(path.join(VIDEO_DIR, file));
    if (errs > 2) { console.log(`  [audio] ${fmt}: ${errs} decode errors — stream is garbled, trying next`); continue; }
    good = path.join(VIDEO_DIR, file);
    break;
  }
  if (!good) { cleanupDl(); throw new Error("yt-dlp produced no usable audio (all formats garbled or unavailable)"); }

  // Normalise to a plain .m4a: stream-copy when already AAC, else transcode.
  const { stdout: codec } = await exec("ffprobe", ["-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=codec_name", "-of", "csv=p=0", good]);
  const acodec = codec.trim() === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "128k"];
  await exec("ffmpeg", ["-v", "error", "-y", "-i", good, "-vn", ...acodec, "-movflags", "+faststart", m4a]);
  cleanupDl();
  console.log(`  [audio] saved ${path.basename(m4a)}`);
  return m4a;
}

async function ensureAudio(meeting) {
  if (meeting.type === "YouTube") return ensureYouTubeAudio(meeting);
  // Only ever reuse/download the audio-only .m4a (~40-150 MB). NEVER the .mp4:
  // the Zoom recordings include multi-GB 4K video that breaks the upload (Node
  // can't read >2 GiB, and large uploads to Deepgram fail/time out).
  const m4a = path.join(VIDEO_DIR, `${meeting.id}.m4a`);
  if (fs.existsSync(m4a) && !REDO_AUDIO) {
    console.log(`  [audio] using existing ${path.basename(m4a)}`);
    return m4a;
  }

  const { chromium } = require("playwright");
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  let savedM4a = null;
  const pending = [];
  const onDownload = (dl) => {
    const name = dl.suggestedFilename();
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (ext === "m4a" && !savedM4a) {
      const dest = path.join(VIDEO_DIR, `${meeting.id}.m4a`);
      pending.push(dl.saveAs(dest).then(() => { savedM4a = dest; }).catch(() => dl.cancel().catch(() => {})));
    } else {
      dl.cancel().catch(() => {}); // skip the multi-GB mp4 and the chat .txt
    }
  };
  page.on("download", onDownload);
  context.on("page", (p) => p.on("download", onDownload));

  try {
    console.log(`  [audio] opening recording…`);
    await page.goto(meeting.link, { waitUntil: "networkidle", timeout: 45000 });
    const passcodeInput = await page.$("#passcode");
    if (passcodeInput) {
      await passcodeInput.fill(meeting.passcode || "");
      const submitBtn = (await page.$('button[type="submit"]')) || (await page.$("#passcode_btn"));
      if (submitBtn) await submitBtn.click();
      await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
    }
    await page.waitForTimeout(4000);

    const dlHandle = await page.evaluateHandle(() =>
      Array.from(document.querySelectorAll("a, button, [role='button']")).find((el) =>
        /Download\s*\(\d+\s*files?\)/i.test(el.innerText || el.textContent || "")
      )
    );
    const el = dlHandle.asElement();
    if (!el) throw new Error("no 'Download (N files)' link found (passcode failed or page changed)");
    await el.click().catch(() => {});
    await page.waitForTimeout(10000);       // let downloads start
    await Promise.all(pending);             // let saves finish
  } finally {
    await context.close();
    await browser.close();
  }

  if (!savedM4a) throw new Error("download bundle produced no .m4a");
  console.log(`  [audio] saved ${path.basename(savedM4a)}`);
  return savedM4a;
}

// ---------------------------------------------------------------------------
// Deepgram transcription (pre-recorded, sync) with raw-JSON caching
// ---------------------------------------------------------------------------

const CONTENT_TYPE = { m4a: "audio/mp4", mp4: "video/mp4", wav: "audio/wav" };

const dgCachePath = (id) => path.join(DG_CACHE, `${id}.json`);
const hasFreshCache = (id) => fs.existsSync(dgCachePath(id)) && !REDO_DG;

async function transcribe(meeting, audioPath) {
  fs.mkdirSync(DG_CACHE, { recursive: true });
  const cacheFile = dgCachePath(meeting.id);
  if (fs.existsSync(cacheFile) && !REDO_DG) {
    console.log(`  [deepgram] using cached response`);
    return JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
  }
  if (!API_KEY) throw new Error("DEEPGRAM_API_KEY not set");

  const ext = (audioPath.split(".").pop() || "").toLowerCase();
  const params = new URLSearchParams({
    model: DG_MODEL,
    smart_format: "true",
    punctuate: "true",
    diarize: "true",
    utterances: "true",
    paragraphs: "true",
    language: "en",
  });
  const bytes = fs.readFileSync(audioPath);
  console.log(`  [deepgram] uploading ${(bytes.length / 1048576).toFixed(1)} MB to ${DG_MODEL}…`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20 * 60 * 1000); // 20 min ceiling
  let resp;
  try {
    resp = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${API_KEY}`, "Content-Type": CONTENT_TYPE[ext] || "audio/mpeg" },
      body: bytes,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) throw new Error(`Deepgram HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const json = await resp.json();
  fs.writeFileSync(cacheFile, JSON.stringify(json, null, 2));
  return json;
}

// ---------------------------------------------------------------------------
// Deepgram JSON -> WebVTT (one cue per utterance)
// ---------------------------------------------------------------------------

function fmtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const p2 = (n) => String(n).padStart(2, "0");
  return `${p2(h)}:${p2(m)}:${p2(s)}.${String(ms).padStart(3, "0")}`;
}

// Convert Deepgram utterances to WebVTT. When speakerBreaks is on, the first cue
// of each *substantial* new-speaker turn is prefixed with ">>" — the marker
// parseWhisperVtt turns into a paragraph break. The minTurnWords threshold keeps
// tiny back-channel interjections ("Okay.", "Right.") from chopping the page,
// which also absorbs most of Deepgram's diarization over-splitting.
function deepgramToVtt(json, opts = {}) {
  const speakerBreaks = opts.speakerBreaks !== false;
  const minTurnWords = opts.minTurnWords ?? 10;

  const utts = (json?.results?.utterances || []).filter((u) => (u.transcript || "").trim());
  if (!utts.length) throw new Error("no utterances in Deepgram response (diarize/utterances off?)");

  // Group consecutive same-speaker utterances into turns.
  const turns = [];
  for (const u of utts) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === u.speaker) last.utts.push(u);
    else turns.push({ speaker: u.speaker, utts: [u] });
  }

  // Mark the first utterance of each turn (after the first) that is "substantial".
  const breakAt = new Set();
  if (speakerBreaks) {
    for (let i = 1; i < turns.length; i++) {
      const words = turns[i].utts.reduce((n, u) => n + u.transcript.trim().split(/\s+/).length, 0);
      if (words >= minTurnWords) breakAt.add(turns[i].utts[0]);
    }
  }

  const cues = utts.map((u) => {
    const prefix = breakAt.has(u) ? ">> " : "";
    return `${fmtTime(u.start)} --> ${fmtTime(u.end)}\n${prefix}${u.transcript.trim()}`;
  });
  return "WEBVTT\n\n" + cues.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const targets = selectTargets(process.argv.slice(2));
  if (!targets.length) {
    const argv = process.argv.slice(2);
    if (argv.includes("--missing") || argv.includes("--missing-town")) {
      console.log("Nothing to transcribe — every selected meeting already has a transcript.");
      return;
    }
    console.error("No meetings selected. Pass meeting id(s), or --all-boe / --missing / --missing-town.");
    process.exit(1);
  }
  fs.mkdirSync(VTT_DIR, { recursive: true });
  console.log(`Transcribing ${targets.length} meeting(s) with Deepgram ${DG_MODEL}\n`);

  const done = [];
  const failed = [];
  for (const m of targets) {
    console.log(`[${m.date}] ${m.id} — ${m.meeting}`);
    try {
      // Skip the audio download entirely when a Deepgram response is cached.
      const audio = hasFreshCache(m.id) ? null : await ensureAudio(m);
      const json = await transcribe(m, audio);
      const vtt = deepgramToVtt(json, {
        speakerBreaks: process.env.DG_SPEAKER_BREAKS !== "0",
        minTurnWords: process.env.DG_MIN_TURN_WORDS ? parseInt(process.env.DG_MIN_TURN_WORDS, 10) : undefined,
      });
      fs.writeFileSync(path.join(VTT_DIR, `${m.id}.vtt`), vtt);
      fs.writeFileSync(path.join(TRANSCRIPTS_DIR, `${m.id}.html`), convertVttToHtml(m, vtt));
      const cues = (vtt.match(/ --> /g) || []).length;
      console.log(`  [done] ${cues} cues → output/transcripts/${m.id}.html\n`);
      done.push(m.id);
    } catch (err) {
      console.error(`  [error] ${err.message}\n`);
      failed.push(m.id);
    }
  }

  // Regenerate index if anything changed
  if (done.length) {
    const transcriptFiles = fs.readdirSync(TRANSCRIPTS_DIR);
    fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), generateIndex(meetings, transcriptFiles));
    console.log("Regenerated output/index.html");
  }
  console.log(`\nDone ${done.length}: ${done.join(", ") || "(none)"}`);
  if (failed.length) console.log(`Failed ${failed.length}: ${failed.join(", ")}`);
}

module.exports = { deepgramToVtt, fmtTime };

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
