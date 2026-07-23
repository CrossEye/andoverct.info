<?php
// Subsection index rendered by _gate.php (priv_serve_content include). The
// session is already authorized for this area; priv_current_is_owner() tells us
// whether the viewer is a site owner, so the promotion controls show only to
// owners while friends on the allowlist see the plain campaign.
$is_owner = function_exists('priv_current_is_owner') && priv_current_is_owner();
?><!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>A Town Asset — private review</title>
<style>
  body{margin:0;background:#f4f6f9;color:#19222e;font-family:system-ui,sans-serif;line-height:1.5}
  .wrap{max-width:720px;margin:0 auto;padding:32px 20px}
  h1{font-size:1.2rem;color:#143862} .private{display:inline-block;background:#8a1f1f;color:#fff;
  font-size:11px;letter-spacing:.08em;text-transform:uppercase;border-radius:4px;padding:2px 8px}
  table{width:100%;border-collapse:collapse;margin:18px 0;font-size:14px}
  td,th{padding:7px 8px;border-bottom:1px solid #e3e8ef;text-align:left}
  td.ok{color:#1f7d49} td.warn{color:#8a1f1f;font-weight:600}
  a{color:#245c95} .big{font-size:15px;margin:8px 0}
</style></head><body><div class="wrap">
<p class="private">Private review</p>
<h1>A Town Asset — 13 pieces</h1>
<p class="big"><a href="./article/">The assembled article</a> · <a href="./console/">FB posting console</a></p>
<table><tr><th>#</th><th>Piece</th><th>Status</th></tr>
<tr><td>1</td><td><a href="pieces/the-money/">The school&#39;s own money</a></td><td class="ok">sourced</td></tr>
<tr><td>2</td><td><a href="pieces/the-line/">The line, drawn and erased</a></td><td class="ok">sourced</td></tr>
<tr><td>3</td><td><a href="pieces/the-senior-center/">The first move onto the grounds</a></td><td class="ok">sourced</td></tr>
<tr><td>4</td><td><a href="pieces/the-parking-lot/">A permit for its own lot, on its own money</a></td><td class="ok">sourced</td></tr>
<tr><td>5</td><td><a href="pieces/the-capital-fund/">The machinery made permanent</a></td><td class="ok">sourced</td></tr>
<tr><td>6</td><td><a href="pieces/the-solar-contract/">The town joins a contract it was not part of</a></td><td class="ok">sourced</td></tr>
<tr><td>7</td><td><a href="pieces/the-bathrooms/">The fair point</a></td><td class="ok">sourced</td></tr>
<tr><td>8</td><td><a href="pieces/every-table/">The seat he did not take, until he did</a></td><td class="ok">sourced</td></tr>
<tr><td>9</td><td><a href="pieces/the-superintendent/">The contract, and the law firm</a></td><td class="ok">sourced</td></tr>
<tr><td>10</td><td><a href="pieces/the-preschool/">A question answered, and asked again</a></td><td class="ok">sourced</td></tr>
<tr><td>11</td><td><a href="pieces/the-mailers/">Paying to defeat the budget he was there to help create</a></td><td class="warn">blocked</td></tr>
<tr><td>12</td><td><a href="pieces/where-is-the-vote/">Where is the vote?</a></td><td class="ok">sourced</td></tr>
<tr><td>13</td><td><a href="pieces/the-pattern/">The pattern</a></td><td class="ok">sourced</td></tr>
</table>
<?php if ($is_owner): ?>
<p>Live promotion happens at <a href="/private/admin/promote">/private/admin/promote</a>.
Each night's post text and card sit in that step's folder and appear on the promote result page.</p>
<?php endif; ?>
</div></body></html>
