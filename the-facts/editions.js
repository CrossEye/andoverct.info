/**
 * the-facts: edition awareness UI
 *
 * Loaded by every edition's index.html. Provides:
 *  - A subtle banner at the top when viewing a non-current edition.
 *  - An "Other Editions" dropdown in the corner that lists all visible editions.
 *
 * This script figures out which edition it's running on by inspecting the
 * URL. URLs under /the-facts/editions/<id>/ identify themselves as edition id;
 * URLs that don't go through that path are assumed to be the current edition
 * (i.e., they were rewritten by .htaccess).
 */

;(() => {
  'use strict'

  // Endpoint for the editions data. Use an absolute path so it works
  // regardless of which subdirectory of /the-facts/ we're being viewed from.
  const EDITIONS_URL = '/the-facts/editions.json'

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]

  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

  // Discover which edition we're viewing by looking at the path.
  //   /the-facts/editions/<id>/...  → long form, archived edition
  //   /the-facts/<id>/...           → short form, archived edition
  //   /the-facts/...                → current edition (dispatcher-served)
  const detectEditionId = (editions, currentId) => {
    const path = window.location.pathname
    const longMatch = path.match(/\/editions\/([^\/]+)\//)
    if (longMatch && editions[longMatch[1]]) return longMatch[1]
    const shortMatch = path.match(/\/the-facts\/([^\/]+)(?:\/|$)/)
    if (shortMatch && editions[shortMatch[1]]) return shortMatch[1]
    return currentId
  }

  // Display as "May 21, 2026"
  const formatDate = (iso) => {
    const parts = iso.split('-')
    if (parts.length !== 3) return iso
    const [y, rawM, rawD] = parts
    const m = parseInt(rawM, 10) - 1
    return (m < 0 || m > 11) ? iso : `${MONTH_NAMES[m]} ${parseInt(rawD, 10)}, ${y}`
  }

  const permalink = (id) => `/the-facts/${encodeURIComponent(id)}/`

  /*
   * Inject all the CSS we need so the host page doesn't have to. Colours come
   * from the edition skin's custom properties wherever the skin defines one;
   * the neutrals below are panel chrome the skin has no token for.
   */
  const injectStyles = () => {
    const style = document.createElement('style')
    style.textContent = `
.tf-banner {
  background: var(--cream-deep);
  border-bottom: 1px solid #c9a227;
  padding: 8px 16px;
  font-family: var(--serif);
  font-size: 14px;
  color: #5a4a1a;
  text-align: center;
}
.tf-banner a { color: var(--burgundy); font-weight: bold; text-decoration: none; }
.tf-banner a:hover { text-decoration: underline; }

.tf-editions-button {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 1000;
  background: #fff;
  border: 1px solid #888;
  border-radius: 4px;
  padding: 6px 12px;
  font-family: var(--serif);
  font-size: 13px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.tf-editions-button:hover { background: var(--cream-deep); }

.tf-editions-panel {
  position: fixed;
  top: 48px;
  right: 12px;
  z-index: 1001;
  background: #fff;
  border: 1px solid #888;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  min-width: 280px;
  max-width: 380px;
  display: none;
}
.tf-editions-panel.open { display: block; }
.tf-editions-panel h3 {
  margin: 0;
  padding: 10px 14px;
  border-bottom: 1px solid #ddd;
  font-family: var(--serif);
  font-size: 14px;
  font-weight: bold;
  color: #333;
}
.tf-editions-panel ul {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}
.tf-editions-panel li { margin: 0; padding: 0; }
.tf-editions-panel a {
  display: block;
  padding: 8px 14px;
  color: #222;
  text-decoration: none;
  font-family: var(--serif);
  font-size: 13px;
  line-height: 1.3;
  border-left: 3px solid transparent;
}
.tf-editions-panel a:hover { background: var(--cream-deep); }
.tf-editions-panel .tf-current a {
  border-left-color: var(--gold);
  background: var(--cream-deep);
}
.tf-editions-panel .tf-current a::after {
  content: " (current)";
  color: var(--burgundy);
  font-style: italic;
  font-size: 11px;
}
.tf-editions-panel .tf-date {
  color: #888;
  font-size: 11px;
  display: block;
  margin-top: 2px;
}
`
    document.head.appendChild(style)
  }

  const buildBanner = (currentEdition) => {
    const banner = document.createElement('div')
    banner.className = 'tf-banner'
    banner.innerHTML = 'You’re reading an archived edition. '
      + '<a href="/the-facts/">View the current edition: '
      + `${escapeHtml(currentEdition.title)} →</a>`
    document.body.insertBefore(banner, document.body.firstChild)
  }

  // Most recent first. Hidden editions are omitted unless we're viewing one.
  const visibleEntries = (data, viewingId) => Object.entries(data.editions)
    .map(([id, e]) => ({ id, title: e.title, date: e.date, hidden: !!e.hidden }))
    .filter((e) => !e.hidden || e.id === viewingId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const buildEditionsMenu = (data, viewingId) => {
    const button = document.createElement('button')
    button.className = 'tf-editions-button'
    button.type = 'button'
    button.textContent = 'Other editions ▾'

    const panel = document.createElement('div')
    panel.className = 'tf-editions-panel'

    const heading = document.createElement('h3')
    heading.textContent = 'All editions'
    panel.appendChild(heading)

    const list = document.createElement('ul')

    visibleEntries(data, viewingId).forEach((e) => {
      const li = document.createElement('li')
      if (e.id === data.current) li.className = 'tf-current'
      const a = document.createElement('a')
      // The current edition's link goes to the rewriting URL, not the
      // permalink — so "current" stays current as it shifts over time.
      a.href = e.id === data.current ? '/the-facts/' : permalink(e.id)
      a.innerHTML = `${escapeHtml(e.title)}`
        + `<span class="tf-date">${escapeHtml(formatDate(e.date))}</span>`
      li.appendChild(a)
      list.appendChild(li)
    })

    panel.appendChild(list)
    document.body.appendChild(button)
    document.body.appendChild(panel)

    button.addEventListener('click', (ev) => {
      ev.stopPropagation()
      panel.classList.toggle('open')
    })

    document.addEventListener('click', (ev) => {
      if (!panel.contains(ev.target) && ev.target !== button) {
        panel.classList.remove('open')
      }
    })

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') panel.classList.remove('open')
    })
  }

  const init = () => {
    fetch(EDITIONS_URL, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`editions.json fetch failed: ${r.status}`)
        return r.json()
      })
      .then((data) => {
        const viewingId = detectEditionId(data.editions, data.current)
        injectStyles()
        if (viewingId !== data.current && data.editions[data.current]) {
          buildBanner(data.editions[data.current])
        }
        buildEditionsMenu(data, viewingId)
      })
      // If editions.json fails to load, don't break the page — just log.
      .catch((err) => console.warn('the-facts editions UI failed to initialize:', err))
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
