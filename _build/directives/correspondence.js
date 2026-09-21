'use strict'
// <% correspondence letters %>            the pinned opening letters, ledger order
// <% correspondence ledger %>             Part 2, Answered + Status computed
// <% correspondence log [limit=25] %>     the whole exchange, oldest first
// <% correspondence asof %>               the build date, inline in prose
//
// Reads the summary that _build/correspondence.mjs writes beside the entries, so
// the report's tables and the correspondence tree cannot disagree about a date,
// a classification, or whether a reply exists. See .meta/plans/008.
//
// Every view emits markdown, not HTML, so the report's own post-processors
// (numeric alignment, section labels) still see ordinary tables.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const longDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

// "00:26" -> "12:26 am". The sender's local clock, as the Date header gave it,
// shown without a zone: the offset is in the raw headers, and what this column
// is for is the order of events and how long a reply took.
const clockTime = (hhmm) => {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h < 12 ? 'am' : 'pm'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

const stamp = (e) => {
  const t = clockTime(e.time)
  return t ? `${longDate(e.date)}, ${t}` : longDate(e.date)
}

// correspondence.json is newest-first. The log reads the other way: it is the
// record of an exchange, and an exchange is followed forwards.
//
// Not [...entries].reverse(): that inverts the tie-break too, and the five
// opening letters, sent within one minute of each other, then list backwards
// through the ledger. Ties break by ledger order in both directions.
const oldestFirst = (entries, ledger) => {
  const rank = (e) => {
    const i = ledger.findIndex((l) => l.candidate === e.candidate)
    return i < 0 ? ledger.length : i
  }
  return [...entries].sort((x, y) => {
    if (x.date !== y.date) return x.date < y.date ? -1 : 1
    const xt = x.time || '', yt = y.time || ''
    if (xt !== yt) return xt < yt ? -1 : 1
    return rank(x) - rank(y)
  })
}

// Markdown pipe tables: an unescaped | would end the cell.
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|')

const table = (header, rows) => {
  const all = [header, ...rows]
  const w = header.map((h, i) => Math.max(...all.map((r) => cell(r[i]).length)))
  const line = (r) => '| ' + r.map((c, i) => cell(c).padEnd(w[i])).join(' | ') + ' |'
  const rule = '| ' + w.map((n) => '-'.repeat(n)).join(' | ') + ' |'
  return [line(header), rule, ...rows.map(line)].join('\n')
}

const correspondence = (ctx, view, args = {}) => {
  const c = ctx.correspondence
  if (!c) {
    throw new Error(
      "correspondence directive used but no correspondence.json in context — " +
      "does the report's front matter carry `correspondence: <dir>`?"
    )
  }

  const base = args.base || './correspondence'
  const href = (e) => `${base}/${e.path}`

  switch (view) {
    // The opening letters, pinned. Deliberately NOT part of the reverse-
    // chronological log: they are the oldest items and would eventually truncate
    // off the page, which is backwards for what a first-time reader most needs.
    case 'letters': {
      const rows = c.entries
        .filter((e) => e.opening)
        .sort((a, b) => c.ledger.findIndex((l) => l.candidate === a.candidate)
                      - c.ledger.findIndex((l) => l.candidate === b.candidate))
        .map((e) => [e.title, longDate(e.date), `[read](${href(e)})`])
      return table(['Letter', 'Sent', 'Text'], rows)
    }

    // Part 2. A dash in Answered means no reply had arrived as of the heading's
    // date — a statement about an inbox on a day, never a permanent condition.
    case 'ledger': {
      const rows = c.ledger.map((r) => [
        r.name,
        r.asked ? `[${longDate(r.asked.date)}](${base}/${r.asked.path})` : '—',
        r.answered ? `[${longDate(r.answered.date)}](${base}/${r.answered.path})` : '—',
        r.status,
      ])
      return table(['Candidate', 'Asked', 'Answered', `Status as of ${longDate(c.generated)}`], rows)
    }

    // Everything since the opening letters, newest first. correspondence.json is
    // already sorted, so this only filters and truncates.
    case 'log': {
      const limit = Number(args.limit || 25)
      // Everything, opening letters included: this is the whole exchange in one
      // place, not a feed of what has happened since some other table.
      const items = oldestFirst(c.entries, c.ledger)

      // Truncation keeps the MOST RECENT items, so a long record loses its
      // oldest rows to the full list rather than its newest.
      const shown = items.length > limit ? items.slice(items.length - limit) : items
      const rows = shown.map((e) => [
        stamp(e),
        `[${e.title}](${href(e)})${e.summary ? ` — ${e.summary}` : ''}`,
        e.status || '—',
      ])
      let md = table(['Date', 'Item', 'Classification'], rows)
      if (items.length > shown.length) {
        md += `

[See all ${items.length} items](${base}/)`
      }
      // The record is only ever a claim about a day. Without this an archive
      // that has gone quiet reads as one that is finished.
      md += `

Complete as of ${longDate(c.generated)}. Anything that arrives later is added here.`
      return md
    }

    // The one date the page asserts about itself, inline in prose.
    case 'asof':
      return longDate(c.generated)

    // The count, so the Summary row cannot contradict the ledger.
    case 'answered': {
      const n = c.ledger.filter((r) => r.status !== 'No response').length
      if (!n) return `None as of ${longDate(c.generated)}`
      return `${n} of ${c.ledger.length} as of ${longDate(c.generated)}`
    }

    default:
      throw new Error(`Unknown correspondence view '${view}' — `
        + 'expected letters, ledger, log, asof or answered')
  }
}

module.exports = correspondence
