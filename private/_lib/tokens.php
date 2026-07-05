<?php
/**
 * tokens.php — single-use, expiring magic-link tokens (PHP 7.0 safe).
 *
 * A token is "<id>.<raw>": <id> locates the JSON file, <raw> is the secret.
 * Only sha256(raw . pepper) is stored at rest. Consumption flips used=true
 * under an exclusive lock (single-use even under concurrent clicks), then the
 * file is unlinked. Expired token files are GC'd opportunistically.
 */

if (!defined('PRIV_CONFIG_LOADED')) { require __DIR__ . '/config.php'; }
require_once __DIR__ . '/store.php';
require_once __DIR__ . '/users.php';
require_once __DIR__ . '/ratelimit.php';   // for priv_client_ip()

// Create a token for ($sub,$email); returns the "<id>.<raw>" string to email.
function priv_token_create($sub, $email) {
    $raw = bin2hex(random_bytes(32));   // 256-bit secret
    $id  = bin2hex(random_bytes(8));    // public locator
    $rec = array(
        'sub'   => $sub,
        'email' => priv_norm_email($email),
        'hash'  => hash('sha256', $raw . priv_pepper()),
        'exp'   => time() + PRIV_TOKEN_TTL,
        'used'  => false,
        'ip'    => priv_client_ip(),
    );
    priv_json_write(PRIV_TOKENS_DIR . '/' . $id . '.json', $rec);
    return $id . '.' . $raw;
}

// Verify + consume a token. Returns array('sub'=>..,'email'=>..) or false.
function priv_token_consume($token) {
    if (!is_string($token) || strpos($token, '.') === false) { return false; }
    $bits = explode('.', $token, 2);
    $id = $bits[0];
    $raw = $bits[1];
    if (!preg_match('/^[a-f0-9]{16}$/', $id) || !preg_match('/^[a-f0-9]{64}$/', $raw)) {
        return false;
    }
    $file = PRIV_TOKENS_DIR . '/' . $id . '.json';
    if (!is_file($file)) { return false; }

    $captured = array('ok' => false);
    priv_json_update($file, function ($rec) use ($raw, &$captured) {
        if (!is_array($rec) || !empty($rec['used'])) { return $rec; }
        if (empty($rec['exp']) || time() > (int) $rec['exp']) { return $rec; }
        $calc = hash('sha256', $raw . priv_pepper());
        if (!hash_equals((string) $rec['hash'], $calc)) { return $rec; }
        $captured['ok']    = true;
        $captured['sub']   = $rec['sub'];
        $captured['email'] = $rec['email'];
        $rec['used'] = true;   // flip under the held lock => single use
        return $rec;
    }, array());

    @unlink($file);   // best-effort: a consumed (or failed) token is done
    if ($captured['ok']) {
        return array('sub' => $captured['sub'], 'email' => $captured['email']);
    }
    return false;
}

// Delete expired/used token files. Cheap; called on each verify.
function priv_token_gc() {
    $now = time();
    $files = @glob(PRIV_TOKENS_DIR . '/*.json');
    if (!is_array($files)) { return; }
    foreach ($files as $f) {
        $rec = priv_json_read($f, null);
        if (!is_array($rec) || !empty($rec['used'])
            || empty($rec['exp']) || $now > (int) $rec['exp']) {
            @unlink($f);
        }
    }
}
