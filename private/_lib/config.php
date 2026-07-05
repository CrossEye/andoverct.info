<?php
/**
 * config.php — central config + paths + secrets loader for the /private section.
 *
 * Written for PHP 7.0 compatibility (no arrow fns, typed properties, ??=, or
 * array spread), so it runs on whatever 7.x the host lands on.
 *
 * Runtime data lives ABOVE the web root (confirmed writable on the host), so
 * nothing under it is reachable over HTTP and the FTP deploy never touches it.
 */

if (defined('PRIV_CONFIG_LOADED')) { return; }
define('PRIV_CONFIG_LOADED', true);

// --- Paths ------------------------------------------------------------------
// __DIR__ = .../www/private/_lib
define('PRIV_CODE_DIR', dirname(__DIR__));            // .../www/private
define('PRIV_DOC_ROOT', dirname(PRIV_CODE_DIR));      // .../www
define('PRIV_SUBS_DIR', PRIV_CODE_DIR . '/subsections');

// Server-only data dir, a sibling of the web root: .../private-data
define('PRIV_DATA_DIR', dirname(PRIV_DOC_ROOT) . '/private-data');
define('PRIV_ALLOW_DIR', PRIV_DATA_DIR . '/allowlists');
define('PRIV_TOKENS_DIR', PRIV_DATA_DIR . '/tokens');
define('PRIV_SESS_DIR', PRIV_DATA_DIR . '/sessions');
define('PRIV_RATE_DIR', PRIV_DATA_DIR . '/ratelimit');
define('PRIV_LOG_FILE', PRIV_DATA_DIR . '/logs/auth.log');

// --- Public site constants --------------------------------------------------
// The origin can't see the request scheme (TLS terminates at the nginx edge),
// so we never branch on $_SERVER['HTTPS']: hardcode the canonical HTTPS origin
// and always mint https:// links + secure cookies.
define('PRIV_SITE_ORIGIN', 'https://andoverct.info');
define('PRIV_BASE_PATH', '/private');

define('PRIV_TOKEN_TTL', 900);        // magic-link lifetime, seconds (15 min)
define('PRIV_SESSION_TTL', 60 * 60 * 12); // treat sessions older than this as stale

// --- TEMPORARY: dev login (REMOVE IN PHASE 3 once magic links work) ----------
// If set to a non-empty string, a request to /private/<sub>/?dev=<key> logs the
// browser into <sub> without email, for pre-email testing of the gate.
define('PRIV_DEV_KEY', 'dev-9f3a2c7b1e6d4051');

// --- First-run bootstrap of the data dir (idempotent, safe) -----------------
// Creates the data directories and a random token pepper if they don't exist.
// Does NOT create allowlists (those are seeded deliberately — see install.php).
function priv_bootstrap_data() {
    $dirs = array(PRIV_DATA_DIR, PRIV_ALLOW_DIR, PRIV_TOKENS_DIR, PRIV_SESS_DIR,
                  PRIV_RATE_DIR, dirname(PRIV_LOG_FILE));
    foreach ($dirs as $d) {
        if (!is_dir($d)) { @mkdir($d, 0700, true); }
    }
    $pepperFile = PRIV_DATA_DIR . '/pepper';
    if (!is_file($pepperFile)) {
        @file_put_contents($pepperFile, bin2hex(random_bytes(32)), LOCK_EX);
        @chmod($pepperFile, 0600);
    }
}

// Token pepper (server secret mixed into token hashes at rest).
function priv_pepper() {
    static $pepper = null;
    if ($pepper === null) {
        $pepper = @file_get_contents(PRIV_DATA_DIR . '/pepper');
        if ($pepper === false) { $pepper = ''; }
        $pepper = trim($pepper);
    }
    return $pepper;
}

// Secrets (SMTP creds, etc.) from a server-only file above the web root.
// Returns array(); individual getters below default gracefully when absent.
function priv_secrets() {
    static $secrets = null;
    if ($secrets === null) {
        $file = PRIV_DATA_DIR . '/secrets.php';
        $secrets = is_file($file) ? require $file : array();
        if (!is_array($secrets)) { $secrets = array(); }
    }
    return $secrets;
}
