#!/usr/bin/env node
/*
 * Renders /reports/55th/clippings/ — the public library of 2026 letters to the
 * editor on the 55th House District race (Ellen Paul vs. Steve Weir).
 *
 *   npm run rebuild:clippings
 *
 * Input, hand-maintained (tags, sides and sort keys were assigned by hand and no
 * pipeline regenerates them):
 *   reports/55th/clippings/letters.json
 *
 * Output:
 *   reports/55th/clippings/index.html   — the page (chrome from _build/templates/clippings.html)
 *
 * The table is rendered here, at build time, so the index is real HTML: it is
 * crawlable, readable without JavaScript, and appears with no fetch flash. The
 * inline script in the template then takes over for filtering, sorting and the
 * hash routes (#/<edition>, #/<edition>/p<N>, #/<edition>/p<N>/<slug>); it fetches
 * letters.json in the background for the letter pages and full-text search.
 *
 * Letter schema (see the file's top-level `tags[]` and `issues[]` for the
 * vocabularies): id, path, edition, dateLong, page, jumpPages[], headline, signer,
 * signerTown, sortName, note, salutation, closing, paragraphs[], pageUrl, side,
 * tags[], issues[], bills[], respondsTo[], mentionsWeir, mentionsEllenPaul.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { escapeHtml, pageNoteHtml, siteFooterBarHtml } from "./links.mjs"

const ROOT = join(import.meta.dirname, "..")
const DIR = join(ROOT, "reports/55th/clippings")
const TEMPLATE = join(ROOT, "_build/templates/clippings.html")

const data = JSON.parse(readFileSync(join(DIR, "letters.json"), "utf8"))
const { letters, tags, issues, archives } = data

// --------------- Derived facts ---------------

const editions = [...new Set(letters.map((l) => l.edition))].sort()
const bySide = letters.reduce((acc, l) => ({ ...acc, [l.side]: (acc[l.side] || 0) + 1 }), {})
const tagCount = (name) => letters.filter((l) => l.tags.includes(name)).length
const count = (pick) => letters.reduce((acc, l) => {
  pick(l).forEach((v) => acc.set(v, (acc.get(v) || 0) + 1))
  return acc
}, new Map())

const writers = [...count((l) => [l.signer]).entries()]
  .map(([signer, n]) => ({ signer, n, sortName: letters.find((l) => l.signer === signer).sortName }))
  .sort((a, b) => a.sortName.localeCompare(b.sortName) || a.signer.localeCompare(b.signer))
const bills = [...count((l) => l.bills).entries()]
  .sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true }))
const issueCounts = count((l) => l.issues)

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const shortDate = (ed) => {
  const [, m, d] = ed.split("-").map(Number)
  return `${MONTHS[m - 1]} ${d}`
}
const fmtN = (n) => n.toLocaleString("en-US")
const attr = (s) => escapeHtml(String(s ?? ""))
const joinAttr = (xs) => attr((xs || []).join("|"))

const tagDescription = Object.fromEntries(tags.map((t) => [t.name, t.description]))

// --------------- Table ---------------

const pillHtml = (name) =>
  `<a class="pill" href="#/?tag=${encodeURIComponent(name)}" data-tag="${attr(name)}" title="${attr(tagDescription[name] || "")}">${escapeHtml(name)}</a>`

const sideTitle = (side) => (side === "Paul"
  ? "Supports Paul and/or criticizes Weir"
  : "Supports Weir and/or criticizes Paul")
const sideHtml = (side) =>
  `<a class="side side-${side.toLowerCase()}" href="#/?side=${side}" data-side="${side}" title="${sideTitle(side)}">${side}</a>`

// The search haystack carried on the row: everything but the body text, which
// the client adds from letters.json once that has loaded.
const haystack = (l) => [l.headline, l.signer, l.signerTown, l.note, l.dateLong, l.edition, ...l.tags, ...l.issues, ...l.bills]
  .filter(Boolean).join(" ").toLowerCase()

const rowHtml = (l, n) => `
        <tr class="letter ${l.side.toLowerCase()}" data-id="${attr(l.id)}" data-path="${attr(l.path)}" data-n="${n}"
            data-edition="${l.edition}" data-page="${l.page}" data-headline="${attr(l.headline.toLowerCase())}"
            data-sort="${attr(l.sortName.toLowerCase())}" data-writer="${attr(l.signer)}" data-side="${l.side}"
            data-tags="${joinAttr(l.tags)}" data-issues="${joinAttr(l.issues)}" data-bills="${joinAttr(l.bills)}"
            data-hay="${attr(haystack(l))}">
          <td class="c-date"><a href="#/${l.edition}" title="${attr(l.dateLong)}">${shortDate(l.edition)}</a></td>
          <td class="c-page"><a href="#/${l.edition}/p${l.page}" title="Page ${l.page}, ${attr(l.dateLong)}">${l.page}</a></td>
          <td class="c-title"><a href="#/${attr(l.path)}">${escapeHtml(l.headline)}</a></td>
          <td class="c-writer">${escapeHtml(l.signer)}${l.signerTown ? `<span class="town">${escapeHtml(l.signerTown)}</span>` : ""}</td>
          <td class="c-tags">${l.tags.map(pillHtml).join("")}</td>
          <td class="c-side">${sideHtml(l.side)}</td>
        </tr>`

// Source order is chronological; the client re-sorts, but newest-first is the
// default view, so emit it that way for the no-JavaScript reader too.
const ordered = letters
  .map((l, n) => ({ l, n }))
  .sort((a, b) => b.l.edition.localeCompare(a.l.edition) || a.l.page - b.l.page || a.n - b.n)
const tableRows = ordered.map(({ l, n }) => rowHtml(l, n)).join("")

// --------------- Filter controls ---------------

const chipsHtml = tags
  .map((t) => `<button type="button" class="chip" data-tag="${attr(t.name)}" title="${attr(t.description)}" aria-pressed="false">${escapeHtml(t.name)} <span class="n">${tagCount(t.name)}</span></button>`)
  .join("\n          ")

const optionHtml = (value, label) => `<option value="${attr(value)}">${escapeHtml(label)}</option>`
const issueOptions = issues.map((i) => optionHtml(i, `${i} (${issueCounts.get(i) || 0})`)).join("\n            ")
const writerOptions = writers.map((w) => optionHtml(w.signer, `${w.signer}${w.n > 1 ? ` (${w.n})` : ""}`)).join("\n            ")
const billOptions = bills.map(([b, n]) => optionHtml(b, `${b}${n > 1 ? ` (${n})` : ""}`)).join("\n            ")

// --------------- Page-level data for the client ---------------

// Small, so it is inlined: the per-edition PDF links and long dates for the
// edition/page headings, and the tag tooltips for the letter page.
const editionMeta = Object.fromEntries(editions.map((ed) => [ed, {
  dateLong: letters.find((l) => l.edition === ed).dateLong,
  archive: archives[ed] || null,
  n: letters.filter((l) => l.edition === ed).length,
}]))
const pageMeta = JSON.stringify({ editions: editionMeta, tags: tagDescription })
  .replace(/</g, "\\u003c")   // never let a "</script>" out of the data

// --------------- Fill the template ---------------

const first = editionMeta[editions[0]].dateLong
const last = editionMeta[editions[editions.length - 1]].dateLong
const scottN = letters.filter((l) => l.signer === "Scott Sauyet").length
const footerNote = `Source: the Reader Forum of the <em>Rivereast News Bulletin</em>, ${first} through ${last}, via the paper&rsquo;s <a href="https://glcitizen.com/archives/">online archive</a>. Text was extracted from the archive PDFs and may carry extraction errors; the linked page is authoritative. Tags, issues and sides were assigned by the compiler as a finding aid.`

const fills = {
  "{{N_LETTERS}}": fmtN(letters.length),
  "{{N_EDITIONS}}": fmtN(editions.length),
  "{{N_PAUL}}": fmtN(bySide.Paul || 0),
  "{{N_WEIR}}": fmtN(bySide.Weir || 0),
  "{{N_SCOTT}}": fmtN(scottN),
  "{{FIRST_DATE}}": first,
  "{{LAST_DATE}}": last,
  "{{CHIPS}}": chipsHtml,
  "{{ISSUE_OPTIONS}}": issueOptions,
  "{{WRITER_OPTIONS}}": writerOptions,
  "{{BILL_OPTIONS}}": billOptions,
  "{{ROWS}}": tableRows,
  "{{PAGE_META}}": pageMeta,
  "{{FOOTER}}": `${pageNoteHtml(footerNote)}\n${siteFooterBarHtml()}`,
}

const template = readFileSync(TEMPLATE, "utf8")
const missing = Object.keys(fills).filter((k) => !template.includes(k))
if (missing.length) throw new Error(`template lacks ${missing.join(", ")}`)
const html = Object.entries(fills).reduce((out, [k, v]) => out.split(k).join(v), template)
writeFileSync(join(DIR, "index.html"), html)

console.log(`clippings: ${letters.length} letters, ${editions.length} editions (Paul ${bySide.Paul}, Weir ${bySide.Weir}), ${writers.length} writers, ${bills.length} bills → index.html`)
