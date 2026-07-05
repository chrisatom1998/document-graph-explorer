// Dependency-free static server for the sealed `dist-airgap/` build. Node
// builtins ONLY — no npm packages — so double-clicking a launcher (run.cmd /
// run.command / run.sh) works with nothing installed beyond Node itself.
//
// Binds 127.0.0.1 ONLY. This is a local convenience server for opening the
// air-gapped build in a browser tab; it is never meant to be reachable from a
// LAN, so it does not offer a way to bind 0.0.0.0.
import { createServer } from 'node:http';
import { existsSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../dist-airgap/', import.meta.url));
const INDEX_HTML = path.join(ROOT, 'index.html');
const DEFAULT_PORT = 8317;
const MAX_PORT_ATTEMPTS = 10; // try basePort .. basePort + 10 before giving up

// Mirrors SECURITY_HEADERS in vite.config.ts (anti-clickjacking + misc
// hardening) so the same protections apply whether the app is served by Vite
// or by this script. The CSP itself already ships as a <meta> tag in the
// built index.html (see injectCsp() in vite.config.ts) — not duplicated here
// as a header, to keep this script's scope minimal.
const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', // required for WASM streaming instantiation
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/** Content-Type for a request path, keyed off its extension. Unknown -> octet-stream. */
export function contentTypeFor(pathname) {
  const ext = path.extname(pathname).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Resolve a request path to an absolute file path INSIDE `root`, or `null` if
 * the request tries to escape it (`..` traversal, an encoded traversal like
 * `..%2f`, or an absolute-path injection). Fails closed: anything not
 * provably inside `root` after normalization is rejected.
 */
export function resolveSafe(root, urlPath) {
  const rootAbs = path.resolve(root);

  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
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

function logLine(req, status) {
  console.log(`${status} ${req.method} ${req.url}`);
}

function handleRequest(req, res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }

  const target = resolveSafe(ROOT, req.url ?? '/');
  if (target === null) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    logLine(req, 403);
    return;
  }

  let stats;
  try {
    stats = statSync(target);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    logLine(req, 404);
    return;
  }

  // No directory listing and no SPA rewrite — `/` already mapped to
  // index.html in resolveSafe(); any other directory path is a plain 404.
  if (stats.isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    logLine(req, 404);
    return;
  }

  // The 'error' handler is load-bearing: an unhandled 'error' event on the
  // read stream (file deleted between statSync and here, transient I/O
  // fault) is an uncaught exception that would kill the whole server.
  // writeHead is deferred to 'open' so an open-time failure can still
  // answer 500; the security headers set above ride along on either path.
  const stream = createReadStream(target);
  stream.once('open', () => {
    res.writeHead(200, { 'Content-Type': contentTypeFor(target) });
    logLine(req, 200);
  });
  stream.on('error', (err) => {
    console.error(`serve: read error for ${req.url}: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500 Internal Server Error');
      logLine(req, 500);
    } else {
      res.destroy(); // mid-stream failure: truncate the response, keep serving
    }
  });
  stream.pipe(res);
}

function openBrowser(url) {
  try {
    const child =
      process.platform === 'win32'
        ? spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true })
        : process.platform === 'darwin'
          ? spawn('open', [url], { detached: true, stdio: 'ignore' })
          : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      // Best-effort only — the printed URL above is the fallback.
    });
    child.unref();
  } catch {
    // Best-effort only — the printed URL above is the fallback.
  }
}

function listen(server, basePort, attempt) {
  const port = basePort + attempt;
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
      listen(server, basePort, attempt + 1);
      return;
    }
    if (err.code === 'EADDRINUSE') {
      console.error(
        `serve: ports ${basePort}-${basePort + MAX_PORT_ATTEMPTS} are all in use — set PORT to pick a different one.`,
      );
    } else {
      console.error(`serve: ${err.message}`);
    }
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`Document Graph Explorer (air-gapped build) — serving ${url}`);
    console.log('(localhost-only; press Ctrl+C to stop)');
    openBrowser(url);
  });
}

function main() {
  if (!existsSync(INDEX_HTML)) {
    console.error('Air-gapped build not found — run: npm run build:airgap');
    process.exit(1);
    return;
  }

  const basePort = Number(process.env.PORT) || DEFAULT_PORT;
  const server = createServer(handleRequest);
  listen(server, basePort, 0);
}

// Only run the server when this file is executed directly (e.g. `node
// scripts/serve.mjs`), so the pure helpers above stay importable — and
// side-effect-free — from tests.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}
