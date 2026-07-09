// Shared static-file-serving core, consumed by scripts/serve.mjs (dev/local
// launcher), scripts/serve-exe.cjs (packaged Windows .exe via pkg), and
// desktop/main.cjs (Electron's local server for the built app). CommonJS so
// all three — including the plain-CJS pkg target — can require() it without
// a build step.
//
// Binds/serves are the caller's job; this module only resolves request paths
// safely and answers them. Node builtins ONLY — no npm packages.
'use strict';

const path = require('node:path');
const { existsSync, statSync, createReadStream } = require('node:fs');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', // required for WASM streaming instantiation
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.zip': 'application/zip',
};

/** Content-Type for a request path, keyed off its extension. Unknown -> octet-stream. */
function contentTypeFor(pathname) {
  const ext = path.extname(pathname).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Resolve a request path to an absolute file path INSIDE `root`, or `null` if
 * the request tries to escape it (`..` traversal, an encoded traversal like
 * `..%2f`, an absolute-path injection, or malformed percent-encoding). Fails
 * closed: anything not provably inside `root` after normalization is
 * rejected, and a decode failure is caught rather than left to throw.
 */
function resolveSafe(root, urlPath) {
  const rootAbs = path.resolve(root);

  let decoded;
  try {
    decoded = decodeURIComponent((urlPath || '').split('?')[0].split('#')[0]);
  } catch {
    return null; // malformed percent-encoding
  }

  const rel = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^[/\\]+/, '');
  if (path.isAbsolute(rel)) return null; // e.g. decoded to a drive-absolute path

  const target = path.normalize(path.join(rootAbs, rel));
  const prefix = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  if (target !== rootAbs && !target.startsWith(prefix)) return null;

  return target;
}

function defaultLog() {
  // No-op by default (e.g. a desktop app has no console to log request lines to).
}

/**
 * Build a request handler `(req, res) => void` that serves static files from
 * `root`, safely.
 *
 * Options:
 * - headers: static response headers set on every response (e.g. security headers).
 * - spaFallback: when the resolved path is missing/a directory, serve
 *   `index.html` instead of 404ing (single-page-app rewrite). Off by default.
 * - getResponseHeaders(target, ext): per-response extra headers (e.g. Cache-Control),
 *   computed from the file that actually ends up being served.
 * - log(req, status): called once per handled request.
 */
function createRequestHandler(root, options = {}) {
  const { headers = {}, spaFallback = false, getResponseHeaders, log = defaultLog } = options;
  const rootAbs = path.resolve(root);

  return function handleRequest(req, res) {
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }

    let target = resolveSafe(rootAbs, req.url || '/');
    if (target === null) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      log(req, 403);
      return;
    }

    let stats = null;
    try {
      stats = statSync(target);
    } catch {
      stats = null;
    }

    if ((!stats || stats.isDirectory()) && spaFallback) {
      const fallback = path.join(rootAbs, 'index.html');
      try {
        stats = statSync(fallback);
        target = fallback;
      } catch {
        stats = null;
      }
    }

    if (!stats || stats.isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      log(req, 404);
      return;
    }

    const extraHeaders = getResponseHeaders ? getResponseHeaders(target, path.extname(target).toLowerCase()) : {};

    // The 'error' handler is load-bearing: an unhandled 'error' event on the
    // read stream (file deleted between statSync and here, transient I/O
    // fault) is an uncaught exception that would kill the whole server.
    // writeHead is deferred to 'open' so an open-time failure can still
    // answer 500.
    const stream = createReadStream(target);
    stream.once('open', () => {
      res.writeHead(200, { 'Content-Type': contentTypeFor(target), ...extraHeaders });
      log(req, 200);
    });
    stream.on('error', (err) => {
      console.error(`serve: read error for ${req.url}: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error');
        log(req, 500);
      } else {
        res.destroy(); // mid-stream failure: truncate the response, keep serving
      }
    });
    stream.pipe(res);
  };
}

/** Whether `root/index.html` exists — the standard "is there a build here?" check. */
function hasIndexHtml(root) {
  return existsSync(path.join(root, 'index.html'));
}

module.exports = {
  MIME_TYPES,
  contentTypeFor,
  resolveSafe,
  createRequestHandler,
  hasIndexHtml,
};
