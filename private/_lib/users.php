<?php
/**
 * users.php — per-subsection allowlists + owner list (PHP 7.0 compatible).
 *
 * Allowlists live in PRIV_ALLOW_DIR/<sub>.json as a JSON array of emails.
 * Owners live in PRIV_ALLOW_DIR/_owners.json. All are server-only (above web
 * root) and hand-seeded / admin-edited — never overwritten by a deploy.
 */

if (!defined('PRIV_CONFIG_LOADED')) { require __DIR__ . '/config.php'; }
require_once __DIR__ . '/store.php';

function priv_norm_email($email) {
    return strtolower(trim((string) $email));
}

function priv_valid_email($email) {
    return (bool) filter_var($email, FILTER_VALIDATE_EMAIL);
}

function priv_allowlist_path($sub) {
    return PRIV_ALLOW_DIR . '/' . $sub . '.json';
}

// Case-insensitive membership check within a JSON email-array file.
function priv_email_in_file($file, $email) {
    $email = priv_norm_email($email);
    if ($email === '') { return false; }
    $list = priv_json_read($file, array());
    foreach ($list as $e) {
        if (priv_norm_email($e) === $email) { return true; }
    }
    return false;
}

function priv_is_allowed($sub, $email) {
    return priv_email_in_file(priv_allowlist_path($sub), $email);
}

function priv_is_owner($email) {
    return priv_email_in_file(PRIV_ALLOW_DIR . '/_owners.json', $email);
}

function priv_list_users($sub) {
    return priv_json_read(priv_allowlist_path($sub), array());
}

// Add an email to a subsection allowlist (idempotent, case-insensitive).
function priv_add_user($sub, $email) {
    $email = priv_norm_email($email);
    if (!priv_valid_email($email)) { return false; }
    priv_json_update(priv_allowlist_path($sub), function ($list) use ($email) {
        if (!is_array($list)) { $list = array(); }
        foreach ($list as $e) {
            if (priv_norm_email($e) === $email) { return $list; }
        }
        $list[] = $email;
        sort($list);
        return $list;
    }, array());
    return true;
}

// Remove an email from a subsection allowlist (case-insensitive).
function priv_remove_user($sub, $email) {
    $email = priv_norm_email($email);
    priv_json_update(priv_allowlist_path($sub), function ($list) use ($email) {
        if (!is_array($list)) { return array(); }
        $out = array();
        foreach ($list as $e) {
            if (priv_norm_email($e) !== $email) { $out[] = $e; }
        }
        return $out;
    }, array());
    return true;
}
