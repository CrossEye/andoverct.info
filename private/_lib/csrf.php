<?php
/**
 * csrf.php — per-session CSRF token (PHP 7.0 safe). Requires an active session.
 */

if (!defined('PRIV_CONFIG_LOADED')) { require __DIR__ . '/config.php'; }

function priv_csrf_token() {
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function priv_csrf_field() {
    $t = htmlspecialchars(priv_csrf_token(), ENT_QUOTES, 'UTF-8');
    return '<input type="hidden" name="csrf" value="' . $t . '">';
}

function priv_csrf_check() {
    $sent = isset($_POST['csrf']) ? (string) $_POST['csrf'] : '';
    return !empty($_SESSION['csrf']) && is_string($sent)
        && hash_equals($_SESSION['csrf'], $sent);
}
