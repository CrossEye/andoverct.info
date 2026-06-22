# Docker Automation Plan

> **Status (2026-06-21): largely superseded.** The transcription pain that
> motivated this (slow, low-quality local Whisper for BOE meetings) is solved by
> the cloud Deepgram pipeline (`transcribe-deepgram.js`). Kept for reference; the
> build/serve and automated-discovery ideas may still be useful someday.

Automate transcript pipeline in a Docker container on cheap/free hosting.
Regularly check for new YouTube and BOE Zoom videos, generate transcripts,
and serve as a static site.

## Architecture: Build/Serve Split

```
┌─────────────────────────────────┐
│  STATIC HOST (free)             │
│  GitHub Pages / Cloudflare Pages│
│  Serves output/ as a website    │
└──────────────▲──────────────────┘
               │ git push (or deploy CLI)
┌──────────────┴──────────────────┐
│  BUILD CONTAINER (scheduled)    │
│  ┌────────────────────────────┐ │
│  │ cron: check for new videos │ │
│  │ yt-dlp: YouTube VTTs       │ │
│  │ Zoom: download + transcribe│ │
│  │ Node: VTT → HTML + index   │ │
│  └────────────────────────────┘ │
│  Persistent volume: vtt/, video/│
│  On-demand trigger: webhook     │
└─────────────────────────────────┘
```

## Key Design Decisions

### Static serving (free)
GitHub Pages or Cloudflare Pages. Build container pushes generated `output/`
when new content is ready. No nginx to maintain, free CDN, free HTTPS.

### On-demand trigger
Tiny HTTP endpoint that kicks off a build. Could be a simple `curl` from a
phone or a webhook.

### YouTube pipeline (lightweight)
yt-dlp downloads VTT, Node does text processing. Fits easily on free hosting
tiers (Fly.io, Render, Railway).

### Zoom/Whisper pipeline (heavy)
Local Whisper needs ~1GB RAM and 30-60 min CPU per 2-hour meeting. Three
options to handle this:

**Option A: Whisper API ($0.006/min)**
Replace local Whisper with OpenAI's API. A 2-hour meeting costs ~$0.72.
Container stays lightweight. Groq also offers Whisper with a free tier.

**Option B: Scale-to-zero compute**
Fly.io Machines or Google Cloud Run — spin up a beefier instance (2GB+ RAM)
only when a Zoom meeting needs processing, then shut down. Pay only for
actual compute time.

**Option C: Keep Zoom processing local**
Only automate YouTube in Docker. Run Zoom transcription on local PC as
needed (BOE posts new recordings maybe 2-4x/month).

### New checker script needed
1. Hit YouTube channel RSS feed
   (`https://www.youtube.com/feeds/videos.xml?channel_id=XXXXX`) — no API
   key needed
2. Scrape BOE recordings page (already parsed once)
3. Diff against `meetings.json`
4. If new entries found, append them, run pipeline, deploy

### Rolling backups
Before writing `meetings.json`, copy to `backups/meetings-{date}.json`,
keep last N copies.

## Container sketch

```dockerfile
FROM node:20-slim

# yt-dlp (small binary)
# ffmpeg (for Zoom audio extraction)
# playwright chromium (only if keeping browser-based Zoom download)

COPY package.json download-transcripts.js meetings.json ./
RUN npm install

# Cron entries
# */8 * * * * node /app/check-and-build.js

# Tiny HTTP server for on-demand trigger
EXPOSE 8080
CMD ["node", "server.js"]
```

## Status

**On hold.** Investigating with the BOE whether their Zoom plan supports:
- Embedded-passcode URLs (simplifies linking)
- Automated transcript generation (would replace local Whisper entirely)

Audio quality note: in-person Zoom recordings produce lower quality Whisper
transcripts than YouTube remote meetings (individual mics vs room audio).
If Zoom can provide its own transcripts, the pipeline simplifies significantly.
