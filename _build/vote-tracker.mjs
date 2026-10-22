#!/usr/bin/env node
/*
 * Record a day's early-voting counts in the vote tracker.
 *
 * tools/vote-tracker/index.html carries its data as a CSV inside
 * <script id="data" type="text/csv">. This CLI edits that block in place:
 *
 *   1. proposes the first dated row that has no counts yet (↑/↓ or ←/→ step
 *      through the other dated rows, typing replaces the suggestion);
 *   2. asks for the Democratic, Republican, Unenrolled and Other ballot counts
 *      one at a time — a row that already has counts offers them as defaults,
 *      so picking an earlier date is how a past row gets corrected;
 *   3. shows the finished row and asks for confirmation;
 *   4. writes the row, stamps the `saved` row with the current time (so the
 *      embedded copy outranks any older copy a browser has cached), commits,
 *      deploys the tools area, commits the deploy baseline and pushes.
 *
 *   npm run votes:update                  # the full loop
 *   npm run votes:update -- --no-publish  # write the page, skip git and FTP
 *
 * Keys work from a pipe as well as a terminal (Enter is \r or \n), which is
 * how the script is smoke-tested; VOTE_TRACKER_PAGE points it at a copy.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { emitKeypressEvents } from 'node:readline'

const ROOT = resolve(import.meta.dirname, '..')
const PAGE_REL = 'tools/vote-tracker/index.html'
const STATE_REL = '.deploy-state.json'
const PAGE = process.env.VOTE_TRACKER_PAGE || resolve(ROOT, PAGE_REL)
const PUBLISH = !process.argv.includes('--no-publish')

const PARTIES = [
  {col: 'democratic', label: 'Democratic', short: 'Dem'},
  {col: 'republican', label: 'Republican', short: 'Rep'},
  {col: 'unenrolled', label: 'Unenrolled', short: 'Unenr'},
  {col: 'other', label: 'Other', short: 'Other'}
]
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']
const BLOCK = /(<script id="data" type="text\/csv">\n)([\s\S]*?)(\n<\/script>)/

const stdin = process.stdin
const out = process.stdout
const dim = (s) => `\x1b[2m${s}\x1b[22m`
const last = (xs) => xs[xs.length - 1]
const fail = (msg) => { out.write(`\n  vote-tracker: ${msg}\n\n`); process.exit(1) }

/* ---------- CSV (mirrors the page's own parser and serializer) ---------- */
const parseRow = (line) => {
  const fields = []
  const re = /(?:"((?:[^"]|"")*)"|([^,]*))(,|$)/g
  let m
  while ((m = re.exec(line))) {
    fields.push(m[1] != null ? m[1].replace(/""/g, '"') : m[2])
    if (m[3] === '') break
  }
  return fields
}
const csvField = (v) => /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
const csvLine = (cells) => cells.map(csvField).join(',')

const loadPage = () => {
  const html = readFileSync(PAGE, 'utf8')
  const m = html.match(BLOCK)
  if (!m) fail(`no <script id="data" type="text/csv"> block in ${PAGE_REL}`)
  const [header, ...lines] = m[2].split(/\r?\n/).filter((l) => l.trim() !== '')
  const cols = header.split(',')
  const rows = lines.map(parseRow).map((cells) => Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ''])))
  return {html, cols, rows}
}
const savePage = ({html, cols, rows}) => {
  const csv = [cols.join(','), ...rows.map((r) => csvLine(cols.map((c) => r[c])))].join('\n')
  writeFileSync(PAGE, html.replace(BLOCK, (_, open, __, close) => open + csv + close))
}

/* ---------- row helpers ---------- */
const isBlank = (r) => PARTIES.every((p) => r[p.col] === '')
const isDated = (r) => (r.kind === 'day' || r.kind === 'electionday') && r.date !== ''
const monthDay = (date) => {
  const d = new Date(`${date}T12:00:00`)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}
const longDate = (date) => `${DOW[new Date(`${date}T12:00:00`).getDay()]}, ${monthDay(date)}`
const countsOf = (r, sep) => PARTIES.map((p) => `${p.short} ${r[p.col] === '' ? '–' : r[p.col]}`).join(sep)
const describeRow = (r) =>
  `${r.kind === 'electionday' ? 'Election Day, ' : ''}${longDate(r.date)} — ${isBlank(r) ? 'no counts yet' : countsOf(r, ', ')}`

/* ---------- keyboard ---------- */
// Keypresses queue up rather than being read one at a time: a pasted string
// or a pipe delivers several in one chunk, and a `once` listener would drop
// all but the first.
const keys = []
let waiting = null
const onKey = (str, key) => {
  const k = {str: str || '', key: key || {}}
  waiting ? (waiting(k), waiting = null) : keys.push(k)
}
const readKey = () => keys.length ? Promise.resolve(keys.shift()) : new Promise((res) => { waiting = res })
const abort = () => { out.write('\n\n  aborted — nothing written.\n\n'); process.exit(1) }
const isEnter = (key) => key.name === 'return' || key.name === 'enter'
const isQuit = (key) => key.ctrl && (key.name === 'c' || key.name === 'd')

// One line of input. `value` is shown as a suggestion: typing replaces it,
// Backspace edits it, Esc clears it, ↑/↓ and ←/→ step through `options`
// (anchored at the suggestion when the text is not one of them), Enter
// accepts. `describe(text)` supplies a dim hint drawn after the text.
const edit = async ({label, value = '', options = [], describe = () => ''}) => {
  let text = value
  let pristine = true
  const home = Math.max(options.indexOf(value), 0)
  const draw = () => {
    const hint = describe(text)
    out.write(`\r\x1b[2K  ${label} ${text}${hint ? dim(`  ${hint}`) : ''}`)
    if (hint) out.write(`\x1b[${[...hint].length + 2}D`)
  }
  draw()
  while (true) {
    const {str, key} = await readKey()
    if (isQuit(key)) abort()
    if (isEnter(key)) { out.write('\n'); return text }
    const step = {up: -1, left: -1, down: 1, right: 1}[key.name]
    if (step && options.length) {
      const cur = options.indexOf(text)
      text = options[cur < 0 ? home : Math.min(Math.max(cur + step, 0), options.length - 1)]
      pristine = true
    } else if (key.name === 'backspace') {
      text = text.slice(0, -1)
      pristine = false
    } else if (key.name === 'escape') {
      text = ''
      pristine = false
    } else if (str && !key.ctrl && !key.meta && str >= ' ') {
      text = (pristine ? '' : text) + str
      pristine = false
    }
    draw()
  }
}

const pickDate = async (dated, suggested) => {
  const options = dated.map((r) => r.date)
  const byDate = (t) => dated.find((r) => r.date === t)
  while (true) {
    const typed = (await edit({
      label: 'Date:',
      value: suggested,
      options,
      describe: (t) => { const r = byDate(t); return r ? describeRow(r) : 'not a date in the tracker' }
    })).trim()
    const row = byDate(typed)
    if (row) return row
    out.write(`  ${typed || '(empty)'} is not in the tracker; it runs ${options[0]} … ${last(options)}\n`)
  }
}

const askCount = async (party, current) => {
  while (true) {
    const t = (await edit({label: `${party.label}:`.padEnd(11), value: current})).trim()
    if (t === '' || /^\d+$/.test(t)) return t
    out.write('  enter a whole number, or leave it empty to clear the cell\n')
  }
}

const confirm = async (row) => {
  const total = PARTIES.reduce((n, p) => n + (Number(row[p.col]) || 0), 0)
  out.write(`\n  ${longDate(row.date)} (${row.date})   ${countsOf(row, '   ')}   total ${total}\n`)
  out.write(`  Save this row${PUBLISH ? ' and publish it' : ''}? [Y/n] `)
  while (true) {
    const {str, key} = await readKey()
    if (isQuit(key)) abort()
    if (isEnter(key) || /^y$/i.test(str)) { out.write('yes\n'); return true }
    if (/^n$/i.test(str)) { out.write('no\n\n'); return false }
  }
}

/* ---------- git + deploy ---------- */
const run = (cmd, args, stdio = 'inherit') => {
  const r = spawnSync(cmd, args, {cwd: ROOT, stdio, encoding: 'utf8'})
  if (r.status !== 0) fail(`${[cmd, ...args].join(' ')} failed (${r.status ?? r.error?.message})`)
  return r.stdout
}
const git = (...args) => run('git', args)

const publish = (row, wasBlank) => {
  const when = monthDay(row.date)
  const what = row.kind === 'electionday' ? 'Election Day' : 'early-voting'
  const subject = `${wasBlank ? 'Record' : 'Correct'} the ${what} counts for ${when}`
  out.write(`\n  → git commit: ${subject}\n`)
  git('commit', '-q', '-m', subject, '--', PAGE_REL)
  out.write('  → deploy the tools area\n')
  run(process.execPath, [resolve(ROOT, '_build', 'deploy.mjs'), '--deploy', '--area', 'tools'])
  const dirty = run('git', ['status', '--porcelain', '--', STATE_REL], ['ignore', 'pipe', 'inherit']).trim()
  if (dirty) {
    const baseline = `Record the deploy baseline for the ${when} counts`
    out.write(`  → git commit: ${baseline}\n`)
    git('commit', '-q', '-m', baseline, '--', STATE_REL)
  }
  out.write('  → git push\n')
  git('push', '-q')
  out.write(`\n  done: the ${when} counts are live.\n\n`)
}

/* ---------- main ---------- */
const main = async () => {
  const page = loadPage()
  const dated = page.rows.filter(isDated)
  if (!dated.length) fail('the tracker has no dated rows')
  const town = page.rows.find((r) => r.town !== '')?.town || 'the town'

  out.write(`\n  Early-voting counts for ${town}\n`)
  out.write(dim('  ↑/↓ step through dates, type to replace, Backspace edits, Enter accepts, Ctrl-C quits.\n\n'))
  emitKeypressEvents(stdin)
  if (stdin.isTTY) stdin.setRawMode(true)
  stdin.resume()
  stdin.on('keypress', onKey)
  stdin.on('end', abort)

  // The draft survives a "no" at the confirmation, so a second pass starts
  // from what was just typed rather than from the page.
  let draft = {...(dated.find(isBlank) || last(dated))}
  let target
  while (true) {
    target = await pickDate(dated, draft.date)
    if (target.date !== draft.date) draft = {...target}
    for (const p of PARTIES) draft[p.col] = await askCount(p, draft[p.col])
    if (await confirm(draft)) break
  }
  stdin.removeListener('end', abort)
  stdin.removeListener('keypress', onKey)
  if (stdin.isTTY) stdin.setRawMode(false)
  stdin.pause()

  const wasBlank = isBlank(target)
  Object.assign(target, draft)
  const now = new Date().toISOString()
  const saved = page.rows.find((r) => r.kind === 'saved')
  saved
    ? (saved.date = now)
    : page.rows.unshift({...Object.fromEntries(page.cols.map((c) => [c, ''])), kind: 'saved', town, date: now})
  savePage(page)
  out.write(`\n  wrote ${PAGE_REL}\n`)
  PUBLISH ? publish(target, wasBlank) : out.write('  --no-publish: not committed, not deployed.\n\n')
}

main()
