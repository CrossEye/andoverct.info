<?php
/**
 * mailer.php — minimal authenticated SMTP sender (PHP 7.0 safe).
 *
 * Speaks just enough SMTP to log in and send one plain-text message:
 * connect, EHLO, optional STARTTLS, AUTH LOGIN, MAIL/RCPT/DATA. Config comes
 * from secrets.php via priv_smtp(). Returns true on a queued (250) message.
 *
 * encryption: 'auto' (STARTTLS if offered) | 'none' | 'starttls' | 'ssl'.
 */

if (!defined('PRIV_CONFIG_LOADED')) { require __DIR__ . '/config.php'; }
require_once __DIR__ . '/auth.php';   // priv_audit()

// Last SMTP failure reason (so the installer can surface it; log has it too).
function priv_smtp_last_error($set = null) {
    static $e = '';
    if ($set !== null) { $e = (string) $set; }
    return $e;
}
function priv_smtp_fail($msg) {
    priv_smtp_last_error($msg);
    priv_audit('smtp-error', $msg);
    return false;
}

// Send the subsection sign-in link. $to must be a validated address.
function priv_send_login_link($to, $meta, $link) {
    $title = isset($meta['title']) ? $meta['title'] : 'a private area';
    $subject = 'Your sign-in link for ' . $title;
    $body =
        "Hello,\r\n\r\n"
      . "Use the link below to sign in to \"" . $title . "\" on andoverct.info:\r\n\r\n"
      . $link . "\r\n\r\n"
      . "This link expires in 15 minutes and can be used once. "
      . "If you didn't request it, you can safely ignore this email.\r\n\r\n"
      . "\xE2\x80\x94 andoverct.info\r\n";
    return priv_smtp_send($to, $subject, $body);
}

// Low-level send. Returns true on success; logs a reason on failure.
function priv_smtp_send($to, $subject, $body, $cfgOverride = null) {
    $cfg = ($cfgOverride !== null) ? $cfgOverride : priv_smtp();
    $host = isset($cfg['host']) ? $cfg['host'] : '';
    $port = isset($cfg['port']) ? (int) $cfg['port'] : 25;
    $enc  = isset($cfg['encryption']) ? $cfg['encryption'] : 'auto';
    $user = isset($cfg['user']) ? $cfg['user'] : '';
    $pass = isset($cfg['pass']) ? $cfg['pass'] : '';
    $from = isset($cfg['from']) ? $cfg['from'] : $user;
    $fromName = isset($cfg['from_name']) ? $cfg['from_name'] : 'andoverct.info';

    // Guard against header injection via the recipient.
    priv_smtp_last_error('');
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)
        || preg_match('/[\r\n]/', $to . $from . $subject)) {
        return priv_smtp_fail('bad recipient/header');
    }
    if ($host === '') { return priv_smtp_fail('no smtp host configured'); }

    $transport = ($enc === 'ssl') ? "ssl://$host:$port" : "tcp://$host:$port";
    $ctx = stream_context_create(array('ssl' => array(
        'verify_peer' => false, 'verify_peer_name' => false,   // local relay, self-signed common
    )));
    $errno = 0; $errstr = '';
    $fp = @stream_socket_client($transport, $errno, $errstr, 20,
        STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) {
        return priv_smtp_fail("connect $transport: [$errno] $errstr");
    }
    stream_set_timeout($fp, 20);

    $fail = null;
    $get = function () use ($fp) {
        $data = '';
        while (($ln = fgets($fp, 515)) !== false) {
            $data .= $ln;
            if (strlen($ln) < 4 || $ln[3] === ' ') { break; }   // last line
        }
        return $data;
    };
    $expect = function ($resp, $codes) use (&$fail) {
        $code = substr(ltrim($resp), 0, 3);
        if (!in_array($code, (array) $codes, true)) {
            $fail = trim($resp);
            return false;
        }
        return true;
    };
    $put = function ($line) use ($fp) { fwrite($fp, $line . "\r\n"); };

    $ehlo = 'EHLO andoverct.info';
    do {
        if (!$expect($get(), array('220'))) { break; }             // greeting
        $put($ehlo);
        $feat = $get();
        if (!$expect($feat, array('250'))) { break; }

        $wantTls = ($enc === 'starttls') || ($enc === 'auto' && stripos($feat, 'STARTTLS') !== false);
        if ($wantTls && $enc !== 'ssl') {
            $put('STARTTLS');
            if (!$expect($get(), array('220'))) { break; }
            $ok = @stream_socket_enable_crypto($fp, true,
                STREAM_CRYPTO_METHOD_TLS_CLIENT);
            if ($ok !== true) { $fail = 'STARTTLS negotiation failed'; break; }
            $put($ehlo);
            if (!$expect($get(), array('250'))) { break; }
        }

        if ($user !== '') {
            $put('AUTH LOGIN');
            if (!$expect($get(), array('334'))) { break; }
            $put(base64_encode($user));
            if (!$expect($get(), array('334'))) { break; }
            $put(base64_encode($pass));
            if (!$expect($get(), array('235'))) { break; }         // auth accepted
        }

        $put('MAIL FROM:<' . $from . '>');
        if (!$expect($get(), array('250'))) { break; }
        $put('RCPT TO:<' . $to . '>');
        if (!$expect($get(), array('250', '251'))) { break; }
        $put('DATA');
        if (!$expect($get(), array('354'))) { break; }

        $atFrom = strrchr($from, '@');
        $domain = ($atFrom !== false) ? substr($atFrom, 1) : 'andoverct.info';
        $msgId = '<' . bin2hex(random_bytes(16)) . '@' . $domain . '>';
        $headers =
            'From: ' . priv_mime_name($fromName) . ' <' . $from . ">\r\n"
          . 'To: <' . $to . ">\r\n"
          . 'Subject: ' . priv_mime_header($subject) . "\r\n"
          . 'Date: ' . gmdate('D, d M Y H:i:s') . " +0000\r\n"
          . 'Message-ID: ' . $msgId . "\r\n"
          . 'MIME-Version: 1.0' . "\r\n"
          . 'Content-Type: text/plain; charset=utf-8' . "\r\n"
          . 'Auto-Submitted: auto-generated' . "\r\n\r\n";
        // dot-stuff the body so a lone "." can't terminate DATA early
        $data = preg_replace('/^\./m', '..', $headers . $body);
        $put($data . "\r\n.");
        if (!$expect($get(), array('250'))) { break; }
        $put('QUIT');
        fclose($fp);
        return true;
    } while (false);

    @fwrite($fp, "QUIT\r\n");
    @fclose($fp);
    return priv_smtp_fail($fail !== null ? $fail : 'unknown SMTP failure');
}

// Encode a header VALUE (e.g. Subject): RFC2047 encoded-word if it has any
// non-ASCII bytes, else as-is.
function priv_mime_header($text) {
    if (preg_match('/[^\x20-\x7E]/', $text)) {
        return '=?UTF-8?B?' . base64_encode($text) . '?=';
    }
    return $text;
}

// Encode a display NAME (the phrase before <addr>). Non-ASCII -> RFC2047
// encoded-word (a valid atom). ASCII with RFC 5322 specials (comma, period,
// etc.) -> quoted-string so a comma can't be read as an address separator.
function priv_mime_name($name) {
    if (preg_match('/[^\x20-\x7E]/', $name)) {
        return '=?UTF-8?B?' . base64_encode($name) . '?=';
    }
    if (preg_match('/[()<>@,;:\\\\".\[\]]/', $name)) {
        return '"' . addcslashes($name, '"\\') . '"';
    }
    return $name;
}
