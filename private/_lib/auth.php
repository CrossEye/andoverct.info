<?php
/**
 * auth.php — session bootstrap + login/logout + authorization (PHP 7.0 safe).
 *
 * The host runs PHP as CGI, so .htaccess cannot set php_value/session.* — every
 * cookie/session setting is applied here in code BEFORE session_start().
 * Cookies are forced Secure (the public edge is HTTPS even though the origin
 * can't see it) and HttpOnly; session files live above the web root.
 */

if (!defined('PRIV_CONFIG_LOADED')) { require __DIR__ . '/config.php'; }
require_once __DIR__ . '/users.php';

function priv_session_start() {
    if (session_status() === PHP_SESSION_ACTIVE) { return; }

    if (is_dir(PRIV_SESS_DIR) && is_writable(PRIV_SESS_DIR)) {
        session_save_path(PRIV_SESS_DIR);
    }
    ini_set('session.use_strict_mode', '1');   // reject uninitialized session ids
    ini_set('session.use_only_cookies', '1');
    session_name('privsess');

    $secure = true;      // forced: browser<->edge leg is always HTTPS
    $httponly = true;
    if (PHP_VERSION_ID >= 70300) {
        session_set_cookie_params(array(
            'lifetime' => 0,
            'path'     => '/private/',
            'domain'   => '',
            'secure'   => $secure,
            'httponly' => $httponly,
            'samesite' => 'Lax',   // Lax lets the emailed-link GET carry the cookie
        ));
    } else {
        // PHP < 7.3 has no samesite arg; browser default (Lax) applies, which is
        // exactly what we want for the top-level magic-link navigation.
        session_set_cookie_params(0, '/private/', '', $secure, $httponly);
    }
    session_start();
}

function priv_is_authorized($sub) {
    if (empty($_SESSION['authed'][$sub])) { return false; }
    $ts = (int) $_SESSION['authed'][$sub];
    if (time() - $ts > PRIV_SESSION_TTL) {
        unset($_SESSION['authed'][$sub]);
        return false;
    }
    return true;
}

// Establish an authenticated session for a subsection. Regenerates the session
// id first (fixation defense). Must be called before any output.
function priv_login($sub, $email) {
    session_regenerate_id(true);
    if (!isset($_SESSION['authed']) || !is_array($_SESSION['authed'])) {
        $_SESSION['authed'] = array();
    }
    $_SESSION['authed'][$sub] = time();
    $_SESSION['email'] = priv_norm_email($email);
    $_SESSION['is_owner'] = priv_is_owner($email);
}

function priv_current_email() {
    return isset($_SESSION['email']) ? $_SESSION['email'] : '';
}

function priv_current_is_owner() {
    return !empty($_SESSION['is_owner']);
}

function priv_logout() {
    $_SESSION = array();
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}

// Minimal audit line (never logs raw tokens). Best-effort.
function priv_audit($event, $detail = '') {
    $line = gmdate('Y-m-d\TH:i:s\Z') . "\t" . $event . "\t" . $detail
          . "\t" . (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '-') . "\n";
    @file_put_contents(PRIV_LOG_FILE, $line, FILE_APPEND | LOCK_EX);
}
