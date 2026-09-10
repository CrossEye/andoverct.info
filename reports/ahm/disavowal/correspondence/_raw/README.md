# Raw email headers — never published

Full raw header blocks for received correspondence, one file per entry, named
`<entry-id>.headers.txt`.

**Nothing in this directory reaches the server.** It is excluded from the
`reports` area in `_build/site.manifest.json`, and `manifest.neverPublish`
makes a matching path a hard deploy failure rather than a silent upload, so the
exclusion is enforced twice and by machine.

The published entry pages show six headers — From, To, Cc, Date, Subject,
Message-ID, DKIM-Signature — **derived from these files** by `reduceHeaders()`
in `_build/correspondence.mjs`. Never hand-copy a reduced block: an allowlist
cannot accidentally keep a `Received` line, and a person can.

What the allowlist drops, and why:

- `Received` — the routing chain carries originating IP addresses. A reply sent
  from a personal account could be geolocated from one, which collides with the
  standing rule that personal addresses stay out of this tree.
- `X-Spam-*` and similar — a spam score characterizes a sender, and nothing here
  characterizes a candidate.

These files exist so that a disputed message can be authenticated. That is a
rare, deliberate, offline act; it does not need to be reachable over the web.
Keeping them in the (private) repo rather than on the box means git timestamps
make them tamper-evident, with no server-side surface to misconfigure.
