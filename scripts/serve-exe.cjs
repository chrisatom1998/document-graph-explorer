// CJS launcher entry for packaging a Windows executable with `pkg`.
// Serves the normal `dist` build from the executable's folder (or project
// root in dev) by default; pass --airgap to serve the sealed dist-airgap.
const { createServer } = require('node:http');
const { existsSync, statSync, createReadStream } = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const AIRGAP_MODE = process.argv.includes('--airgap');
const APP_BASE = process.pkg ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
const ROOT = path.join(APP_BASE, AIRGAP_MODE ? 'dist-airgap' : 'dist');
const INDEX_HTML = path.join(ROOT, 'index.html');
const DEFAULT_PORT = 8317;
const MAX_PORT_ATTEMPTS = 10;

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
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function contentTypeFor(pathname) {
  const ext = path.extname(pathname).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function resolveSafe(root, urlPath) {
  const rootAbs = path.resolve(root);

  let decoded;
  try {
    decoded = decodeURIComponent((urlPath || '').split('?')[0].split('#')[0]);
  } catch {
    return null;
  }

  const rel = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^[/\\]+/, '');
  if (path.isAbsolute(rel)) return null;

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

  const target = resolveSafe(ROOT, req.url || '/');
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

  if (stats.isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    logLine(req, 404);
    return;
  }

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
      res.destroy();
    }
  });
  stream.pipe(res);
}

function openBrowser(url) {
  try {
    const child = spawn('cmd', ['/c', 'start', '""', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Best-effort only.
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
        `serve: ports ${basePort}-${basePort + MAX_PORT_ATTEMPTS} are all in use - set PORT to pick a different one.`,
      );
    } else {
      console.error(`serve: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    const label = AIRGAP_MODE ? ' (air-gapped build)' : '';
    console.log(`Document Graph Explorer${label} - serving ${url}`);
    console.log('(localhost-only; close this window to stop)');
    openBrowser(url);
  });
}

function main() {
  if (!existsSync(INDEX_HTML)) {
    console.error(
      AIRGAP_MODE
        ? 'Air-gapped build not found - run: npm run build:airgap'
        : 'Build not found - run: npm run build',
    );
    process.exit(1);
    return;
  }

  const basePort = Number(process.env.PORT) || DEFAULT_PORT;
  const server = createServer(handleRequest);
  listen(server, basePort, 0);
}

main();
