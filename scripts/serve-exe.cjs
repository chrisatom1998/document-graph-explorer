// CJS launcher entry for the Windows executable, built as a Node Single
// Executable Application by scripts/build-win-exe.mjs (esbuild bundles this
// file with staticServer.cjs because a SEA main script can only require()
// builtins). Serves the normal `dist` build from the executable's folder (or
// project root in dev) by default; pass --airgap to serve dist-airgap.
const { createServer } = require('node:http');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createRequestHandler } = require('./staticServer.cjs');

const AIRGAP_MODE = process.argv.includes('--airgap');
function runningAsSea() {
  try {
    return require('node:sea').isSea();
  } catch {
    return false;
  }
}
const APP_BASE = runningAsSea() ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
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
  const onListening = () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const label = AIRGAP_MODE ? ' (air-gapped build)' : '';
    console.log(`Document Graph Explorer${label} - serving ${url}`);
    console.log('(localhost-only; close this window to stop)');
    openBrowser(url);
  };
  server.once('error', (err) => {
    // A failed listen leaves its callback queued for the next successful bind.
    server.removeListener('listening', onListening);
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

  server.listen(port, '127.0.0.1', onListening);
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
