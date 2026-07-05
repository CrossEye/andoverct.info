<?php
/**
 * store.php — safe flat-file JSON storage (PHP 7.0 compatible).
 *
 * Reads take a shared lock; writes go through an exclusive lock. Mutations use
 * priv_json_update(), which holds LOCK_EX across read-modify-write so a login
 * writing a token can't corrupt an admin editing an allowlist, and vice-versa.
 */

if (!defined('PRIV_CONFIG_LOADED')) { require __DIR__ . '/config.php'; }

// Read a JSON file into an array (shared lock). Returns $default if missing/bad.
function priv_json_read($file, $default = array()) {
    $fp = @fopen($file, 'r');
    if (!$fp) { return $default; }
    $out = $default;
    if (flock($fp, LOCK_SH)) {
        $raw = stream_get_contents($fp);
        flock($fp, LOCK_UN);
        if ($raw !== false && $raw !== '') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) { $out = $decoded; }
        }
    }
    fclose($fp);
    return $out;
}

// Overwrite a JSON file atomically (tmp file + rename under exclusive lock).
function priv_json_write($file, $data) {
    $dir = dirname($file);
    if (!is_dir($dir)) { @mkdir($dir, 0700, true); }
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === false) { return false; }
    $tmp = $file . '.tmp-' . bin2hex(random_bytes(4));
    $fp = @fopen($tmp, 'w');
    if (!$fp) { return false; }
    $ok = false;
    if (flock($fp, LOCK_EX)) {
        $ok = (fwrite($fp, $json) !== false);
        fflush($fp);
        flock($fp, LOCK_UN);
    }
    fclose($fp);
    if (!$ok) { @unlink($tmp); return false; }
    if (!@rename($tmp, $file)) { @unlink($tmp); return false; }
    @chmod($file, 0600);
    return true;
}

// Read-modify-write under a single held exclusive lock. $mutator receives the
// decoded array (or $default) and returns the new array. Returns the new array,
// or false on failure. Safe against concurrent PHP writers.
function priv_json_update($file, $mutator, $default = array()) {
    $dir = dirname($file);
    if (!is_dir($dir)) { @mkdir($dir, 0700, true); }
    $fp = @fopen($file, 'c+');
    if (!$fp) { return false; }
    if (!flock($fp, LOCK_EX)) { fclose($fp); return false; }
    $raw = stream_get_contents($fp);
    $data = ($raw !== false && $raw !== '') ? json_decode($raw, true) : null;
    if (!is_array($data)) { $data = $default; }
    $new = call_user_func($mutator, $data);
    $json = json_encode($new, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === false) { flock($fp, LOCK_UN); fclose($fp); return false; }
    rewind($fp);
    ftruncate($fp, 0);
    fwrite($fp, $json);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    @chmod($file, 0600);
    return $new;
}
