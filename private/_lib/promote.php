<?php
/**
 * promote.php — "A Town Asset" promotion console (PHP 7.0 safe).
 *
 * Owner-gated (routed from _gate.php's admin branch at /private/admin/promote).
 * Promotes exactly one staged step per POST: copies steps/<N>/www/** into the
 * web root, add-and-overwrite only. This file contains no delete call of any
 * kind — that is a design invariant, not an accident (a failed rename may
 * strand a .tmp-* file next to its destination; promotion reports the failure
 * and the stray is harmless and overwritten on re-run).
 *
 * PROMOTE ONE STEP AND STOP. No catching up. No scheduling. No autopilot.
 */

if (!defined('PRIV_CONFIG_LOADED')) { require __DIR__ . '/config.php'; }
require_once __DIR__ . '/store.php';
require_once __DIR__ . '/csrf.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/render.php';

define('TA_DIR', PRIV_DATA_DIR . '/town-asset');
define('TA_STEPS', TA_DIR . '/steps');
define('TA_STATE', TA_DIR . '/state.json');
define('TA_LOCK', TA_DIR . '/state.lock');
define('TA_UNCLEARED', '!! THIS PIECE IS NOT CLEARED');

// The only destinations a step may write. Anything else in a step tree is a
// hard refusal: nothing at all is copied. The whole /series/ section belongs
// to this pipeline (plan 004 — the renderer also emits the /series/ landing
// page), so the prefix is series/, not series/town-asset/.
function ta_allowed_prefixes() {
    return array('series/', 'links/', 'private/subsections/town-asset/');
}

// Idempotent, like priv_bootstrap_data(): first visit creates the data dirs.
function ta_bootstrap() {
    foreach (array(TA_DIR, TA_STEPS) as $d) {
        if (!is_dir($d)) { @mkdir($d, 0700, true); }
    }
}

function ta_state() {
    return priv_json_read(TA_STATE, array('live' => 0, 'history' => array()));
}

// Total staged steps = count of numeric dirs under steps/.
function ta_step_count() {
    $n = 0;
    $entries = @scandir(TA_STEPS);
    if (is_array($entries)) {
        foreach ($entries as $e) {
            if (preg_match('/^\d+$/', $e) && is_dir(TA_STEPS . '/' . $e)) { $n++; }
        }
    }
    return $n;
}

// Entry point from the gate's admin branch (auth already established there).
function ta_handle() {
    ta_bootstrap();
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        ta_promote_post();
        return;
    }
    ta_render_console();
}

// ---------------------------------------------------------------------------
// POST: promote exactly one step. All work happens under the flock; there is
// a single unlock+render exit at the bottom (PHP 7.0 discipline).
// ---------------------------------------------------------------------------
function ta_promote_post() {
    $notice = null;
    $result = null;

    if (!priv_csrf_check()) {
        ta_render_console(array('type' => 'err', 'msg' => 'Your session expired — please try again.'));
        return;
    }

    $fp = @fopen(TA_LOCK, 'c');
    if (!$fp) {
        ta_render_console(array('type' => 'err', 'msg' => 'Cannot open the promotion lock file.'));
        return;
    }
    if (!flock($fp, LOCK_EX | LOCK_NB)) {
        fclose($fp);
        ta_render_console(array('type' => 'err', 'msg' => 'A promotion is already running. Wait for it to finish, then reload.'));
        return;
    }

    // ---- everything below runs under the lock; set $notice/$result, fall through
    $state = ta_state();                       // re-read UNDER the lock
    $live  = isset($state['live']) ? (int) $state['live'] : 0;
    $next  = $live + 1;

    $step    = isset($_POST['step']) ? trim((string) $_POST['step']) : '';
    $confirm = isset($_POST['confirm']) ? trim((string) $_POST['confirm']) : '';

    if (!ctype_digit($step) || !ctype_digit($confirm)
        || (int) $step !== $next || (int) $confirm !== $next) {
        $notice = array('type' => 'err', 'msg' =>
            'Step mismatch: the next step is ' . $next . '. Type its number exactly to confirm.');
    } elseif (!is_dir(TA_STEPS . '/' . $next)) {
        $notice = array('type' => 'err', 'msg' => 'Nothing is staged for step ' . $next . '.');
    } else {
        $manifest = @file_get_contents(TA_STEPS . '/' . $next . '/MANIFEST.txt');
        if ($manifest === false) { $manifest = ''; }

        if ($manifest !== '' && strpos($manifest, TA_UNCLEARED) !== false) {
            $notice = array('type' => 'err', 'msg' =>
                'Step ' . $next . ' contains an uncleared piece (see its MANIFEST). '
                . 'Fix it upstream and re-stage; there is no override here.');
        } else {
            $src = TA_STEPS . '/' . $next . '/www';
            $files = array();
            $offenders = array();
            ta_collect_files($src, '', $files, $offenders);

            if ($offenders) {
                $notice = array('type' => 'err', 'msg' =>
                    'Refused — step ' . $next . ' contains paths outside the allowed areas '
                    . '(nothing was copied): ' . implode(', ', $offenders));
            } elseif (!$files) {
                $notice = array('type' => 'err', 'msg' =>
                    'Refused — step ' . $next . ' has no files under www/.');
            } else {
                $copied = 0;
                $failures = array();
                foreach ($files as $rel) {
                    if (ta_copy_one($src . '/' . $rel, $rel)) { $copied++; }
                    else { $failures[] = $rel; }
                }

                if ($failures) {
                    $notice = array('type' => 'err', 'msg' =>
                        'Promotion of step ' . $next . ' FAILED after copying ' . $copied . ' of '
                        . count($files) . ' files. State unchanged. Re-run this same step — '
                        . 'it is safe (cumulative + overwrite). Failed: ' . implode(', ', $failures));
                    priv_audit('ta-promote-failed', 'step ' . $next . ' failed=' . count($failures));
                } else {
                    $hist = isset($state['history']) && is_array($state['history'])
                          ? $state['history'] : array();
                    $hist[] = array(
                        'step'  => $next,
                        'utc'   => gmdate('Y-m-d\TH:i:s\Z'),
                        'files' => $copied,
                    );
                    priv_json_write(TA_STATE, array('live' => $next, 'history' => $hist));
                    priv_audit('ta-promote', 'step ' . $next . ' files=' . $copied);
                    $result = array(
                        'step'     => $next,
                        'files'    => $copied,
                        'manifest' => $manifest,
                        'fb'       => ta_read_fb($next),
                        'cards'    => ta_read_cards($next),
                    );
                }
            }
        }
    }

    flock($fp, LOCK_UN);                       // single unlock point
    fclose($fp);
    ta_render_console($notice, $result);
}

// Recursive walk of a step's www/ tree. Dotfiles are skipped; every file path
// is validated against the allowed prefixes BEFORE anything is copied (the
// caller refuses outright if $offenders is non-empty).
function ta_collect_files($dir, $rel, &$files, &$offenders) {
    $entries = @scandir($dir);
    if (!is_array($entries)) { return; }
    foreach ($entries as $e) {
        if ($e === '.' || $e === '..' || $e[0] === '.') { continue; }
        $abs = $dir . '/' . $e;
        $r = ($rel === '') ? $e : $rel . '/' . $e;
        if (is_dir($abs)) {
            ta_collect_files($abs, $r, $files, $offenders);
        } elseif (ta_path_ok($r)) {
            $files[] = $r;
        } else {
            $offenders[] = $r;
        }
    }
}

function ta_path_ok($rel) {
    if (strpos($rel, "\0") !== false || strpos($rel, '..') !== false) { return false; }
    foreach (ta_allowed_prefixes() as $p) {
        if (strpos($rel, $p) === 0) { return true; }
    }
    return false;
}

// Copy one file into the web root: tmp sibling + rename, atomic per file, so a
// concurrent reader never sees a torn page.
function ta_copy_one($srcAbs, $rel) {
    $dest = PRIV_DOC_ROOT . '/' . $rel;
    $dir = dirname($dest);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true)) { return false; }
    $tmp = $dest . '.tmp-' . bin2hex(random_bytes(4));
    if (!@copy($srcAbs, $tmp)) { return false; }
    if (!@rename($tmp, $dest)) { return false; }
    @chmod($dest, 0644);
    return true;
}

// The night's FB post text (optional; shown on the result page, never copied).
function ta_read_fb($n) {
    $txt = @file_get_contents(TA_STEPS . '/' . $n . '/FB.txt');
    return ($txt === false || $txt === '') ? null : $txt;
}

// The night's FB card image(s): FB-card.png, then FB-card-2.png, … in post
// order. Returned as data URIs — the step dirs live above the web root, so
// there is no URL an <img> could point at. Shown, never copied.
function ta_read_cards($n) {
    $cards = array();
    $found = glob(TA_STEPS . '/' . $n . '/FB-card*.png');
    if (is_array($found)) {
        natsort($found);
        foreach ($found as $f) {
            $raw = @file_get_contents($f);
            if ($raw !== false && $raw !== '') {
                $cards[] = 'data:image/png;base64,' . base64_encode($raw);
            }
        }
    }
    return $cards;
}

// ---------------------------------------------------------------------------
// The console view. $notice = array('type'=>'ok|err','msg'=>...) or null;
// $result = successful-promotion payload or null.
// ---------------------------------------------------------------------------
function ta_render_console($notice = null, $result = null) {
    $state = ta_state();
    $live  = isset($state['live']) ? (int) $state['live'] : 0;
    $hist  = isset($state['history']) && is_array($state['history']) ? $state['history'] : array();
    $total = ta_step_count();
    $next  = $live + 1;
    $pre = 'white-space:pre-wrap;overflow-x:auto;background:#f8f9fb;border:1px solid var(--rule);'
         . 'border-radius:8px;padding:12px;font-size:13px;margin:0 0 12px;';

    $body = '<div class="topbar"><h1>Publishing</h1>'
          . '<p style="margin:0"><a href="' . priv_h(PRIV_BASE_PATH . '/admin') . '">&lsaquo; Admin</a></p></div>'
          . '<p class="sub">A Town Asset &middot; one step per night &middot; no catching up.</p>';

    if (is_array($notice)) {
        $cls = ($notice['type'] === 'ok') ? 'ok' : 'err';
        $body .= '<div class="note ' . $cls . '">' . priv_h($notice['msg']) . '</div>';
    }

    if (is_array($result)) {
        $body .= '<div class="card"><h2>Step ' . (int) $result['step'] . ' promoted &middot; '
               . (int) $result['files'] . ' files</h2>';
        if ($result['manifest'] !== '') {
            $body .= '<pre style="' . $pre . '">' . priv_h($result['manifest']) . '</pre>';
        }
        if ($result['fb'] !== null) {
            $body .= '<h2>Tonight&rsquo;s post</h2>'
                   . '<pre style="' . $pre . '">' . priv_h($result['fb']) . '</pre>';
        }
        foreach ($result['cards'] as $i => $uri) {
            $body .= '<p style="margin:0 0 12px"><img alt="FB card ' . ($i + 1) . '" '
                   . 'style="max-width:100%;border:1px solid var(--rule);border-radius:8px" '
                   . 'src="' . $uri . '"></p>';
        }
        $body .= '</div>';
    }

    // Status + history.
    $body .= '<div class="card"><h2>Live: step ' . $live . ' of ' . $total . '</h2><ul class="ulist">';
    if (!$hist) {
        $body .= '<li class="none">No promotions yet.</li>';
    } else {
        foreach (array_reverse($hist) as $h) {
            $body .= '<li><span>step ' . (int) (isset($h['step']) ? $h['step'] : 0) . '</span>'
                   . '<span>' . priv_h(isset($h['utc']) ? $h['utc'] : '')
                   . ' &middot; ' . (int) (isset($h['files']) ? $h['files'] : 0) . ' files</span></li>';
        }
    }
    $body .= '</ul></div>';

    // The next step (or the reason there isn't one).
    if ($total > 0 && $live >= $total) {
        $body .= '<div class="card"><h2>Series complete</h2>'
               . '<ul class="ulist"><li class="none">All ' . $total . ' steps are live.</li></ul></div>';
    } elseif (!is_dir(TA_STEPS . '/' . $next)) {
        $body .= '<div class="card"><h2>Next: step ' . $next . '</h2>'
               . '<ul class="ulist"><li class="none">Nothing staged.</li></ul></div>';
    } else {
        $manifest = @file_get_contents(TA_STEPS . '/' . $next . '/MANIFEST.txt');
        $body .= '<div class="card"><h2>Next: step ' . $next . '</h2>';
        if ($manifest !== false && $manifest !== '') {
            if (strpos($manifest, TA_UNCLEARED) !== false) {
                $body .= '<div class="note err">This step contains an uncleared piece. '
                       . 'Promotion will refuse it; fix it upstream and re-stage.</div>';
            }
            $body .= '<pre style="' . $pre . '">' . priv_h($manifest) . '</pre>';
        } else {
            $body .= '<div class="note err">No MANIFEST.txt in this step.</div>';
        }
        $body .= '<form method="post" action="' . priv_h(PRIV_BASE_PATH . '/admin/promote') . '">'
               . priv_csrf_field()
               . '<input type="hidden" name="step" value="' . $next . '">'
               . '<label for="confirm">Type ' . $next . ' to confirm</label>'
               . '<input type="text" id="confirm" name="confirm" inputmode="numeric" '
               . 'autocomplete="off" style="width:100%;padding:11px 12px;font-size:16px;'
               . 'border:1px solid var(--rule);border-radius:8px;background:#fff;color:var(--ink)">'
               . '<button type="submit">Promote step ' . $next . '</button>'
               . '</form><div style="height:10px"></div></div>';
    }

    $body .= '<footer>Signed in as ' . priv_h(priv_current_email()) . ' · andoverct.info</footer>';
    priv_render_page('Publishing', $body, 200, 'wide');
}
