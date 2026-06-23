# andoverct.info

The repository behind **https://andoverct.info** — a civic-information hub for
Andover, CT. It is a small monorepo: the root owns the site's shared chrome and
coordinates everything, while each content **area** owns how it is authored and
built. One command surface at the root rebuilds any area and publishes the
result.

## Repository layout

| Path                                                           | What it is                                                              | Built by                                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `index.html`, `style.css`, `idx.php`, `favicon.*`, `.htaccess` | Top-level hub chrome                                                    | hand-authored                                                        |
| `the-facts/`                                                   | Newspaper-style "the facts" editions                                    | `the-facts/_build/render.js` (Markdown → HTML)                       |
| `reports/`                                                     | Long-form civic/analytical reports                                      | `_build/report.mjs` (Markdown → HTML + PDF)                          |
| `town-charter/`                                                | Town-charter guide pages                                                | `town-charter/convert.js` (data → HTML)                              |
| `reference/`                                                   | Reference landing page                                                  | hand-authored                                                        |
| `reference/video/`                                             | Town-meeting transcripts (the former *TownMeetings* project, folded in) | `reference/video/download-transcripts.js` + `transcribe-deepgram.js` |
| `_build/`                                                      | Shared report engine + the deploy tool                                  | —                                                                    |

**Not in this repo** (separate GitHub Pages sites on their own subdomains, linked
from the hub): `charter22` / `charter24` / `flyer`.andoverct.info. They keep their
own repos and deploy independently.

### Build & publish model

Each area is built locally; the **deploy** step uploads only the files whose
contents changed. So the day-to-day loop is: *edit → rebuild the area → deploy*.
You never have to think about what changed — the deploy tool diffs it for you.

## Commands

Run all of these from the repo root.

| Command                        | Does                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| `npm run setup`                | Install dependencies (root + the video pipeline)               |
| `npm run rebuild:reports`      | Rebuild every report (HTML + PDF)                              |
| `npm run rebuild:the-facts`    | Rebuild every "the facts" edition                              |
| `npm run rebuild:town-charter` | Rebuild the town-charter pages                                 |
| `npm run rebuild:all`          | Reports + the-facts + town-charter (the fast, local builds)    |
| `npm run rebuild:videos`       | Fetch/render new **YouTube** meeting transcripts               |
| `npm run rebuild:videos:boe`   | Transcribe missing **BOE (Zoom)** meetings via Deepgram        |
| `npm run deploy`               | **Dry run** — show exactly what would upload, transfer nothing |
| `npm run deploy:go`            | Upload the changed files to the live server                    |
| `npm run publish`              | `rebuild:all` then `deploy:go`                                 |

Notes:
- `rebuild:videos*` are intentionally **not** part of `rebuild:all` — they are slow,
  networked, and need extra tools/keys (see below). Run them deliberately.
- Build a single report instead of all: `npm run report -- reports/<area>/<name>/<file>.md`.

## Setting up on a new machine

1. **Clone and install dependencies.**
   ```sh
   git clone https://github.com/CrossEye/andoverct.info.git
   cd andoverct.info
   npm run setup
   ```

2. **Add the secrets.** Two gitignored `.env` files (copy the `.env.sample`
   next to each):
   - `./.env` — `FTP_PASSWORD=...` (the `crosseye` FTP password). Needed only to
     **deploy**.
   - `./reference/video/.env` — `DEEPGRAM_API_KEY=...`. Needed only to
     **transcribe BOE meetings**.

3. **Install system tools for the heavier builds** (only if you'll run them):
   - **Reports (PDF):** Python with WeasyPrint — `pip install weasyprint`
     (`_build/report.mjs` shells out to `python -m weasyprint`).
   - **Videos:** `ffmpeg` on `PATH`; Playwright's browser
     (`npx --prefix reference/video playwright install chromium`) for the Zoom
     passcode flow. `yt-dlp` downloads itself into `reference/video/bin/` on first run.

That's it. Editing a page and deploying needs only step 1 + the FTP password.
Building reports adds WeasyPrint; regenerating transcripts adds the video tools.

## Deploying — details

The deploy tool ([`_build/deploy.mjs`](_build/deploy.mjs)) publishes over plain
FTP to the origin web root (`/www` on `pup.phpwebhosting.com`). It hashes each
file an area publishes and compares against the committed baseline in
`.deploy-state.json`, uploading only the difference.

- **Dry run is the default.** `npm run deploy` never transfers anything; use it to
  preview. `npm run deploy:go` performs the upload.
- **Useful flags** (pass after `--`, e.g. `npm run deploy -- --area video`):
  - `--area <id>` — limit to one area (`root`, `the-facts`, `reports`,
    `town-charter`, `reference`, `video`).
  - `--delete` — also remove files on the server that are gone locally (off by
    default; deletions are otherwise only reported).
  - `--seed` — record the current files as the baseline **without uploading**
    (used once when content is already live, so the next deploy is a true delta).
  - `--verbose` — full file lists and the FTP protocol log.

What gets published and where each area maps on the server is defined in
[`_build/site.manifest.json`](_build/site.manifest.json). Source files
(`*.md`, `*.py`, `*.xlsx`), build tooling, and the intermediate
`reference/video/vtt/` data are excluded from deployment.

## Git

`main` on `origin` (github.com/CrossEye/andoverct.info). Ordinary day-to-day git
is all you need; nothing here requires rebases or history rewriting.
