# The link registry (`/links/`)

Stable, shareable pages for the sources cited in andoverct.info posts and
campaigns — especially Facebook posts, where a bare government-PDF link makes
an ugly preview and an archive.org link looks untrustworthy. Each source gets
a permanent URL like `https://andoverct.info/links/3/` with proper Open Graph
tags, so shared links unfurl into a clean preview card, and the destination
page shows the reader what the source is before sending them offsite.

There are two kinds of page:

- a **leaf** — one source: a title, a description, the link itself, and
  optionally a date and an archived copy;
- a **list** — a collection of leaves (and/or other lists), optionally
  organized into titled groups. A campaign typically gets one list page
  collecting all its sources.

Plus `links/index.html`, an auto-generated index of every collection.

## How it works

Everything is generated from hand-authored YAML files:

```
links/_src/<id>.yaml   →   links/<id>/index.html     (one page per doc)
                       →   links/index.html          (index of all lists)
```

Never edit the generated HTML — edit the YAML and rebuild:

```sh
npm run rebuild:links        # = node _build/links.mjs
```

It is always a full rebuild (the index and list pages depend on every doc).
Validation is strict: any schema problem, dangling reference, or parse error
fails the build, and **all** errors across all files are reported at once.
The build also prunes `links/<id>/` output directories whose source YAML was
deleted (only if they contain nothing but the generated `index.html`).

The generated pages are committed to git and published by the normal deploy
(`npm run deploy:go`, or `npm run publish` which rebuilds first).

## Authoring a leaf (single source)

File name is the id: `links/_src/<id>.yaml`, where `<id>` uses only letters,
digits, `_`, and `-`, and must match the `id:` field inside.

```yaml
id: 7
title: BOE budget presentation, March 2026
description: >-
  The Board of Education's proposed 2026-27 budget as presented at the
  March 4 public hearing. Retrieved from the district website.
url: https://example.org/boe/budget-2026-27.pdf
date: 2026-03-04
archived: https://web.archive.org/web/2026/https://example.org/boe/budget-2026-27.pdf
```

| Key           | Required | Rules                                                                                     |
| ------------- | -------- | ----------------------------------------------------------------------------------------- |
| `id`          | yes      | must equal the filename stem                                                               |
| `title`       | yes      | non-empty string; becomes the card's link text and the page's `og:title`                   |
| `description` | yes      | non-empty string; shown on the card and used as `og:description`                           |
| `url`         | yes      | the source itself — `http(s)://…` (external, marked ↗) or `/…` (internal, root-relative)   |
| `image`       | no       | `og:image` for the share preview — `/…` or `http(s)://…`; falls back to the site default   |
| `date`        | no       | `YYYY-MM-DD` — when the source was published or retrieved; shown on the card               |
| `archived`    | no       | `http(s)://…` link to an archived copy (e.g. Wayback Machine); shown as "archived copy"    |

No other keys are allowed.

## Authoring a list (collection)

A list references other docs **by id**. Either grouped:

```yaml
id: 100
title: Example link collection
description: >-
  Sources for the spring 2026 budget campaign.
groups:
  - title: Primary sources
    description: The sources this campaign quotes directly.
    links: [1, 2]
  - title: Related collections
    links: [101]
```

…or a flat, untitled single group:

```yaml
id: 101
title: Example ungrouped collection
description: A short pile of links with no section headings.
links: [2, 1]
```

Rules:

- Allowed keys: `id`, `title`, `description`, `image`, and exactly one of
  `groups` or `links`. Each group allows `title` (required), `description`,
  and `links`.
- Every referenced id must exist as a `links/_src/<id>.yaml` file, or the
  build fails.
- **Lists never nest.** Referencing another list from a list is fine, but it
  renders as a plain card linking to that list's own page — its contents are
  not inlined. This structurally rules out recursion.
- A repeated reference renders again, but only the **first** occurrence on a
  page carries the fragment anchor (below).

## Fragment anchors

Every card gets `id="link-<id>"` on its first occurrence per page, so you can
deep-link to one source inside a collection:

```
https://andoverct.info/links/100/#link-3
```

The targeted card is highlighted (gold outline) on arrival.

## Conventions

- Ids so far are plain numbers, assigned in order regardless of kind — leaves
  and lists share one sequence. Nothing enforces this — any slug matching
  `[A-Za-z0-9_-]+` works — but numeric ids sort numerically on the index.
- `description` should tell a reader what the source *is* and where/when it
  came from, in a sentence or two. It doubles as the Facebook preview text.
- For external sources that might disappear, add an `archived` Wayback link
  (save one at <https://web.archive.org/save> if none exists).
- Body hrefs stay root-relative so a local test vhost serves its own copies;
  only `og:url`, `og:image`, and `rel=canonical` are absolutized using
  `siteOrigin` from `_build/report.config.json`.

## Typical workflow: adding sources for a campaign

1. Create one `links/_src/<id>.yaml` leaf per source.
2. Create one list doc referencing them, e.g. `links/_src/120.yaml`.
3. `npm run rebuild:links` — fix any validation errors it reports.
4. Commit both the YAML and the generated HTML; `npm run deploy:go` (or
   `npm run publish`) to put the pages live.
5. Share `https://andoverct.info/links/120/` (or a `#link-<id>` fragment of
   it, or an individual leaf page) in the posts.
