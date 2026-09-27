# Regenerating the ordinance transcription

The three text versions of the Town ordinance compilation in the parent folder
(`24_ordinance.md`, `.docx`, `.odt`) are produced from the scanned
`24_ordinance.pdf` by the two scripts here. Nothing in this folder is
deployed; the `_work/` directory it creates is gitignored.


## Requirements

- Python 3.12 with `pymupdf`, `pytesseract`, `Pillow`, `python-docx` and
  `odfpy` (`pip install pymupdf pytesseract Pillow python-docx odfpy`).
- Tesseract 5 with the English model. The scripts look for it at
  `C:\Program Files\Tesseract-OCR\tesseract.exe`; set the `TESSERACT`
  environment variable to point elsewhere.


## Steps

Run from this directory.

| Command             | Does                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `python ocr.py`     | Render each page at 300 dpi, OCR it, write `_work/tsv/` and `_work/ocr/`. Deskews PDF page 94 first. About five minutes; pages already done are skipped. |
| `python convert.py` | Rebuild the structured element list from the TSV files and write the three outputs to the parent folder. A few seconds. |
| `python crop.py …`  | Optional. Crop the scan around a phrase to check a reading, e.g. `python crop.py "67\|sufficient acts\|p67"`. Output in `_work/crops/`. |

The outputs are deterministic for a given Tesseract version (5.4.0 produced
the committed files): a rerun reproduces the Markdown byte for byte, and the
DOCX and ODT with identical content (only their internal zip timestamps
differ). Tesseract is sensitive to its input, so `ocr.py` feeds it the RGB
PNG from disk exactly as the first run did; passing a grayscale image instead
changes a handful of readings across most pages.


## Where the corrections live

`convert.py` has three tables near the top:

- `FIXES` — global regex substitutions for systematic OCR misreads
  (`shail` → `shall`, superscript ordinals, and so on).
- `PATCHES` — one-off corrections, each verified against the scan and each
  required to match exactly once. The printed page is in the comment.
- `MERGES` — paragraphs the OCR split in the wrong place.

The reasoning behind every entry is in `../ocr-review-followup-24_ordinance.md`.
Anything the Town's original typed wrongly is deliberately left alone; add
to `PATCHES` only for things the scan shows the OCR got wrong.


## How the structure is recovered

- Paragraphs come from Tesseract's own block/paragraph grouping, split further
  at outline markers (`A.`, `(1)`, `a.`) and at adoption-note keywords
  (`Passed`, `Published`, `Voted`…), and re-merged where Tesseract broke a
  paragraph at a full-width line.
- An ordinance title is an all-caps paragraph directly above a `NN-NN` code
  line. Section headings are all-caps `SECTION n` or `n.` paragraphs.
- Indent level is the paragraph's left edge, measured from the flush-left
  body column (255 px) in half-inch steps (150 px). DOCX and ODT indent by
  that level; Markdown nests list items.
- The four index pages are rebuilt from word positions, attaching each
  page-number token to the nearest entry vertically.
- Printed page markers are computed as PDF page − 5.
