<?php
// ---------------------------------------------------------------------------
// TEMPORARY diagnostic for phpwebhosting support (created 2026-08-26).
//
// Shows what the SSL front end passes through to Apache. Only ever reflects
// the requester's OWN request back to them; Cookie and Authorization are
// dropped so nothing sensitive is echoed even by accident. Delete this file
// once the support ticket is closed.
// ---------------------------------------------------------------------------

header("X-Robots-Tag: noindex, nofollow");
header("Content-Type: text/html; charset=utf-8");

$hidden = ["HTTP_COOKIE", "HTTP_AUTHORIZATION", "HTTP_PROXY_AUTHORIZATION"];

// The keys Apache uses to decide whether it is serving over TLS.
$protocolKeys = [
    "HTTPS",
    "SERVER_PORT",
    "REQUEST_SCHEME",
    "HTTP_X_FORWARDED_PROTO",
    "HTTP_X_FORWARDED_SSL",
    "HTTP_FRONT_END_HTTPS",
    "HTTP_X_URL_SCHEME",
];

function show($v) {
    if ($v === null) return '<span style="color:#b00">(not set)</span>';
    return '<code>' . htmlspecialchars($v, ENT_QUOTES, "UTF-8") . '</code>';
}
?>
<!doctype html>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>Request environment as Apache sees it</title>
<body style="font:16px/1.6 system-ui,sans-serif;max-width:52em;margin:3em auto;padding:0 1em;color:#222">

<h1>Request environment as Apache sees it</h1>

<p>If you reached this page at <code>https://andoverct.info/temp/env.php</code>,
the client side of this request was TLS. Below is what actually reached Apache
after the SSL front end terminated that TLS and proxied the request onward.</p>

<h2>Protocol signals</h2>
<table cellpadding="6" style="border-collapse:collapse;width:100%">
<?php foreach ($protocolKeys as $k): ?>
  <tr style="border-bottom:1px solid #ddd">
    <th align="left" style="width:20em"><code><?= htmlspecialchars($k) ?></code></th>
    <td><?= show($_SERVER[$k] ?? null) ?></td>
  </tr>
<?php endforeach; ?>
</table>

<p style="background:#fff4f4;border-left:4px solid #b00;padding:0.8em 1em;margin-top:1.5em">
<strong>The problem:</strong> every one of those is either absent or says
<code>off</code>/<code>80</code>. Apache therefore believes it is serving plain
HTTP, and builds every redirect it generates with an <code>http://</code>
scheme — even though the client asked for <code>https://</code>.
</p>

<h2>All request headers received</h2>
<p style="color:#555;font-size:0.9em">Reflected from your own request.
<code>Cookie</code> and <code>Authorization</code> are omitted.</p>
<table cellpadding="6" style="border-collapse:collapse;width:100%">
<?php
$headers = [];
foreach ($_SERVER as $k => $v) {
    if (strpos($k, "HTTP_") !== 0 || in_array($k, $hidden, true)) continue;
    $name = str_replace(" ", "-", ucwords(strtolower(str_replace("_", " ", substr($k, 5)))));
    $headers[$name] = $v;
}
ksort($headers);
foreach ($headers as $name => $v): ?>
  <tr style="border-bottom:1px solid #eee">
    <th align="left" style="width:20em"><code><?= htmlspecialchars($name) ?></code></th>
    <td><code><?= htmlspecialchars($v, ENT_QUOTES, "UTF-8") ?></code></td>
  </tr>
<?php endforeach; ?>
</table>

<p style="margin-top:2em"><a href="./">Back to the explanation</a></p>
</body>
