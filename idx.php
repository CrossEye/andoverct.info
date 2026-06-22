<?php
/**
 * idx.php — poor-man's directory listing.
 *
 * Invoked from the document-root .htaccess, which routes a request for
 * /<path>/idx to this script with ?dir=<path>/ (trailing slash). A request
 * for /idx lists the document root (dir empty).
 *
 * Lists the folders and files in the target directory. Each folder links to
 * itself and also offers an [idx] link to its own poor-man's listing (handy
 * when the folder has an index.html that would otherwise hide its contents).
 * Dotfiles and this helper are hidden.
 */

$BASE = __DIR__;                                  // idx.php lives at the doc root
$realBase = realpath($BASE);

// ---- resolve & sanitize the requested directory ----
$dir = isset($_GET['dir']) ? (string) $_GET['dir'] : '';
$dir = str_replace('\\', '/', $dir);
$dir = ltrim($dir, '/');
if ($dir !== '' && substr($dir, -1) !== '/') {
    $dir .= '/';
}
if (strpos($dir, '..') !== false || strpos($dir, "\0") !== false) {
    http_response_code(400);
    exit('Bad request.');
}

$target = realpath($realBase . '/' . $dir);
if ($target === false || !is_dir($target) ||
    strpos($target . DIRECTORY_SEPARATOR, $realBase . DIRECTORY_SEPARATOR) !== 0) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Not found.');
}

// ---- gather entries ----
$SKIP = ['.', '..', 'idx.php'];
$dirs = [];
$files = [];
foreach (scandir($target) as $name) {
    if (in_array($name, $SKIP, true)) continue;
    if ($name[0] === '.') continue;               // hide dotfiles (.htaccess, .git, …)
    if (is_dir($target . '/' . $name)) {
        $dirs[] = $name;
    } else {
        $files[] = $name;
    }
}
natcasesort($dirs);
natcasesort($files);

// ---- helpers ----
function h($s) { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
function enc($path) {                              // url-encode each segment, keep slashes
    return implode('/', array_map('rawurlencode', explode('/', $path)));
}
function human_size($bytes) {
    if ($bytes < 1024) return $bytes . ' B';
    $units = ['KB', 'MB', 'GB', 'TB'];
    $i = -1;
    do { $bytes /= 1024; $i++; } while ($bytes >= 1024 && $i < count($units) - 1);
    return number_format($bytes, $bytes >= 10 ? 0 : 1) . ' ' . $units[$i];
}

$webdir = '/' . $dir;                              // e.g. "/reports/aes/"

// ---- breadcrumb: each ancestor links to its own listing ----
$crumbs = ['<a href="/idx">/</a>'];
$accum = '';
if ($dir !== '') {
    foreach (explode('/', rtrim($dir, '/')) as $seg) {
        $accum .= $seg . '/';
        $crumbs[] = '<a href="/' . enc($accum) . 'idx">' . h($seg) . '/</a>';
    }
}
$parent = $dir === '' ? null : '/' . enc(preg_replace('#[^/]+/$#', '', $dir)) . 'idx';
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>Index of <?= h($webdir) ?></title>
<style>
  :root {
    --bg: #f4f6f9; --ink: #19222e; --mute: #5b6775; --rule: #e3e8ef;
    --navy: #143862; --blue: #245c95; --gold: #b07c00;
    --mono: "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--sans); line-height: 1.5; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 28px 20px 60px; }
  .crumbs { font-family: var(--mono); font-size: 13px; color: var(--mute); margin: 0 0 4px; }
  .crumbs a { color: var(--blue); text-decoration: none; }
  .crumbs a:hover { text-decoration: underline; }
  h1 { font-size: 1.05rem; font-weight: 600; color: var(--navy); margin: 0 0 16px; word-break: break-all; }
  table { width: 100%; border-collapse: collapse; font-family: var(--mono); font-size: 13.5px; }
  th { text-align: left; font-family: var(--sans); font-size: 11px; letter-spacing: 0.06em;
       text-transform: uppercase; color: var(--mute); font-weight: 600;
       border-bottom: 2px solid var(--gold); padding: 0 10px 6px; }
  th.r, td.r { text-align: right; white-space: nowrap; }
  td { padding: 5px 10px; border-bottom: 1px solid var(--rule); vertical-align: baseline; }
  tr:hover td { background: #eef4fb; }
  a.entry { color: var(--blue); text-decoration: none; }
  a.entry:hover { text-decoration: underline; }
  a.dir { color: var(--navy); font-weight: 600; }
  a.idxlink { color: var(--gold); text-decoration: none; font-size: 12px; margin-left: 8px; }
  a.idxlink:hover { text-decoration: underline; }
  .empty { color: var(--mute); font-style: italic; }
  footer { margin-top: 22px; color: var(--mute); font-size: 12px; }
</style>
</head>
<body>
  <div class="wrap">
    <p class="crumbs"><?= implode(' ', $crumbs) ?></p>
    <h1>Index of <?= h($webdir) ?></h1>

    <table>
      <thead>
        <tr><th>Name</th><th class="r">Size</th></tr>
      </thead>
      <tbody>
        <?php if ($parent): ?>
        <tr>
          <td><a class="entry dir" href="<?= h($parent) ?>">../</a></td>
          <td class="r"></td>
        </tr>
        <?php endif; ?>

        <?php foreach ($dirs as $name): $href = h($webdir . enc($name)); ?>
        <tr>
          <td>
            <a class="entry dir" href="<?= $href ?>/"><?= h($name) ?>/</a>
            <a class="idxlink" href="<?= $href ?>/idx">[idx]</a>
          </td>
          <td class="r">—</td>
        </tr>
        <?php endforeach; ?>

        <?php foreach ($files as $name):
              $href = h($webdir . enc($name));
              $size = @filesize($target . '/' . $name); ?>
        <tr>
          <td><a class="entry" href="<?= $href ?>"><?= h($name) ?></a></td>
          <td class="r"><?= $size === false ? '' : h(human_size($size)) ?></td>
        </tr>
        <?php endforeach; ?>

        <?php if (!$dirs && !$files): ?>
        <tr><td colspan="2" class="empty">(empty)</td></tr>
        <?php endif; ?>
      </tbody>
    </table>

    <footer>poor-man's directory listing · andoverct.info</footer>
  </div>
</body>
</html>
