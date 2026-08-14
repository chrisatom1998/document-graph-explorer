// Dependency-free static server for the built app. Node builtins ONLY — no
// npm packages — so double-clicking a launcher (run.cmd / run.command /
// run.sh) works with nothing installed beyond Node itself.
//
// Serves the normal `dist/` build by default; pass `--airgap` to serve the
// sealed `dist-airgap/` build instead (the launchers forward their args).
//
// Binds 127.0.0.1 ONLY. This is a local convenience server for opening the
// app in a browser tab; it is never meant to be reachable from a LAN, so it
// does not offer a way to bind 0.0.0.0.
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { contentTypeFor, createRequestHandler, resolveSafe } from './staticServer.cjs';

/** Which build directory a given argv selects: `dist` unless `--airgap`. */
export function distDirFor(argv) {
  return argv.includes('--airgap') ? 'dist-airgap' : 'dist';
}

const AIRGAP_MODE = distDirFor(process.argv.slice(2)) === 'dist-airgap';
const DIST_DIR = AIRGAP_MODE ? 'dist-airgap' : 'dist';
const ROOT = fileURLToPath(new URL(`../${DIST_DIR}/`, import.meta.url));
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

function logLine(req, status) {
  console.log(`${status} ${req.method} ${req.url}`);
}

// Re-exported for src/tools/serveHelpers.test.ts and any other importers that
// used to pull these from this file — the implementations now live in the
// shared scripts/staticServer.cjs module (also used by serve-exe.cjs and
// desktop/main.cjs).
export { contentTypeFor, resolveSafe };

const handleRequest = createRequestHandler(ROOT, { headers: SECURITY_HEADERS, log: logLine });

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
    const label = AIRGAP_MODE ? ' (air-gapped build)' : '';
    // Plain hyphen (not an em dash) so the launcher console reads cleanly
    // under Windows' default OEM codepage instead of mojibaking.
    console.log(`Document Graph Explorer${label} - serving ${url}`);
    console.log('(localhost-only; press Ctrl+C to stop)');
    openBrowser(url);
  });
}

function main() {
  if (!existsSync(INDEX_HTML)) {
    console.error(
      AIRGAP_MODE
        ? 'Air-gapped build not found — run: npm run build:airgap'
        : 'Build not found — run: npm run build',
    );
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
