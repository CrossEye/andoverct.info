// Shared interaction script for meeting-transcript pages.
// Each transcript page sets a small inline config before loading this:
//   <script>window.TX = { video: "...", passcode: "...", type: "Zoom"|"YouTube" };</script>
//   <script src="https://andoverct.info/reference/video/assets/transcripts.js"></script>
//
// Behavior: hovering a sentence highlights it and its timestamp; clicking a
// sentence or timestamp opens an action dialog (open the video at that moment,
// copy a link, or bookmark the spot). YouTube links carry a &t=<seconds> seek;
// Zoom recordings can't deep-link, so they copy the passcode and open the page.
(function () {
  var cfg = window.TX || {};
  var VIDEO = cfg.video || "";
  var PASSCODE = cfg.passcode || "";
  var IS_ZOOM = cfg.type === "Zoom";

  var overlay = document.getElementById("overlay");
  var overlayTs = document.getElementById("overlay-ts");
  var hintUrl = document.getElementById("hint-link-url");
  var toast = document.getElementById("toast");
  var pendingT = null;
  var pendingCue = null;
  var toastTimer = null;

  function showToast(msg) {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.add("visible");
    toastTimer = setTimeout(function () { toast.classList.remove("visible"); }, 3000);
  }

  function scrollToHash(hash) {
    if (!hash) return;
    var el = document.getElementById(hash.replace(/^#/, ""));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }

  scrollToHash(location.hash);
  window.addEventListener("hashchange", function () { scrollToHash(location.hash); });

  document.querySelectorAll(".cue").forEach(function (cue) {
    var para = cue.closest(".para");
    var tsEl = para.querySelector(".timestamp");
    cue.addEventListener("mouseenter", function () {
      cue.classList.add("hl");
      tsEl.textContent = cue.dataset.label;
      tsEl.classList.add("hl");
    });
    cue.addEventListener("mouseleave", function () {
      cue.classList.remove("hl");
      tsEl.textContent = tsEl.dataset.defaultLabel;
      tsEl.classList.remove("hl");
    });
  });

  document.querySelectorAll(".timestamp").forEach(function (tsEl) {
    tsEl.addEventListener("click", function () {
      showOverlay(tsEl.dataset.defaultT, tsEl.dataset.defaultLabel, null);
    });
  });
  document.querySelectorAll(".cue").forEach(function (cue) {
    cue.addEventListener("click", function () {
      showOverlay(cue.dataset.t, cue.dataset.label, cue.dataset.cue);
    });
  });

  function showOverlay(t, label, cueId) {
    pendingT = t;
    pendingCue = cueId;
    overlayTs.textContent = label;
    hintUrl.textContent = IS_ZOOM ? VIDEO : VIDEO + "&t=" + t + "s";
    overlay.classList.add("visible");
  }
  function closeOverlay() {
    overlay.classList.remove("visible");
    pendingT = null;
    pendingCue = null;
  }

  var copyLink = document.getElementById("act-copy-link");
  if (copyLink) copyLink.addEventListener("click", function () {
    closeOverlay();
    if (IS_ZOOM) {
      navigator.clipboard.writeText(VIDEO).then(function () { showToast("Recording link copied to clipboard"); });
    } else {
      navigator.clipboard.writeText(VIDEO + "&t=" + pendingT + "s").then(function () { showToast("YouTube link copied to clipboard"); });
    }
  });

  var actYt = document.getElementById("act-yt");
  if (actYt) actYt.addEventListener("click", function () {
    window.open(VIDEO + "&t=" + pendingT + "s", "yt-meeting");
    closeOverlay();
    showToast("Opened on YouTube");
  });

  // Zoom recordings can't deep-link: copy the passcode, toast, then open the
  // recording after a brief pause. Shared by the overlay button and the
  // "Watch on Zoom" link in the page subtitle.
  function watchZoomFlow() {
    navigator.clipboard.writeText(PASSCODE).then(function () {
      showToast("Passcode copied — opening Zoom recording…");
      setTimeout(function () { window.open(VIDEO, "zoom-recording"); }, 3000);
    });
  }

  var watchZoom = document.getElementById("act-watch-zoom");
  if (watchZoom) watchZoom.addEventListener("click", function () {
    closeOverlay();
    watchZoomFlow();
  });

  var topZoom = document.getElementById("top-watch-zoom");
  if (topZoom) topZoom.addEventListener("click", function (e) {
    e.preventDefault();
    watchZoomFlow();
  });

  var bookmark = document.getElementById("act-bookmark");
  if (bookmark) bookmark.addEventListener("click", function () {
    var anchor = pendingCue || ("t" + pendingT);
    var url = location.origin + location.pathname + "#" + anchor;
    closeOverlay();
    navigator.clipboard.writeText(url).then(function () { showToast("Transcript link copied to clipboard"); });
    history.pushState(null, "", "#" + anchor);
    scrollToHash("#" + anchor);
  });

  var cancel = document.getElementById("act-cancel");
  if (cancel) cancel.addEventListener("click", closeOverlay);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeOverlay(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeOverlay(); });
})();
