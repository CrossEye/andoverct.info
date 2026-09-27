OCR Review Follow-up: 24_ordinance.md
=====================================

Companion to `ocr-review-24_ordinance.md`. That review proposed corrections to
the OCR text recovered from the Town of Andover ordinance compilation
(`24_ordinance.pdf`, 97 pages). This note records what was actually changed
on 2026-09-26, where the scan contradicted the review, and what is still wrong
in the document as it now stands.

Method: every item in the review's sections 2 and 3, and every
character-level item in section 1 whose fix was a guess about the original
(letter shapes, digits, dropped words), was checked by cropping the scanned
page at the line in question and reading it. Stray punctuation marks that are
not letters at all were removed without a crop where noted below. Page numbers
are the printed page numbers from the `<!-- p. N -->` markers.

All changes were made in the conversion script, not by hand-editing the
Markdown, so `24_ordinance.md`, `24_ordinance.docx` and `24_ordinance.odt`
were regenerated together and agree with each other. The script and its two
OCR stages are in `Dev/temp/ordinance-ocr/`; each patch there is a regular
expression that must match exactly once, and the build warns if it does not.



1. Changes made
---------------

### 1a. Verified against the scan ###

  - p. 4: `proper proceedings the Circuit Court` → `proceedings I the Circuit
    Court`. The scan has a capital `I` (the Town's typo for "in"); the OCR
    read it as a bar and the build discarded it as a margin mark.
  - p. 8: `as the case. may require` → `as the case may require`
  - p. 9: `andthe penalty` → `and the penalty` (the scan has a visible gap
    between the words); `this-ordinance` → `this ordinance`
  - p. 9, p. 13: `Town of — Andover` / `Town of ° Andover` → `Town of Andover`
  - p. 11: `windows Shall be not less` → `shall`
  - p. 17: `shall be. appointed` → `shall be appointed`
  - p. 20: `REFUSE -—` → `REFUSE –` (the scan has one en dash)
  - p. 21: `All moneys 5 equal` → `All moneys equal`
  - p. 23: nothing changed; see section 2
  - p. 24: `(c Jof the` → `(c) of the`, and the following `(c) of the
    Connecticut General Statutes, and for passive...` rejoined to its
    paragraph
  - p. 35: `(I) YARD WASTE` → `(l)`; p. 41: `(I) RECYCLABLES` → `(l)`,
    `(0) RECYCLING BOX` → `(o)`; p. 44: `1) The Administrator of the
    Recycling. Program` → `l) The Administrator of the Recycling Program`.
    In the scan's Calibri, `I` and `l` are indistinguishable; the letter
    sequence settles it.
  - p. 45-46: `Section 2 of Public Act.` / `90-220.` rejoined as `Section 2
    of Public Act 90-220.`
  - p. 46: `the. Town` → `the Town`
  - p. 47: `in‘accordance` → `in accordance`; `May 17, 1996..` → single
    period
  - p. 60: `the-ordinary course` → `the ordinary course`
  - p. 62: `serve asa public official` → `as a`
  - p. 64: `Financial Benefit.` → `I. Financial Benefit.` (label present in
    the scan, lost by OCR)
  - p. 67: `alleges sufficient acts` → `sufficient facts` (the one section 2
    item that was an OCR error)
  - p. 68: `No complaint may be made...` → `I. No complaint may be made...`
    (same as p. 64)
  - p. 75: `section 7- 103` → `7-103`
  - p. 77: `detine, prohibit` → `define, prohibit`
  - p. 78: `Code 117.2. 1` → `117.2.1`
  - p. 79: `4, Be served` → `4. Be served`; p. 80: `9. State that` → `5.
    State that`
  - p. 91: `Section 7-148(c)` / `(10) for each` rejoined as `7-148(c)(10)`;
    `Penalty. under` → `Penalty under`

### 1b. Stray marks removed without a crop ###

These are punctuation or symbols that cannot be text, so they were removed on
the review's say-so. If any of them turns out to mask a real character, the
scan is the authority.

  - p. 12: `reasonable © hours`
  - p. 15: `Vinick,et al` → `Vinick, et al`
  - p. 17: `or. boundary`, `anda copy`
  - p. 20: `Shall be fined` → `shall`
  - p. 22: `said. Eastern`
  - p. 23: `with. the New Samaritan`
  - p. 32: `may. be located`, `BUISSNESS AND. FOR` (misspelling kept)
  - p. 40: `ail persons` → `all`
  - p. 44: `driver — of the vehicle`
  - p. 48: `relief: program`
  - p. 49: trailing `“` after `taxpayer;`, `unpaid: taxes`
  - p. 51: `‘sewer rates`
  - p. 56: `21 days.after`
  - p. 62: trailing `—` after `appointment.`, `ina speech` → `in a`
  - p. 64: `\_member` → `member`
  - p. 65: `municipal ‘ordinance`
  - p. 67: `certified mail. within`
  - p. 69: `Town of Andover. contract`
  - p. 72: `ina newspaper` → `in a`
  - p. 85: `‘remedied`
  - p. 87: `set. forth`

### 1c. Global normalizations already in the first build ###

These were applied across the whole document before the review, and are noted
here because they alter the scan's typography, not just OCR noise.

  - A space is inserted after a period glued to a capital letter. Seven
    places, all in adoption notes: `1958.Published`, `1966.Published` (×3),
    `1974.Published`, `2007.Revised`, `1991.Seconded`. The scan has no space
    in any of them. Harmless, but not strictly faithful.
  - `(c )` with an internal space is written `(c)` in 25 places. The scan
    has the space in every one (it is how the original was typed).
  - Superscript ordinals (`July 1st`, `March 1st`) are written `1st`; the
    OCR had read the superscripts as `°`, `*`, `™` or `%`.
  - `shail` → `shall`, `lt`/`lf` at sentence start → `It`/`If`, `wiil` →
    `will`, `Ail` → `All`, `tess $` → `less $`. These are classic Tesseract
    shape confusions and were applied without cropping each instance.
  - Curly quotes are preserved as scanned.



2. Where the scan disagreed with the review
-------------------------------------------

The review's section 2 asked for verification; in every case but one the
text is what the Town typed. Several section 1 items also turned out to be
original. All of these are left as they stand.

### Section 2 items confirmed as original ###

  - p. 22: `the full taxes what would be due`
  - p. 32: `before a permit is used to a business`
  - p. 33: `shell be issued`
  - p. 34: `plate or try`
  - p. 36: `Revision of Section 5 passed at Annual Town Meeting October 4,
    1965` (printed exactly so, after the 1990 adoption note)
  - p. 40: `contamination by good or other material`
  - p. 72: `effective date or this ordinance`
  - p. 76: `may be referred to ask the`
  - p. 80: `may apply ... or an extension` and `grant on extension` (both
    printed that way; the review had listed the second as an artifact)
  - p. 83: `upon a finding or proper notice`
  - p. 87: `their liability of their designee`
  - p. 91: `likely remove all excavation equipment`

### Section 1 items that are in fact original ###

  - p. 1: `with75 foot radius` (no space in the scan)
  - p. 11: `adjoining round`
  - p. 23: `Passed by voice vert.`
  - p. 25: `base blood level`, `to void impairment`
  - p. 46: `Section 7-14B(c )(10)(A)` (`14B`, not `148`)
  - p. 53: `(EMT-8)` (`8`, not `B`)
  - p. 64: `pert he requirements`
  - p. 67, 68: `ducestecum`
  - p. 72: `with n the Town`, `Definitions>`, `the tern “oil waste”`
  - p. 75: `section 1-2000(6)(A)`
  - p. 87: `Section 9: Heating Procedure`
  - p. 88: `Section 8-7allowing`

### Section 3, suspected dropped lines ###

None of the four is an OCR loss.

  - p. 9, Garden Apartment Code § 4.3: the typed original has a blank gap
    after `provided, that` and another after `which he may adopt`. Whatever
    was meant to be there was never typed. The OCR text is complete.
  - p. 12, Rental Housing Code § 3: the original omits the owner/occupant
    clause and repeats `at all reasonable hours for the purpose` twice.
  - p. 53, definition 3: the EMT sentence is a fragment in the original.
  - p. 74, fracking definitions: the original letters the oil-waste
    definitions `f.` through `k.` continuing from the natural-gas list, and
    `tern` is typed so.

### Apostrophes ###

The scan has none of the missing possessives (`Towns Commission`, `eligible
members years of active service` and so on). They are absent in the
original, not lost in OCR, and are not restored.



3. Errors still in the document
-------------------------------

### 3a. The Town's own errors, preserved deliberately ###

Spelling: CONNECTIUT (p. 1), ASEEMBLY (p. 6), OFFICALS (p. 6), REQURIEMENTS,
ENFORECEMENT (p. 8, 12), PRESCIBING (p. 20), ENERYGY (p. 24), CONSTURCTION
(p. 25), RECYCABLE, BUISNESS (p. 31), BUISSNESS, PREMIT (p. 32), ABTEMENT
(p. 49), PROVIDIING (p. 47), AMMENDMENT, ORIDINANCE (p. 89), ASSESTMENT
(index), plus everything in section 2 above.

Wording: `eight (80)` (p. 11), `nay act` (p. 12), `shall obtain shall obtain`
(p. 25), `in a matter in a matter` (p. 64), `the total of the total` (p. 11),
`with75`, `Section 11-8` cited on p. 26 for a section that does not exist,
`Section 15(c) of this Ordinance` cited on p. 46 in an ordinance with 13
sections, and the GLASS FOOD CONTAINER definition on p. 34 that describes a
polyethylene bottle.

Numbering: ordinance numbers do not follow one scheme. `01-16` is a 2016
ordinance, `01-06` a 2006 one, `01-04` a 2004 one, and `21-05` sits between
`04-21` and `24-01` where the 2021 series would want `05-21`. Ordinance `81-01`
is printed before `80-01`.

Index: at least two page references do not match the printed pages. OFFICE
HOURS is indexed at 26 but the ordinance is on 29, and DRIVEWAYS at 3 points
to ordinance 60-03, which was repealed in 2024 and no longer appears there.
The other entries were not systematically checked. Treat the index as
approximate.

### 3b. Limits of the OCR conversion itself ###

  - Bold and underline inside running text (for example `REPEALED` and
    `DELETED` on p. 3, the defined terms in the Ethics code) are not
    reproduced. Only whole-paragraph bold headings survive.
  - Indentation of outline clauses was recovered from the horizontal position
    of each paragraph in the scan. Where the original typist did not indent
    consistently, the levels follow the typing. On p. 25 the flood-plain
    clauses `A.` and `B.` are indented but `C.` is flush left and `D.` is
    indented again, exactly as printed; the lists in the Markdown reflect
    that.
  - In Markdown, outline items are nested list items. Numeric markers become
    ordered-list items and keep their numbers; letter and parenthesised
    markers become bullets with the original marker in the text, so a
    renderer shows `• (a) Be in writing`.
  - The blight ordinance's `"A. BLIGHT OR BLIGHTED` had a stray straight
    quote on p. 77 that the build strips. That quote is the only one in the
    document and is a scanner mark, not text.
  - Page 89 (printed) was skewed by about 1.2° and was deskewed before OCR;
    it is the only page where the OCR was re-run under different settings.
  - Printed page numbers were not read reliably on the first nine body pages
    (they are small and close to the edge), so the page markers are computed
    from the PDF page order (printed page = PDF page − 5) rather than read.
    They were checked against the pages that did read.
  - The four index pages were reassembled from word positions because the
    page-number column was scanned as a separate block. Two numbers the OCR
    never saw (`3` for the driveway regulations and `1` for the zoning
    enabling act) were read from the scan and inserted by hand.
  - No page has been proofread word by word against the scan. The review
    covered what a reading of the text turned up; the checks above covered
    what the review raised. Residual single-character misreads in ordinary
    words are still possible, most likely in the two housing codes (p. 7-14)
    and the ethics code (p. 58-70), which are the longest runs of small type.

### 3c. Open questions ###

  - Whether to keep the seven inserted spaces after `1991.Seconded`-style
    periods and the 25 `(c )` → `(c)` normalizations (section 1c), or revert
    to the scan's typography. Both are one-line changes in the script.
  - Whether a corrected edition (fixing the Town's own typos) is wanted as a
    separate output. The script can carry a second patch list for that
    without touching the faithful one.
