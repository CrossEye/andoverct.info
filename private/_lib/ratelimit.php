<?php
/**
 * ratelimit.php — flat-file sliding-window throttle (PHP 7.0 safe).
 *
 * Note on IPs: the nginx edge terminates TLS and (per the spike) does not pass
 * X-Forwarded-For, so the origin usually sees the proxy's address for everyone.
 * Per-IP limiting is therefore a COARSE global backstop; the meaningful control
 * is the per-EMAIL limit. We still honor X-Forwarded-For if it ever appears.
 */

if (!defined('PRIV_CONFIG_LOADED')) { require __DIR__ . '/config.php'; }
require_once __DIR__ . '/store.php';

function priv_client_ip() {
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        $ip = trim($parts[0]);
        if ($ip !== '') { return $ip; }
    }
    return isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '0.0.0.0';
}

// Record an event under $key; return true if still within $max per $window secs.
function priv_rate_ok($key, $max, $window) {
    $file = PRIV_RATE_DIR . '/' . hash('sha256', $key) . '.json';
    $now = time();
    $allowed = true;
    priv_json_update($file, function ($rec) use ($now, $window, $max, &$allowed) {
        if (!is_array($rec)) { $rec = array(); }
        $kept = array();
        foreach ($rec as $t) {
            if (($now - (int) $t) < $window) { $kept[] = (int) $t; }
        }
        if (count($kept) >= $max) { $allowed = false; return $kept; }
        $kept[] = $now;
        return $kept;
    }, array());
    return $allowed;
}
