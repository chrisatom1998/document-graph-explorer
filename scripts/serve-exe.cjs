// CJS launcher entry for packaging a Windows executable with `pkg`.
// Serves the normal `dist` build from the executable's folder (or project
// root in dev) by default; pass --airgap to serve the sealed dist-airgap.
const { createServer } = require('node:http');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createRequestHandler } = require('./staticServer.cjs');

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

function logLine(req, status) {
  console.log(`${status} ${req.method} ${req.url}`);
}

const handleRequest = createRequestHandler(ROOT, { headers: SECURITY_HEADERS, log: logLine });

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
