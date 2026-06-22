<?php
/**
 * the-facts dispatcher
 *
 * Reads editions.json and serves the requested path from the appropriate
 * edition's directory under editions/<id>/.
 *
 * URL conventions:
 *   GET /the-facts/                          → editions/<current>/index.html
 *   GET /the-facts/foo.css                   → editions/<current>/foo.css
 *   GET /the-facts/<edition-id>/             → editions/<edition-id>/index.html
 *   GET /the-facts/<edition-id>/foo.css      → editions/<edition-id>/foo.css
 *   GET /the-facts/<edition-id>              → 301 redirect to add trailing slash
 *
 * Anything under /the-facts/editions/ is served directly by Apache and never
 * reaches this script (see .htaccess).
 */

$root = __DIR__;

// Load the editions data
$dataPath = $root . '/editions.json';
if (!is_file($dataPath)) {
    http_response_code(500);
    header('Content-Type: text/plain');
    echo "editions.json not found";
    exit;
}

$data = json_decode(file_get_contents($dataPath), true);
if (!$data || empty($data['current']) || empty($data['editions'])) {
    http_response_code(500);
    header('Content-Type: text/plain');
    echo "editions.json is malformed";
    exit;
}

$currentId = $data['current'];
if (!isset($data['editions'][$currentId])) {
    http_response_code(500);
    header('Content-Type: text/plain');
    echo "current edition '$currentId' not found in editions list";
    exit;
}

// Determine the asset path being requested and which edition it's served from.
// If the first segment of the path matches a known edition id, that edition
// is the source; otherwise we serve from the current edition.
$rawPath = isset($_GET['path']) ? $_GET['path'] : '';
$rawPath = ltrim($rawPath, '/');

$editionId = $currentId;
$requested = $rawPath;

$slashPos = strpos($rawPath, '/');
$firstSegment = $slashPos === false ? $rawPath : substr($rawPath, 0, $slashPos);

if ($firstSegment !== '' && isset($data['editions'][$firstSegment])) {
    $editionId = $firstSegment;
    if ($slashPos === false) {
        // /the-facts/<id> with no trailing slash — redirect so relative URLs
        // in the served page resolve against the edition's directory.
        header('Location: /the-facts/' . rawurlencode($firstSegment) . '/', true, 301);
        exit;
    }
    $requested = substr($rawPath, $slashPos + 1);
}

if ($requested === '' || substr($requested, -1) === '/') {
    $requested .= 'index.html';
}

// Reject any path traversal attempts.
if (strpos($requested, '..') !== false) {
    http_response_code(400);
    header('Content-Type: text/plain');
    echo "bad request";
    exit;
}

// Build the actual filesystem path.
$editionDir = $root . '/editions/' . $editionId;
$assetPath = $editionDir . '/' . $requested;

if (!is_file($assetPath)) {
    http_response_code(404);
    header('Content-Type: text/plain');
    echo "not found: " . htmlspecialchars($requested);
    exit;
}

// Serve the file with an appropriate content type.
$ext = strtolower(pathinfo($assetPath, PATHINFO_EXTENSION));
$mimeMap = [
    'html' => 'text/html; charset=utf-8',
    'htm'  => 'text/html; charset=utf-8',
    'css'  => 'text/css; charset=utf-8',
    'js'   => 'application/javascript; charset=utf-8',
    'json' => 'application/json; charset=utf-8',
    'svg'  => 'image/svg+xml',
    'png'  => 'image/png',
    'jpg'  => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'gif'  => 'image/gif',
    'webp' => 'image/webp',
    'pdf'  => 'application/pdf',
    'txt'  => 'text/plain; charset=utf-8',
    'md'   => 'text/markdown; charset=utf-8',
];
$contentType = isset($mimeMap[$ext]) ? $mimeMap[$ext] : 'application/octet-stream';

header('Content-Type: ' . $contentType);
header('Content-Length: ' . filesize($assetPath));
readfile($assetPath);
