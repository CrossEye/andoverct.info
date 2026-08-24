#!/usr/bin/env node
/*
 * Renders /reports/55th/weir-votes/ from its dataset.
 *
 *   npm run rebuild:weir-votes
 *
 * Input (produced by the WeirVotes pipeline, `npm run export` there):
 *   reports/55th/weir-votes/all-votes.json   — one record per House roll call
 *   reports/55th/weir-votes/provenance.json  — build date, pipeline commit, counts, verify summary (optional)
 *
 * Output, all from the same JSON so they cannot drift from each other:
 *   reports/55th/weir-votes/index.html       — the page (chrome from _build/templates/weir-votes.html)
 *   reports/55th/weir-votes/weir-votes.md    — plain-text table for grep / diffs
 *   reports/55th/weir-votes/all-votes.csv    — flat table
 *
 * Record schema (see WeirVotes/src/parse.js): sessionId, sessionLabel,
 * sessionKind, year, rollCall, date, billNumber, billHumanForm, billTitle,
 * billTrackingUrl, billTextLinks[], rollCallPdfUrl, voteHeader, weirVote,
 * totals{voting,necessary,yea,nay,absent}, splits{D,R,O}{Y,N,X,A,OTHER},
 * vacantSeats, memberVotes{NAME: code}.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml, siteFooterHtml } from "./links.mjs";

const ROOT = join(import.meta.dirname, "..");
const DIR = join(ROOT, "reports/55th/weir-votes");
const TEMPLATE = join(ROOT, "_build/templates/weir-votes.html");

const records = JSON.parse(readFileSync(join(DIR, "all-votes.json"), "utf8"));
const provenance = existsSync(join(DIR, "provenance.json"))
  ? JSON.parse(readFileSync(join(DIR, "provenance.json"), "utf8"))
  : null;
const generated = provenance?.generated?.slice(0, 10) || new Date().toISOString().slice(0, 10);

// --------------- Grouping ---------------

// Sessions in dataset order (records are sorted by year, date, roll call):
// each year's regular session first, then its special session(s).
const sessions = new Map();
for (const r of records) {
  if (!sessions.has(r.sessionId)) sessions.set(r.sessionId, { id: r.sessionId, label: r.sessionLabel, kind: r.sessionKind, rows: [] });
  sessions.get(r.sessionId).rows.push(r);
}

function classifyAlignment(weir, splits) {
  if (!weir || !splits?.R) return "";
  if (weir === "X" || weir === "A") return "absent";
  const rMajority = splits.R.Y >= splits.R.N ? "Y" : "N";
  return weir === rMajority ? "with-r" : "against-r";
}

function summarize(rows) {
  const s = { yea: 0, nay: 0, absent: 0, withParty: 0, againstParty: 0 };
  for (const r of rows) {
    if (r.weirVote === "Y") s.yea++;
    else if (r.weirVote === "N") s.nay++;
    else if (r.weirVote === "X" || r.weirVote === "A") s.absent++;
    const a = classifyAlignment(r.weirVote, r.splits);
    if (a === "with-r") s.withParty++;
    else if (a === "against-r") s.againstParty++;
  }
  return s;
}

const fmtN = (n) => n.toLocaleString("en-US");

// --------------- HTML ---------------

function voteCellHtml(v) {
  if (!v) return '<span class="v v-na">—</span>';
  const cls = { Y: "v-y", N: "v-n", X: "v-x", A: "v-a" }[v] || "v-other";
  const label = { Y: "Yea", N: "Nay", X: "Absent", A: "Abstain" }[v] || v;
  return `<span class="v ${cls}" title="${label}">${v}</span>`;
}

function partyTotalText(splits) {
  const fmt = (b) => (b ? `${b.Y}–${b.N}${b.X || b.A || b.OTHER ? ` (abs ${b.X + b.A + b.OTHER})` : ""}` : "—");
  return `D ${fmt(splits.D)}<br>R ${fmt(splits.R)}<br>O ${fmt(splits.O)}`;
}

function totalsText(t) {
  return `${t.yea ?? "?"}–${t.nay ?? "?"}${t.absent != null ? `<br><span class="dim">(${t.absent} not voting)</span>` : ""}`;
}

function rowHtml(r) {
  const align = classifyAlignment(r.weirVote, r.splits);
  const text = r.billTextLinks?.[0] ? ` &middot; <a href="${escapeHtml(r.billTextLinks[0].url)}">text</a>` : "";
  return `
          <tr class="rc rc-${align}">
            <td class="num">${r.rollCall}</td>
            <td class="date">${escapeHtml(r.date || "")}</td>
            <td class="bill">
              <a href="${escapeHtml(r.billTrackingUrl)}"><strong>${escapeHtml(r.billHumanForm)}</strong></a>
              ${r.voteHeader ? `<span class="suffix">${escapeHtml(r.voteHeader)}</span>` : ""}
              ${r.billTitle ? `<div class="title">${escapeHtml(r.billTitle)}</div>` : ""}
              <div class="links">
                <a href="${escapeHtml(r.rollCallPdfUrl)}">roll call PDF</a>${text}
              </div>
            </td>
            <td class="weir">${voteCellHtml(r.weirVote)}</td>
            <td class="totals">${totalsText(r.totals)}</td>
            <td class="splits">${partyTotalText(r.splits)}</td>
          </tr>`;
}

function sessionHtml(s) {
  const sum = summarize(s.rows);
  const dates = s.rows.map((r) => r.date).filter(Boolean).sort();
  const span = s.kind === "regular" ? "" : ` <span class="dates">(${dates[0]}${dates[dates.length - 1] !== dates[0] ? ` – ${dates[dates.length - 1]}` : ""})</span>`;
  return `
      <section class="session" id="${escapeHtml(s.id)}">
        <h2>${escapeHtml(s.label)}${span}</h2>
        <p class="summary">
          <strong>${s.rows.length}</strong> House floor votes recorded.
          Weir voted Yea on <strong>${sum.yea}</strong>,
          Nay on <strong>${sum.nay}</strong>,
          was absent on <strong>${sum.absent}</strong>.
          Voted <strong>with</strong> his party caucus on
          <strong>${sum.withParty}</strong>,
          <strong>against</strong> on <strong>${sum.againstParty}</strong>.
        </p>
        <table>
          <thead>
            <tr>
              <th>RC#</th><th>Date</th><th>Bill</th><th>Weir</th><th>Total</th><th>By party (Y–N)</th>
            </tr>
          </thead>
          <tbody>${s.rows.map(rowHtml).join("")}
        </tbody>
        </table>
      </section>
`;
}

const jump = `<nav class="jump">
  Jump to: ${[...sessions.values()].map((s) => `<a href="#${escapeHtml(s.id)}">${escapeHtml(s.label)}</a>`).join("")}
</nav>
`;

const perSession = [...sessions.values()].map((s) => `${s.rows.length} ${s.label.replace(/^\d{4} /, "")} ${s.rows[0].year}`);
const provenanceHtml = `
<section class="provenance" id="provenance">
  <h2>Provenance and checks</h2>
  <p>
    Every row is parsed from the official roll-call PDF the row links to; the
    member grid on each PDF is reconciled against the PDF's own printed
    yea / nay / absent totals, and each member's party is read from the
    PDF's caucus blocks. Roll-call numbers are enumerated from the daily
    House Journals and cross-checked against the vote links on every bill's
    CGA status page. Special sessions are included; veto sessions held no
    House roll calls.
    ${provenance ? `Built ${escapeHtml(generated)} from WeirVotes commit <code>${escapeHtml(String(provenance.commit || "").slice(0, 10))}</code>; ${escapeHtml(provenance.verify?.summary || "")}` : ""}
  </p>
  <p>
    Downloads: <a href="all-votes.csv">all-votes.csv</a> ·
    <a href="all-votes.json">all-votes.json</a> (with every member's vote on every roll call) ·
    <a href="weir-votes.md">weir-votes.md</a>.
  </p>
</section>
`;

const body = jump + [...sessions.values()].map(sessionHtml).join("\n") + provenanceHtml;
const footerNote = `Generated ${generated} from the Connecticut General Assembly's roll-call PDFs · ${fmtN(records.length)} votes across ${sessions.size} sessions · Vote codes: Y = Yea, N = Nay, X = Absent / not voting, A = Abstain`;

const template = readFileSync(TEMPLATE, "utf8");
if (!template.includes("{{BODY}}") || !template.includes("{{FOOTER}}")) throw new Error("template lacks {{BODY}}/{{FOOTER}}");
const html = template.replace("{{BODY}}", body).replace("{{FOOTER}}", siteFooterHtml(footerNote));
writeFileSync(join(DIR, "index.html"), html);

// --------------- Markdown ---------------

const md = ["# Steve Weir (R-55) — CT House floor votes", "", `Generated ${generated}. ${records.length} votes total.`, ""];
for (const s of sessions.values()) {
  const sum = summarize(s.rows);
  md.push(`## ${s.label}`, "");
  md.push(`${s.rows.length} votes. Weir Y/N/abs: ${sum.yea}/${sum.nay}/${sum.absent}. With-party / against-party: ${sum.withParty}/${sum.againstParty}.`, "");
  md.push("| RC# | Date | Bill | Title | Weir | Yea–Nay | D Y–N | R Y–N |", "|---|---|---|---|---|---|---|---|");
  for (const r of s.rows) {
    const t = r.totals || {}, d = r.splits?.D || {}, R = r.splits?.R || {};
    md.push(`| ${r.rollCall} | ${r.date || ""} | [${r.billHumanForm}](${r.billTrackingUrl}) | ${(r.billTitle || "").replace(/\|/g, "\\|").slice(0, 80)} | ${r.weirVote || "—"} | ${t.yea ?? "?"}–${t.nay ?? "?"} | ${d.Y ?? "?"}–${d.N ?? "?"} | ${R.Y ?? "?"}–${R.N ?? "?"} |`);
  }
  md.push("");
}
writeFileSync(join(DIR, "weir-votes.md"), md.join("\n"));

// --------------- CSV ---------------

const csvCell = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = [
  ["session_id", "session_label", "year", "date", "roll_call", "bill_number", "bill_title", "weir_vote", "total_voting", "yea", "nay", "absent",
    "d_yea", "d_nay", "r_yea", "r_nay", "o_yea", "o_nay", "tracking_url", "rollcall_pdf_url"].join(","),
];
for (const r of records) {
  csv.push([r.sessionId, r.sessionLabel, r.year, r.date, r.rollCall, r.billHumanForm, r.billTitle, r.weirVote, r.totals?.voting, r.totals?.yea, r.totals?.nay, r.totals?.absent,
    r.splits?.D?.Y, r.splits?.D?.N, r.splits?.R?.Y, r.splits?.R?.N, r.splits?.O?.Y, r.splits?.O?.N, r.billTrackingUrl, r.rollCallPdfUrl].map(csvCell).join(","));
}
writeFileSync(join(DIR, "all-votes.csv"), csv.join("\n"));

console.log(`weir-votes: ${records.length} records → index.html, weir-votes.md, all-votes.csv (generated ${generated}; ${perSession.join(", ")})`);
