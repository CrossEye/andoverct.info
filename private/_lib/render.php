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
function priv_render_page($title, $bodyHtml, $status = 200, $wrapClass = '') {
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: text/html; charset=utf-8');
        header('Referrer-Policy: no-referrer');
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Cache-Control: no-store');
    }
    $t = priv_h($title);
    $cls = trim('wrap ' . $wrapClass);
    echo "<!DOCTYPE html>\n<html lang=\"en\"><head>\n"
       . "<meta charset=\"utf-8\">\n"
       . "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
       . "<meta name=\"robots\" content=\"noindex, nofollow\">\n"
       . "<link rel=\"icon\" type=\"image/svg+xml\" href=\"/favicon.svg\">\n"
       . "<title>$t</title>\n<style>\n" . priv_css() . "</style>\n</head>\n<body>\n"
       . "<div class=\"$cls\">\n" . $bodyHtml . "\n</div>\n</body></html>\n";
}

function priv_css() {
    return <<<CSS
  :root{--bg:#f4f6f9;--ink:#19222e;--mute:#5b6775;--rule:#e3e8ef;
    --navy:#143862;--blue:#245c95;--gold:#b07c00;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;}
  .wrap{max-width:460px;margin:0 auto;padding:56px 20px 60px;}
  .wrap.wide{max-width:720px;}
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
  .topbar{display:flex;justify-content:space-between;align-items:baseline;}
  .topbar form{margin:0;}
  .topbar button{width:auto;margin:0;padding:6px 12px;font-size:13px;background:none;
    border:1px solid #cdd6e2;color:var(--blue);}
  .topbar button:hover{background:#eef4fb;}
  .card{background:#fff;border:1px solid var(--rule);border-radius:10px;padding:18px 18px 8px;margin:18px 0;}
  .card h2{font-size:1rem;color:var(--navy);margin:0 0 12px;}
  .ulist{list-style:none;margin:0 0 12px;padding:0;}
  .ulist li{display:flex;justify-content:space-between;align-items:center;
    padding:7px 0;border-bottom:1px solid var(--rule);font-size:14px;}
  .ulist li:last-child{border-bottom:0;}
  .ulist .none{color:var(--mute);font-style:italic;}
  .ulist form{margin:0;}
  .ulist .acts{display:flex;gap:6px;}
  .ulist button{width:auto;margin:0;padding:4px 9px;font-size:12px;background:none;
    border:1px solid #eec4c4;color:#8a1f1f;border-radius:6px;}
  .ulist button:hover{background:#fbeaea;}
  .ulist button.getlink{border-color:#bcd0e6;color:var(--blue);}
  .ulist button.getlink:hover{background:#eef4fb;}
  .linkbox{background:#fff7e6;border:1px solid #f0d9a6;border-radius:10px;
    padding:14px 16px;margin:0 0 20px;font-size:14px;color:#5a4a1f;}
  .linkbox input{width:100%;margin-top:9px;font-family:var(--mono,monospace);font-size:12px;
    padding:9px;border:1px solid #e0cf9a;border-radius:6px;background:#fff;color:var(--ink);}
  .addrow{display:flex;gap:8px;align-items:flex-start;margin:0 0 6px;}
  .addrow input{margin:0;} .addrow button{width:auto;margin:0;white-space:nowrap;}
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

// Magic-link confirmation page. Shown on GET /verify WITHOUT consuming the
// token; the token is spent only when the human submits this form (POST). This
// defeats email security scanners (Proofpoint/Safe Links/Mimecast) that pre-
// fetch links via GET and would otherwise burn a single-use token.
function priv_render_confirm($token) {
    $action = priv_h(PRIV_BASE_PATH . '/verify');
    $body = '<h1>Confirm sign-in</h1>'
          . '<p class="sub">Click the button below to finish signing in.</p>'
          . '<form method="post" action="' . $action . '">'
          . '<input type="hidden" name="token" value="' . priv_h($token) . '">'
          . '<button type="submit">Sign in</button>'
          . '</form>'
          . '<footer>Andover, CT · andoverct.info</footer>';
    priv_render_page('Confirm sign-in', $body);
}

// Admin sign-in page (owner-only). Posts to /private/admin/request-link.
function priv_render_admin_login($notice = null, $prefill = '') {
    $action = priv_h(PRIV_BASE_PATH . '/admin/request-link');
    $noticeHtml = '';
    if (is_array($notice)) {
        $cls = ($notice['type'] === 'ok') ? 'ok' : 'err';
        $noticeHtml = '<div class="note ' . $cls . '">' . priv_h($notice['msg']) . '</div>';
    }
    $body =
        '<h1>Admin sign-in</h1>'
      . '<p class="sub">Owner access only. Enter your owner email and we\'ll send a sign-in link.</p>'
      . $noticeHtml
      . '<form method="post" action="' . $action . '">'
      . priv_csrf_field()
      . '<label for="email">Owner email</label>'
      . '<input type="email" id="email" name="email" required autocomplete="email" '
      . 'autofocus value="' . priv_h($prefill) . '">'
      . '<button type="submit">Send me a link</button>'
      . '</form>'
      . '<footer>Andover, CT · andoverct.info</footer>';
    priv_render_page('Admin sign-in', $body);
}

// Admin console: per-subsection allowlist management. $subs is the list from
// priv_list_subsections(); each augmented with a 'users' array.
function priv_render_admin_console($subs, $flash = null, $link = null) {
    $csrf = priv_csrf_field();
    $addBase = priv_h(PRIV_BASE_PATH . '/admin/add');
    $rmBase = priv_h(PRIV_BASE_PATH . '/admin/remove');
    $linkBase = priv_h(PRIV_BASE_PATH . '/admin/mintlink');

    $body = '<div class="topbar"><h1>Admin</h1>'
          . '<form method="post" action="' . priv_h(PRIV_BASE_PATH . '/logout') . '">'
          . $csrf . '<button type="submit">Sign out</button></form></div>'
          . '<p class="sub">Add or remove who can sign in to each private area, '
          . 'or generate a sign-in link to hand someone directly.</p>';

    if (is_array($flash)) {
        $cls = ($flash['type'] === 'ok') ? 'ok' : 'err';
        $body .= '<div class="note ' . $cls . '">' . priv_h($flash['msg']) . '</div>';
    }

    // A freshly generated sign-in link to copy and pass along.
    if (is_array($link)) {
        $body .= '<div class="linkbox"><strong>Sign-in link for '
               . priv_h($link['email']) . '</strong> &middot; ' . priv_h($link['sub'])
               . ' &middot; single use &middot; expires in 15 minutes. '
               . 'Copy it and send it to them (text, chat, etc.):'
               . '<input type="text" readonly onclick="this.select()" value="'
               . priv_h($link['url']) . '"></div>';
    }

    foreach ($subs as $s) {
        $sid = priv_h($s['id']);
        $body .= '<div class="card"><h2>' . priv_h($s['title'])
               . ' <span style="color:#5b6775;font-weight:400">(' . $sid . ')</span></h2>';
        $users = isset($s['users']) ? $s['users'] : array();
        $body .= '<ul class="ulist">';
        if (!$users) {
            $body .= '<li class="none">No users yet.</li>';
        } else {
            foreach ($users as $e) {
                $eh = priv_h($e);
                $hidden = '<input type="hidden" name="sub" value="' . $sid . '">'
                        . '<input type="hidden" name="email" value="' . $eh . '">';
                $body .= '<li><span>' . $eh . '</span><span class="acts">'
                       . '<form method="post" action="' . $linkBase . '">' . $csrf . $hidden
                       . '<button type="submit" class="getlink">Get link</button></form>'
                       . '<form method="post" action="' . $rmBase . '">' . $csrf . $hidden
                       . '<button type="submit">Remove</button></form>'
                       . '</span></li>';
            }
        }
        $body .= '</ul>';
        $body .= '<form class="addrow" method="post" action="' . $addBase . '">' . $csrf
               . '<input type="hidden" name="sub" value="' . $sid . '">'
               . '<input type="email" name="email" placeholder="add email…" required>'
               . '<button type="submit">Add</button></form>';
        $body .= '</div>';
    }
    // Publishing console (neutral label), set off from the allowlist cards.
    $body .= '<div class="card"><h2 style="margin-bottom:12px"><a href="'
           . priv_h(PRIV_BASE_PATH . '/admin/promote')
           . '">Publishing &rsaquo;</a></h2></div>';
    $body .= '<footer>Signed in as ' . priv_h(priv_current_email())
           . ' · andoverct.info</footer>';
    priv_render_page('Admin', $body, 200, 'wide');
}

// Generic single-message page (check-your-email, errors, expired links).
function priv_render_notice($title, $message, $type = 'ok', $status = 200) {
    $cls = ($type === 'ok') ? 'ok' : 'err';
    $body = '<h1>' . priv_h($title) . '</h1>'
          . '<div class="note ' . $cls . '">' . priv_h($message) . '</div>'
          . '<footer>Andover, CT · andoverct.info</footer>';
    priv_render_page($title, $body, $status);
}
