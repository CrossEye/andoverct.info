'use strict';
// <% correspondence letters %>            the pinned opening letters, ledger order
// <% correspondence ledger %>             Part 2, Answered + Status computed
// <% correspondence log [limit=12] %>     everything since, newest first
// <% correspondence asof %>               the build date, inline in prose
//
// Reads the summary that _build/correspondence.mjs writes beside the entries, so
// the report's tables and the correspondence tree cannot disagree about a date,
// a classification, or whether a reply exists. See .meta/plans/008.
//
// Every view emits markdown, not HTML, so the report's own post-processors
// (numeric alignment, section labels) still see ordinary tables.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// Markdown pipe tables: an unescaped | would end the cell.
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|');

function table(header, rows) {
  const all = [header, ...rows];
  const w = header.map((h, i) => Math.max(...all.map((r) => cell(r[i]).length)));
  const line = (r) => '| ' + r.map((c, i) => cell(c).padEnd(w[i])).join(' | ') + ' |';
  const rule = '| ' + w.map((n) => '-'.repeat(n)).join(' | ') + ' |';
  return [line(header), rule, ...rows.map(line)].join('\n');
}

function correspondence(ctx, view, args = {}) {
  const c = ctx.correspondence;
  if (!c) {
    throw new Error(
      "correspondence directive used but no correspondence.json in context — " +
      "does the report's front matter carry `correspondence: <dir>`?"
    );
  }

  const base = args.base || './correspondence';
  const href = (e) => `${base}/${e.path}`;

  switch (view) {
    // The four opening letters, pinned. Deliberately NOT part of the reverse-
    // chronological log: they are the oldest items and would eventually truncate
    // off the page, which is backwards for what a first-time reader most needs.
    case 'letters': {
      const rows = c.entries
        .filter((e) => e.opening)
        .sort((a, b) => c.ledger.findIndex((l) => l.candidate === a.candidate)
                      - c.ledger.findIndex((l) => l.candidate === b.candidate))
        .map((e) => [e.title, longDate(e.date), `[read](${href(e)})`]);
      return table(['Letter', 'Sent', 'Text'], rows);
    }

    // Part 2. A dash in Answered means no reply had arrived as of the heading's
    // date — a statement about an inbox on a day, never a permanent condition.
    case 'ledger': {
      const rows = c.ledger.map((r) => [
        r.name,
        r.asked ? `[${longDate(r.asked.date)}](${base}/${r.asked.path})` : '—',
        r.answered ? `[${longDate(r.answered.date)}](${base}/${r.answered.path})` : '—',
        r.status,
      ]);
      return table(['Candidate', 'Asked', 'Answered', `Status as of ${longDate(c.generated)}`], rows);
    }

    // Everything since the opening letters, newest first. correspondence.json is
    // already sorted, so this only filters and truncates.
    case 'log': {
      const limit = Number(args.limit || 12);
      const items = c.entries.filter((e) => !e.opening);

      if (!items.length) {
        // A bare dash would age into a claim about the world rather than a claim
        // about a moment, so the empty state carries the date it was true.
        return table(['Date', 'Item', 'Classification'], [[
          '—',
          `As of ${longDate(c.generated)}, nothing has arrived beyond the four letters above.`,
          '—',
        ]]);
      }

      const shown = items.slice(0, limit);
      const rows = shown.map((e) => [
        longDate(e.date),
        `[${e.title}](${href(e)})${e.summary ? ` — ${e.summary}` : ''}`,
        e.status || '—',
      ]);
      let md = table(['Date', 'Item', 'Classification'], rows);
      if (items.length > shown.length) {
        md += `\n\n[See all ${items.length} items](${base}/)`;
      }
      return md;
    }

    // The one date the page asserts about itself, inline in prose.
    case 'asof':
      return longDate(c.generated);

    // The count, so the Summary row cannot contradict the ledger.
    case 'answered': {
      const n = c.ledger.filter((r) => r.status !== 'No response').length;
      if (!n) return `None as of ${longDate(c.generated)}`;
      return `${n} of ${c.ledger.length} as of ${longDate(c.generated)}`;
    }

    default:
      throw new Error(`Unknown correspondence view '${view}' — `
        + 'expected letters, ledger, log, asof or answered');
  }
}

module.exports = correspondence;
