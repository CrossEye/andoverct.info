# Andover Town Meetings — Transcripts

A small pipeline that turns recordings of Andover, CT town meetings into a
browsable static website of searchable, timestamped transcripts.

Live output lives in [`output/`](output/): an [`index.html`](output/index.html)
listing every meeting, plus one HTML transcript per meeting under
[`output/transcripts/`](output/transcripts/). Each transcript paragraph is
timestamped and links back to the exact moment in the source video/recording
(click a timestamp or sentence to open the video there, copy a link, or
bookmark the spot).

## What it does

Two kinds of meetings are handled, each with its own pipeline:

| Source | How it's fetched | How it's transcribed |
| ------ | ---------------- | -------------------- |
| **YouTube** (most meetings) | `yt-dlp` downloads the auto-generated English subtitles (VTT) | YouTube's own captions, cleaned up (filler words removed, duplicate caption lines de-duped, broken into paragraphs at speaker changes) |
| **Zoom** (BOE meetings) | Playwright drives a headless browser to the share link, enters the passcode, and downloads the recording `.mp4` | `ffmpeg` extracts the audio, then OpenAI Whisper transcribes it locally |

Both pipelines end up producing a `.vtt` file per meeting in
[`output/vtt/`](output/vtt/), which is then rendered to styled HTML, and finally
the index page is regenerated.

The whole thing is driven by [`download-transcripts.js`](download-transcripts.js)
and a single data file, [`meetings.json`](meetings.json).

### Deepgram — a faster, better alternative to Whisper for BOE meetings

Local Whisper (base model) is slow (hours per meeting) and low quality on
in-person BOE room audio. [`transcribe-deepgram.js`](transcribe-deepgram.js) is a
drop-in replacement that uses Deepgram's cloud API (Nova-3) instead: it acquires
the recording's **audio-only `.m4a`** via Playwright (entering the passcode),
sends it to Deepgram, and produces the same `output/vtt/<id>.vtt` →
`output/transcripts/<id>.html` → index outputs. It's cheap (~$0.26/hr), fast, and
requests diarization (for future speaker-aware rendering).

Provide the API key either via a `.env` file (copy [`.env.sample`](.env.sample)
to `.env` and fill it in — `.env` is gitignored) or as a shell variable (a shell
variable takes precedence).

```powershell
# either: cp .env.sample .env  and edit it, or:
$env:DEEPGRAM_API_KEY="..."
node transcribe-deepgram.js boe-2026-05-13   # one or more ids
node transcribe-deepgram.js --missing        # all BOE Zoom meetings with no transcript
node transcribe-deepgram.js --all-boe        # re-transcribe every BOE Zoom meeting
```

Raw Deepgram responses are cached under `temp/deepgram/<id>.json`, so
re-rendering (or tweaking the VTT conversion) never re-bills the API. Set
`REDO_DG=1` to force a fresh call, `REDO_AUDIO=1` to re-download the audio.
Note Deepgram cannot fetch a passcode-gated Zoom link itself — Playwright still
does the acquisition; Deepgram only replaces the transcription step.

## Repository layout

```
download-transcripts.js   YouTube pipeline + the shared VTT→HTML renderer
transcribe-deepgram.js    BOE (Zoom) transcription via Deepgram (replaces Whisper)
meetings.json             The master list of meetings — the input to everything
.env.sample               Copy to .env (gitignored) and add your DEEPGRAM_API_KEY
output/
  index.html              Generated landing page (the meeting list)
  transcripts/<id>.html   Generated transcript pages
  vtt/<id>.vtt            Intermediate subtitle/caption files (cached)
  video/<id>.m4a          Downloaded recording audio (gitignored, cached)
bin/yt-dlp.exe            Auto-downloaded yt-dlp binary
plans/                    Notes (e.g. the Docker automation plan, now superseded)
temp/                     Scratch/probe files, Deepgram JSON cache (gitignored)
```

`meetings.json` is the **single source of truth**. Each entry looks like:

```jsonc
// YouTube meeting — id is the YouTube video id (the v= part of the URL)
{
  "id": "8ETqnr94qmc",
  "date": "2026-04-29",
  "meeting": "Board of Finance- Special Meeting",
  "link": "https://www.youtube.com/watch?v=8ETqnr94qmc",
  "type": "YouTube"
}

// Zoom meeting — id is a synthetic slug; passcode is required to download
{
  "id": "boe-2026-04-14",
  "date": "2026-04-14",
  "meeting": "Special BOE Meeting",
  "link": "https://us02web.zoom.us/rec/share/…",
  "passcode": "qQ#L8M19",
  "type": "Zoom"
}
```

## Prerequisites

- **Node.js** (the script is CommonJS) — `npm install` to pull `playwright` and `yt-dlp-node`.
- `yt-dlp` itself is downloaded automatically into `bin/` on first run.
- **For Zoom meetings only:**
  - `npx playwright install chromium` (the browser Playwright drives)
  - **ffmpeg** on `PATH` (or installed via WinGet — the script also auto-discovers `Gyan.FFmpeg` installs)
  - **Python 3.12** with **OpenAI Whisper**: `pip install openai-whisper`

If you only have YouTube meetings to process, you can skip the Zoom toolchain entirely.

## Catching up with newer meetings (the common task)

1. **Find the new meetings.**
   - YouTube: the town's meetings are posted to the Andover YouTube channel.
     Grab the video id (the `v=` value) from each new video's URL.
   - Zoom (BOE): get the recording share link **and its passcode**.

2. **Add an entry per meeting to [`meetings.json`](meetings.json)** using the
   shapes shown above. Order doesn't matter (the index sorts by date), but
   keeping newest-first matches the existing convention.

3. **Run the pipeline:**

   ```powershell
   node download-transcripts.js
   ```

   By default the run is **incremental**: it skips any meeting that already has
   a `.vtt`, and skips re-rendering HTML that already exists. So a normal run
   only does work for the meetings you just added, then regenerates
   `index.html`.

   To limit work to just the recent additions (useful if you want to be sure
   it isn't touching anything old), scope by date:

   ```powershell
   node download-transcripts.js --since 2026-05-01
   ```

4. **Publish.** Copy/deploy the updated [`output/`](output/) folder to wherever
   the site is hosted. (There is no git remote or automated deploy configured
   in this repo yet; see [`plans/docker-automation.md`](plans/docker-automation.md)
   for the intended automation.)

That's it — for YouTube-only catch-ups, steps 1–3 take under a minute of
hands-on time.

## Command reference

```powershell
node download-transcripts.js [--since YYYY-MM-DD]
```

**Flags**

| Flag | Effect |
| ---- | ------ |
| `--since YYYY-MM-DD` | Only process meetings on or after this date. |

**Environment variables**

| Variable | Default | Effect |
| -------- | ------- | ------ |
| `REBUILD=all` | — | Re-download every VTT/recording and rebuild all HTML from scratch. |
| `REBUILD=html` | — | Keep existing VTTs; just regenerate all transcript HTML + the index. Use after changing the HTML/CSS templates. |
| `REBUILD=index` | — | Regenerate only `index.html` and exit. Fast; use after editing meeting titles/dates. |
| `WHISPER_MODEL` | `base` | Whisper model size for Zoom transcription (`tiny`/`base`/`small`/`medium`/`large`). Larger = more accurate, much slower. |
| `HEADLESS` | `true` | Set `HEADLESS=false` to watch the Zoom browser — useful when a Zoom download fails and you need to see what the page is doing. |

PowerShell examples:

```powershell
# Regenerate just the landing page after editing a meeting title
$env:REBUILD="index"; node download-transcripts.js; Remove-Item Env:REBUILD

# Rebuild all transcript HTML after tweaking the template/CSS
$env:REBUILD="html"; node download-transcripts.js; Remove-Item Env:REBUILD

# Re-transcribe Zoom meetings with a more accurate model, watching the browser
$env:WHISPER_MODEL="small"; $env:HEADLESS="false"; node download-transcripts.js
```

## How a run works (the pipeline, step by step)

1. Read `meetings.json`; split into YouTube and Zoom lists (filtered by `--since`).
2. **YouTube:** ensure `yt-dlp` exists, then download missing English auto-sub
   VTTs (3 at a time).
3. **Zoom:** for each meeting missing a VTT — drive Playwright to the share
   link, enter the passcode, download the `.mp4`, extract 16 kHz mono audio with
   ffmpeg, transcribe with Whisper, then delete the temporary `.wav` (the
   `.mp4` is kept).
4. **Render:** convert every `.vtt` in `output/vtt/` to a styled, timestamped
   HTML transcript (YouTube and Zoom transcripts use slightly different parsing
   and slightly different in-page actions).
5. **Index:** regenerate `output/index.html` listing all meetings, with links
   to each video and transcript (and Zoom passcodes with copy buttons where present).

## Troubleshooting

- **A Zoom download fails / produces no video.** Run with `HEADLESS=false` to
  watch the browser. The most common causes are a wrong/expired passcode or a
  changed Zoom page layout (the script looks for a download button, then a
  captured `.mp4` response, then a `<video>` source — in that order).
- **A YouTube meeting shows "Transcript unavailable".** YouTube hadn't finished
  generating captions yet, or the video has none. Re-run later; the VTT download
  will be retried because no `.vtt` was cached.
- **Whisper / Python not found.** The script searches common Python 3.12
  locations and falls back to `python`. Make sure `openai-whisper` is installed
  for whichever interpreter it finds (`python -m whisper --help`).
- **Changed the template but nothing updated.** HTML is only re-rendered when
  missing. Use `REBUILD=html` to force a full re-render.

## Notes & disclaimers

Transcripts are machine-generated (YouTube captions or Whisper) and **not
authoritative** — names, numbers, and details can be wrong. Every page links
back to the source recording, which is the source of truth. Site by Scott Sauyet.
