// Post-build gate for `npm run build:airgap`: fails the build if the shipped
// CSP allows any external host. The airgap guarantee is enforced here, not
// trusted. No dependencies — plain Node ESM.
import { readFileSync } from 'node:fs';

const htmlUrl = new URL('../dist-airgap/index.html', import.meta.url);

let html;
try {
  html = readFileSync(htmlUrl, 'utf8');
} catch {
  console.error('verify-airgap: dist-airgap/index.html not found — run the airgap build first.');
  process.exit(1);
}

const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
if (!match) {
  console.error('verify-airgap: FAIL — no CSP <meta> found in dist-airgap/index.html.');
  process.exit(1);
}

const csp = match[1];

// Fail closed on ANY external destination. Two layers:
// (1) connect-src is the exfiltration surface (fetch/XHR/WebSocket/beacon) — every
//     token must be a local, non-network source. An allow-list catches bare
//     hostnames (telemetry.example.com), wildcards (*), and ws/wss hosts that a
//     scheme-only regex misses.
// (2) a coarse scheme scan over the whole policy catches an external URL host
//     sneaking into any OTHER directive (img-src, font-src, …).
const SAFE_CONNECT = new Set(["'self'", "'none'", 'blob:', 'data:']);
const connectMatch = csp.match(/connect-src ([^;]*)/i);
const connectTokens = connectMatch ? connectMatch[1].trim().split(/\s+/).filter(Boolean) : [];
const badConnect = connectTokens.filter((t) => !SAFE_CONNECT.has(t));
if (badConnect.length > 0) {
  console.error('verify-airgap: FAIL — non-local connect-src source(s): ' + badConnect.join(' ') + '\n  ' + csp);
  process.exit(1);
}
if (/[a-z]+:\/\//i.test(csp)) {
  console.error('verify-airgap: FAIL — external URL host present in airgap CSP:\n  ' + csp);
  process.exit(1);
}

console.log('verify-airgap: OK — airgap CSP has no external host.\n  ' + csp);
