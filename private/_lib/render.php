<?php
/**
 * render.php — shared HTML shell + login / notice pages (PHP 7.0 safe).
 * Visual style echoes the site's idx.php (navy/gold on a light ground).
 */

if (!defined('PRIV_CONFIG_LOADED')) { require __DIR__ . '/config.php'; }
require_once __DIR__ . '/csrf.php';

function priv_h($s) {
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

// Full-page HTML shell. $bodyHtml is already-escaped markup.
function priv_render_page($title, $bodyHtml, $status = 200) {
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: text/html; charset=utf-8');
        header('Referrer-Policy: no-referrer');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store');
    }
    $t = priv_h($title);
    echo "<!DOCTYPE html>\n<html lang=\"en\"><head>\n"
       . "<meta charset=\"utf-8\">\n"
       . "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
       . "<meta name=\"robots\" content=\"noindex, nofollow\">\n"
       . "<link rel=\"icon\" type=\"image/svg+xml\" href=\"/favicon.svg\">\n"
       . "<title>$t</title>\n<style>\n" . priv_css() . "</style>\n</head>\n<body>\n"
       . "<div class=\"wrap\">\n" . $bodyHtml . "\n</div>\n</body></html>\n";
}

function priv_css() {
    return <<<CSS
  :root{--bg:#f4f6f9;--ink:#19222e;--mute:#5b6775;--rule:#e3e8ef;
    --navy:#143862;--blue:#245c95;--gold:#b07c00;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;}
  .wrap{max-width:460px;margin:0 auto;padding:56px 20px 60px;}
  h1{font-size:1.25rem;color:var(--navy);margin:0 0 6px;}
  p.sub{color:var(--mute);margin:0 0 24px;}
  form{margin:0;}
  label{display:block;font-size:13px;font-weight:600;color:var(--mute);margin:0 0 6px;
    text-transform:uppercase;letter-spacing:.05em;}
  input[type=email]{width:100%;padding:11px 12px;font-size:16px;border:1px solid var(--rule);
    border-radius:8px;background:#fff;color:var(--ink);}
  input[type=email]:focus{outline:2px solid var(--blue);border-color:var(--blue);}
  button{margin-top:14px;width:100%;padding:11px 14px;font-size:15px;font-weight:600;
    color:#fff;background:var(--navy);border:0;border-radius:8px;cursor:pointer;}
  button:hover{background:var(--blue);}
  .note{padding:12px 14px;border-radius:8px;font-size:14px;margin:0 0 20px;}
  .note.ok{background:#eaf5ec;color:#1d5b2c;border:1px solid #bfe0c6;}
  .note.err{background:#fbeaea;color:#8a1f1f;border:1px solid #eec4c4;}
  footer{margin-top:32px;color:var(--mute);font-size:12px;border-top:1px solid var(--rule);padding-top:14px;}
  a{color:var(--blue);}
CSS;
}

// Subsection login page (email entry). $notice = array('type'=>'ok|err','msg'=>...).
function priv_render_login($sub, $meta, $notice = null, $prefill = '') {
    $title = isset($meta['title']) ? $meta['title'] : $sub;
    $action = priv_h(PRIV_BASE_PATH . '/' . $sub . '/request-link');
    $noticeHtml = '';
    if (is_array($notice)) {
        $cls = ($notice['type'] === 'ok') ? 'ok' : 'err';
        $noticeHtml = '<div class="note ' . $cls . '">' . priv_h($notice['msg']) . '</div>';
    }
    $body =
        '<h1>' . priv_h($title) . '</h1>'
      . '<p class="sub">This area is private. Enter your email and we\'ll send you a sign-in link.</p>'
      . $noticeHtml
      . '<form method="post" action="' . $action . '">'
      . priv_csrf_field()
      . '<label for="email">Email address</label>'
      . '<input type="email" id="email" name="email" required autocomplete="email" '
      . 'autofocus value="' . priv_h($prefill) . '">'
      . '<button type="submit">Send me a link</button>'
      . '</form>'
      . '<footer>Andover, CT · andoverct.info</footer>';
    priv_render_page($title . ' — sign in', $body);
}

// Generic single-message page (check-your-email, errors, expired links).
function priv_render_notice($title, $message, $type = 'ok', $status = 200) {
    $cls = ($type === 'ok') ? 'ok' : 'err';
    $body = '<h1>' . priv_h($title) . '</h1>'
          . '<div class="note ' . $cls . '">' . priv_h($message) . '</div>'
          . '<footer>Andover, CT · andoverct.info</footer>';
    priv_render_page($title, $body, $status);
}
