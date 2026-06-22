Andover Budget Process — Static Site
=====================================

Converts three Markdown documents about the Andover, CT budget process into a
static HTML site with a shared stylesheet.



Quick start
-----------

```bash
npm install marked
node convert.js
```

This reads the Markdown sources from `sources/` and generates HTML into the
project root.



Deploying
---------

Upload the root directory to any static web host. The key files are:

- `index.html` — main budget process overview
- `legal/index.html` — BOF–BOE authority analysis
- `charter/index.html` — charter revision suggestions
- `sources/` — original Markdown files and PDFs
- `style.css` — shared stylesheet
