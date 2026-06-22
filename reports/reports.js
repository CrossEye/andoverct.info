/*
 * Renders report listings from /reports/reports.json into any element on the
 * page that carries a data-reports attribute:
 *
 *   <div data-reports="featured"></div>        -> reports where featured !== false
 *   <div data-reports="section:aes"></div>     -> reports in that section
 *
 * Optional: data-reports-heading="h2" (default "h3") sets the entry title tag.
 *
 * Featured listings use each report's `meta` + `summary` (one paragraph).
 * Section listings prefer `sectionMeta` + `detail` (multi-paragraph), falling
 * back to `meta` + `[summary]`. Order follows the JSON array. Keep a <noscript>
 * fallback inside the container for the no-JS case.
 *
 * Flags: a report with `hidden: true` is omitted from EVERY listing (featured
 * and its section) though it stays in the JSON and remains directly reachable.
 * `featured: false` drops a report from the top-level (root + /reports/) lists
 * only; it still appears on its section sub-index.
 */
(function () {
  var containers = document.querySelectorAll("[data-reports]");
  if (!containers.length) return;

  fetch("/reports/reports.json", { cache: "no-cache" })
    .then(function (r) {
      if (!r.ok) throw new Error("reports.json fetch failed: " + r.status);
      return r.json();
    })
    .then(function (data) {
      containers.forEach(function (c) {
        render(c, data);
      });
    })
    .catch(function (err) {
      if (window.console && console.warn) console.warn("reports index render failed:", err);
    });

  function render(container, data) {
    var spec = container.getAttribute("data-reports") || "featured";
    var heading = container.getAttribute("data-reports-heading") || "h3";
    var groupBy = container.getAttribute("data-reports-group");
    var groupHeading = container.getAttribute("data-reports-group-heading") || "h3";
    var reports = (data && data.reports) || [];
    var sections = (data && data.sections) || {};

    // Grouped top-level view: featured reports under linked section headings,
    // in the order the sections appear in reports.json.
    if (spec === "featured" && groupBy === "section") {
      container.innerHTML = Object.keys(sections)
        .map(function (key) {
          var sec = sections[key];
          var inSec = reports.filter(function (r) {
            return r.section === key && r.featured !== false && !r.hidden;
          });
          if (!inSec.length) return "";
          var label =
            "<" + groupHeading + ' class="group-label"><a href="' +
            escapeHtml(sec.url) + '">' + escapeHtml(sec.label) + "</a></" + groupHeading + ">";
          var entries = inSec
            .map(function (r) {
              return entryHtml({ url: r.url, title: r.title, meta: r.meta || [], paras: r.summary ? [r.summary] : [] }, heading);
            })
            .join("\n");
          return '<section class="report-group">' + label + entries + "</section>";
        })
        .join("\n");
      return;
    }

    var items;
    if (spec.indexOf("section:") === 0) {
      var skey = spec.slice("section:".length);
      items = reports
        .filter(function (r) { return r.section === skey && !r.hidden; })
        .map(function (r) {
          return {
            url: r.url,
            title: r.title,
            meta: r.sectionMeta || r.meta || [],
            paras: r.detail || (r.summary ? [r.summary] : []),
          };
        });
    } else {
      items = reports
        .filter(function (r) { return r.featured !== false && !r.hidden; })
        .map(function (r) {
          return { url: r.url, title: r.title, meta: r.meta || [], paras: r.summary ? [r.summary] : [] };
        });
    }

    if (!items.length) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = items.map(function (e) { return entryHtml(e, heading); }).join("\n");
  }

  function entryHtml(e, heading) {
    var meta = e.meta.map(escapeHtml).join(' <span class="dot">·</span> ');
    var paras = e.paras.map(function (p) { return "<p>" + escapeHtml(p) + "</p>"; }).join("\n");
    return (
      '<article class="entry">' +
      (meta ? '<p class="meta">' + meta + "</p>" : "") +
      "<" + heading + '><a href="' + escapeHtml(e.url) + '">' + escapeHtml(e.title) + "</a></" + heading + ">" +
      paras +
      "</article>"
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
