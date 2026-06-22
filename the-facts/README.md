# the facts

A rotating series of single-page civic explainers published at
`andoverct.info/the-facts`. Each "edition" is a self-contained newspaper-style
page authored in Markdown and built into an `index.html` styled by a shared
template.

## Build an edition

From the repo root (`andoverct.info/`):

```sh
npm install                                                 # once
node the-facts/_build/render.js the-facts/editions/<id>     # build one
node the-facts/_build/render.js --all                       # build them all
```

Output goes next to the source as `index.html`.

## Add a new edition

1. Create `the-facts/editions/<edition-id>/<edition-id>.md` with YAML
   frontmatter (schema in
   [.claude/skills/the-facts-edition/SKILL.md](../.claude/skills/the-facts-edition/SKILL.md)).
2. Drop any image / PDF assets into the same folder.
3. Run the build command above.
4. Add a registry entry in [editions.json](editions.json). If this edition
   should be the one served at `/the-facts/`, set `"current"` to its id.

Each edition is reachable at two URLs:
- `/the-facts/<id>/` — short form, served via the dispatcher
- `/the-facts/editions/<id>/` — long form, served directly by Apache

Both produce the same page. Prefer the short form for sharing.

## Folder layout

```
the-facts/
  _build/
    render.js          # the renderer
    template.html      # HTML skeleton + all CSS (styling lives here)
  editions/
    <edition-id>/
      <edition-id>.md  # source — edit this
      index.html       # generated — do not hand-edit
      *.jpg, *.pdf     # assets
  editions.json        # registry (current edition + metadata)
  editions.js          # client-side edition awareness UI
  _dispatch.php        # rewrites /the-facts/ to the current edition
```

## Conventions

The renderer supports plain markdown plus a small set of opt-in custom
blocks (math-block, data-section, ecs-chart), a frontmatter-driven
hero/CTA/colophon, blockquote attribution, and `[PLACEHOLDER: ...]`
markers for drafts. All of that is documented in
[the skill](../.claude/skills/the-facts-edition/SKILL.md).

## Dependencies

`marked` and `gray-matter`, declared in the root [package.json](../package.json).
Node modules live at the repo root so the deployable `the-facts/` tree
stays clean for FTP/SCP.
