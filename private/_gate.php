<?php
/**
 * _gate.php — front controller for the /private section (PHP 7.0 safe).
 *
 * The .htaccess routes every non-file URL under /private/ here as
 *   _gate.php?path=<sub-path>
 * and also serves this file as the 403 ErrorDocument for denied raw content
 * hits. Responsibilities: bootstrap session, resolve the subsection, gate on a
 * per-subsection authorization check, and stream protected files via readfile()
 * only after that check passes.
 *
 * Endpoints (Phase 2 has working session + content serving via a TEMP dev login;
 * verify / request-link / admin are stubs filled in by later phases):
 *   /private/<sub>/                 login page  ->  content (once authorized)
 *   /private/<sub>/request-link     [Phase 3] email a magic link
 *   /private/verify?token=...       [Phase 3] consume a magic link
 *   /private/admin                  [Phase 4] owner console
 *   /private/logout                 clear the session
 */

require_once __DIR__ . '/_lib/config.php';
require_once __DIR__ . '/_lib/auth.php';
require_once __DIR__ . '/_lib/users.php';
require_once __DIR__ . '/_lib/render.php';

priv_bootstrap_data();
priv_session_start();

$path = ltrim(priv_route_path(), '/');

// ---- top-level endpoints ---------------------------------------------------
if ($path === 'logout') {
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && priv_csrf_check()) {
        priv_audit('logout', priv_current_email());
        priv_logout();
    }
    priv_redirect(PRIV_BASE_PATH . '/');
}

if ($path === 'verify') {
    // [Phase 3] validate + consume the magic-link token here.
    priv_render_notice('Sign-in', 'Magic-link sign-in is not enabled yet.', 'err', 503);
    exit;
}

if ($path === 'admin' || strpos($path, 'admin/') === 0) {
    // [Phase 4] owner-gated add/remove users.
    if (!priv_current_is_owner()) {
        priv_render_notice('Admin', 'Owner sign-in required.', 'err', 403);
        exit;
    }
    priv_render_notice('Admin', 'The admin console arrives in a later phase.', 'ok');
    exit;
}

// ---- subsection routing ----------------------------------------------------
$segs = ($path === '') ? array() : explode('/', $path);
$sub  = count($segs) ? $segs[0] : '';

if ($sub === '') {
    priv_render_notice('Private area',
        'This section is private. Please use the specific area link you were given.', 'ok');
    exit;
}

if (!preg_match('/^[a-z0-9-]+$/', $sub)
    || !is_file(PRIV_SUBS_DIR . '/' . $sub . '/_meta.json')) {
    // Reached as the 403 ErrorDocument (a denied raw content hit)? The host's
    // error subrequest doesn't expose the original path, so we can't pinpoint
    // the subsection — show a generic "this is private" message, not "not found".
    if (isset($_SERVER['REDIRECT_STATUS'])) {
        priv_render_notice('Private',
            'This content is private. Open the area from the link you were given and sign in.',
            'err', 403);
    } else {
        priv_render_notice('Not found', 'There is no such private area.', 'err', 404);
    }
    exit;
}
$meta = priv_json_read(PRIV_SUBS_DIR . '/' . $sub . '/_meta.json', array());
$rest = implode('/', array_slice($segs, 1));

// subsection endpoint: request a magic link
if ($rest === 'request-link') {
    // [Phase 3] csrf + rate-limit + allowlist + send. Stubbed to a generic page.
    priv_render_notice('Check your email',
        'If email sign-in were enabled, a sign-in link would be on its way.', 'ok');
    exit;
}

// TEMPORARY dev login (REMOVE IN PHASE 3): /private/<sub>/?dev=<PRIV_DEV_KEY>
if (PRIV_DEV_KEY !== '' && isset($_GET['dev'])
    && hash_equals(PRIV_DEV_KEY, (string) $_GET['dev'])) {
    priv_login($sub, 'dev@localhost');
    priv_audit('dev-login', $sub);
    priv_redirect(PRIV_BASE_PATH . '/' . $sub . '/');
}

// ---- the gate --------------------------------------------------------------
if (!priv_is_authorized($sub)) {
    priv_render_login($sub, $meta);
    exit;
}

priv_serve_content($sub, $rest);


// ===========================================================================
// helpers
// ===========================================================================

// Resolve the request path under /private/, whether routed via ?path= (normal)
// or reached as the 403 ErrorDocument (derive from the original URL).
function priv_route_path() {
    if (isset($_GET['path'])) { return (string) $_GET['path']; }
    $u = isset($_SERVER['REDIRECT_URL']) ? $_SERVER['REDIRECT_URL']
       : (isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '');
    $u = explode('?', $u, 2);
    $u = $u[0];
    $base = PRIV_BASE_PATH . '/';
    $pos = strpos($u, $base);
    if ($pos !== false) { $u = substr($u, $pos + strlen($base)); }
    // A denied raw hit is /private/subsections/<sub>/...; hide the physical dir
    // so it maps to the same <sub>/... the gate understands.
    $u = preg_replace('#^subsections/#', '', $u);
    return $u;
}

function priv_redirect($to) {
    if (!headers_sent()) { header('Location: ' . $to, true, 302); }
    exit;
}

// Stream a protected file after the auth check, with path-traversal containment
// modeled on idx.php. $rest is the path within the subsection ('' => index.html).
function priv_serve_content($sub, $rest) {
    $base = realpath(PRIV_SUBS_DIR . '/' . $sub);
    if ($base === false) {
        priv_render_notice('Not found', 'Missing content.', 'err', 404);
        exit;
    }
    if ($rest === '' || substr($rest, -1) === '/') { $rest .= 'index.html'; }
    if (strpos($rest, "\0") !== false || strpos($rest, '..') !== false) {
        priv_render_notice('Bad request', 'Invalid path.', 'err', 400);
        exit;
    }

    $target = realpath($base . '/' . $rest);
    if ($target !== false && is_dir($target)) {
        $target = realpath($target . '/index.html');
    }
    // must exist, be a regular file, and stay inside the subsection dir
    if ($target === false || !is_file($target)
        || strpos($target . DIRECTORY_SEPARATOR, $base . DIRECTORY_SEPARATOR) !== 0) {
        priv_render_notice('Not found', 'That page was not found in this area.', 'err', 404);
        exit;
    }
    $bn = basename($target);
    if ($bn === '_meta.json' || $bn[0] === '.') {
        priv_render_notice('Not found', 'That page was not found in this area.', 'err', 404);
        exit;
    }

    $ext = strtolower(pathinfo($target, PATHINFO_EXTENSION));
    $mimes = array(
        'html' => 'text/html; charset=utf-8', 'htm' => 'text/html; charset=utf-8',
        'css'  => 'text/css; charset=utf-8',  'js'  => 'application/javascript; charset=utf-8',
        'json' => 'application/json; charset=utf-8', 'txt' => 'text/plain; charset=utf-8',
        'svg'  => 'image/svg+xml', 'png' => 'image/png', 'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg', 'gif' => 'image/gif', 'webp' => 'image/webp',
        'pdf'  => 'application/pdf', 'ico' => 'image/x-icon',
        'woff' => 'font/woff', 'woff2' => 'font/woff2',
    );
    $type = isset($mimes[$ext]) ? $mimes[$ext] : 'application/octet-stream';

    if (!headers_sent()) {
        header('Content-Type: ' . $type);
        header('Content-Length: ' . filesize($target));
        header('Cache-Control: private, no-store');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'HEAD') {
        readfile($target);
    }
    exit;
}
