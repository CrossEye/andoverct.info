# Production server environment (origin behind andoverct.info)

Captured 2026-07-13 via a throwaway key-gated probe (`envprobe-*.php`, since
deleted from the server — same pattern as `spike.php`: upload over FTP, hit
once, delete). Re-run the probe if the host upgrades anything.

## Topology

```
browser ──HTTPS──▶ nginx 1.16.1 (SSL front-end, "web-only" box)
                      │  proxies as plain HTTP/1.0, port 80
                      ▼
                   Apache 2.2 + PHP 7.0.32 (cgi-fcgi) on pup.phpwebhosting.com
                   docroot /home/crosseye/www
```

- The nginx front-end passes **no `X-Forwarded-Proto`/`X-Forwarded-SSL`**;
  the origin sees `SERVER_PORT=80`, `HTTPS` unset, `HTTP/1.0`. PHP cannot
  detect HTTPS. It does pass `X-Forwarded-For` (real client IP);
  `REMOTE_ADDR` is the proxy (69.175.114.136).
- A plain-HTTP local preview therefore matches what production PHP actually
  sees — closer than a local HTTPS setup would be.

## Origin server facts

| Item | Value |
|---|---|
| Apache | **2.2** (confirmed behaviorally: `Require all denied` → 500, `Order/Deny` → 403; `ServerTokens Prod` hides the version string) |
| PHP | **7.0.32**, SAPI `cgi-fcgi` (`apache_get_modules()` unavailable) |
| OS | Linux 2.6.32 (OpenVZ), **i686 — 32-bit**, so PHP ints are likely 32-bit (2038/`>2GB` caveats) |
| php.ini | `/home/crosseye/etc/php.ini` (user-editable!) |
| mod_rewrite | working (`/idx` rewrite proves it), `.htaccess` honored, `Options`/`ErrorDocument`/`AddType`/`DirectoryIndex`/`RedirectMatch` all in use and working |

## Consequences for .htaccess authoring

- Apache 2.2 means **2.4-only syntax (`Require all denied`) causes a 500** on
  the live server unless wrapped in `<IfModule mod_authz_core.c>`. The
  dual-syntax block in `private/.htaccess` is required — keep it. On a local
  Apache 2.4 the `mod_authz_core` branch runs; on the server the
  `Order/Deny` branch runs.
- No `FallbackResource` (2.2 lacks it) — stick with the
  `RewriteCond !-f/!-d` pattern already in use.

## Consequences for a local preview (andoverct.local)

- Apache 2.4 + PHP 7.0 x86 (32-bit) would be the closest match; PHP 7.0 is
  EOL, so if using a newer PHP locally remember the server rejects anything
  newer than PHP 7.0 syntax (no nullable types `?int`, no `object` typehint,
  no arrow `fn`, no `??=`, no `str_contains`, no `session.cookie_samesite`).
- `AllowOverride All` on the vhost, `mod_rewrite` enabled.
- Serve over plain HTTP on port 80 — mirrors what the origin sees.

## Key php.ini values on the server

```
memory_limit          128M          post_max_size        8M
max_execution_time    30            upload_max_filesize  2M
error_reporting       '' (0!)       display_errors       1
log_errors            0             date.timezone        '' (unset)
short_open_tag        1             allow_url_fopen      1
disable_functions     (none)        open_basedir         (none)
sendmail_path         /usr/sbin/sendmail -t -i
session.save_handler  files         session.save_path    '' (default)
opcache               not loaded    expose_php           1
```

Note `error_reporting` is effectively 0 with `display_errors=1` and
`log_errors=0`: **the server silently swallows PHP notices/warnings and logs
nothing** — a local preview with `error_reporting=E_ALL` will catch problems
production hides.

## Loaded PHP extensions (server)

bcmath calendar ctype curl dba dom exif fileinfo filter ftp gd gettext hash
iconv imap json libxml mbstring mcrypt mysqli mysqlnd openssl pcre PDO
pdo_mysql pdo_sqlite Phar posix Reflection session SimpleXML soap sockets
SPL sqlite3 standard tokenizer xml xmlreader xmlrpc xmlwriter xsl zip zlib

(Notables: OpenSSL 1.0.2a; mcrypt present (removed in PHP 7.2 — don't rely
on it); no intl, no opcache.)
