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

(function () {
  'use strict';

  // Endpoint for the editions data. Use an absolute path so it works
  // regardless of which subdirectory of /the-facts/ we're being viewed from.
  var EDITIONS_URL = '/the-facts/editions.json';

  // Discover which edition we're viewing by looking at the path.
  //   /the-facts/editions/<id>/...  → long form, archived edition
  //   /the-facts/<id>/...           → short form, archived edition
  //   /the-facts/...                → current edition (dispatcher-served)
  function detectEditionId(editions, currentId) {
    var path = window.location.pathname;
    var longMatch = path.match(/\/editions\/([^\/]+)\//);
    if (longMatch && editions[longMatch[1]]) return longMatch[1];
    var shortMatch = path.match(/\/the-facts\/([^\/]+)(?:\/|$)/);
    if (shortMatch && editions[shortMatch[1]]) return shortMatch[1];
    return currentId;
  }

  function formatDate(iso) {
    // Display as "May 21, 2026"
    var parts = iso.split('-');
    if (parts.length !== 3) return iso;
    var monthNames = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
    var y = parts[0], m = parseInt(parts[1], 10) - 1, d = parseInt(parts[2], 10);
    if (m < 0 || m > 11) return iso;
    return monthNames[m] + ' ' + d + ', ' + y;
  }

  function permalink(id) {
    return '/the-facts/' + encodeURIComponent(id) + '/';
  }

  // Inject all the CSS we need so the host page doesn't have to.
  function injectStyles() {
    var css = [
      '.tf-banner {',
      '  background: #eef4fb;',
      '  border-bottom: 1px solid #c9a227;',
      '  padding: 8px 16px;',
      '  font-family: Georgia, "Times New Roman", serif;',
      '  font-size: 14px;',
      '  color: #5a4a1a;',
      '  text-align: center;',
      '}',
      '.tf-banner a { color: #143862; font-weight: bold; text-decoration: none; }',
      '.tf-banner a:hover { text-decoration: underline; }',
      '',
      '.tf-editions-button {',
      '  position: fixed;',
      '  top: 12px;',
      '  right: 12px;',
      '  z-index: 1000;',
      '  background: #fff;',
      '  border: 1px solid #888;',
      '  border-radius: 4px;',
      '  padding: 6px 12px;',
      '  font-family: Georgia, "Times New Roman", serif;',
      '  font-size: 13px;',
      '  cursor: pointer;',
      '  box-shadow: 0 1px 3px rgba(0,0,0,0.1);',
      '}',
      '.tf-editions-button:hover { background: #eef4fb; }',
      '',
      '.tf-editions-panel {',
      '  position: fixed;',
      '  top: 48px;',
      '  right: 12px;',
      '  z-index: 1001;',
      '  background: #fff;',
      '  border: 1px solid #888;',
      '  border-radius: 4px;',
      '  box-shadow: 0 4px 12px rgba(0,0,0,0.15);',
      '  min-width: 280px;',
      '  max-width: 380px;',
      '  display: none;',
      '}',
      '.tf-editions-panel.open { display: block; }',
      '.tf-editions-panel h3 {',
      '  margin: 0;',
      '  padding: 10px 14px;',
      '  border-bottom: 1px solid #ddd;',
      '  font-family: Georgia, serif;',
      '  font-size: 14px;',
      '  font-weight: bold;',
      '  color: #333;',
      '}',
      '.tf-editions-panel ul {',
      '  list-style: none;',
      '  margin: 0;',
      '  padding: 4px 0;',
      '}',
      '.tf-editions-panel li { margin: 0; padding: 0; }',
      '.tf-editions-panel a {',
      '  display: block;',
      '  padding: 8px 14px;',
      '  color: #222;',
      '  text-decoration: none;',
      '  font-family: Georgia, serif;',
      '  font-size: 13px;',
      '  line-height: 1.3;',
      '  border-left: 3px solid transparent;',
      '}',
      '.tf-editions-panel a:hover { background: #eef4fb; }',
      '.tf-editions-panel .tf-current a {',
      '  border-left-color: #e8a800;',
      '  background: #eef4fb;',
      '}',
      '.tf-editions-panel .tf-current a::after {',
      '  content: " (current)";',
      '  color: #143862;',
      '  font-style: italic;',
      '  font-size: 11px;',
      '}',
      '.tf-editions-panel .tf-date {',
      '  color: #888;',
      '  font-size: 11px;',
      '  display: block;',
      '  margin-top: 2px;',
      '}',
    ].join('\n');

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildBanner(currentId, currentEdition) {
    var banner = document.createElement('div');
    banner.className = 'tf-banner';
    banner.innerHTML =
      'You\u2019re reading an archived edition. ' +
      '<a href="/the-facts/">View the current edition: ' +
      escapeHtml(currentEdition.title) + ' \u2192</a>';
    document.body.insertBefore(banner, document.body.firstChild);
  }

  function buildEditionsMenu(data, viewingId) {
    var button = document.createElement('button');
    button.className = 'tf-editions-button';
    button.type = 'button';
    button.textContent = 'Other editions \u25BE';

    var panel = document.createElement('div');
    panel.className = 'tf-editions-panel';

    var heading = document.createElement('h3');
    heading.textContent = 'All editions';
    panel.appendChild(heading);

    var list = document.createElement('ul');

    // Build a sorted, filtered list of editions
    var ids = Object.keys(data.editions);
    var entries = ids
      .map(function (id) {
        var e = data.editions[id];
        return {
          id: id,
          title: e.title,
          date: e.date,
          hidden: !!e.hidden
        };
      })
      .filter(function (e) {
        // Hidden editions: omit unless we're currently viewing one
        return !e.hidden || e.id === viewingId;
      })
      .sort(function (a, b) {
        // Most recent first
        return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
      });

    entries.forEach(function (e) {
      var li = document.createElement('li');
      if (e.id === data.current) li.className = 'tf-current';
      var a = document.createElement('a');
      // The current edition's link goes to the rewriting URL,
      // not the permalink — so "current" stays current as it shifts over time.
      a.href = (e.id === data.current) ? '/the-facts/' : permalink(e.id);
      a.innerHTML = escapeHtml(e.title) +
        '<span class="tf-date">' + escapeHtml(formatDate(e.date)) + '</span>';
      li.appendChild(a);
      list.appendChild(li);
    });

    panel.appendChild(list);

    document.body.appendChild(button);
    document.body.appendChild(panel);

    button.addEventListener('click', function (ev) {
      ev.stopPropagation();
      panel.classList.toggle('open');
    });

    document.addEventListener('click', function (ev) {
      if (!panel.contains(ev.target) && ev.target !== button) {
        panel.classList.remove('open');
      }
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') panel.classList.remove('open');
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function init() {
    fetch(EDITIONS_URL, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('editions.json fetch failed: ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var viewingId = detectEditionId(data.editions, data.current);
        injectStyles();
        if (viewingId !== data.current && data.editions[data.current]) {
          buildBanner(data.current, data.editions[data.current]);
        }
        buildEditionsMenu(data, viewingId);
      })
      .catch(function (err) {
        // If editions.json fails to load, don't break the page — just log.
        if (window.console && console.warn) {
          console.warn('the-facts editions UI failed to initialize:', err);
        }
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
