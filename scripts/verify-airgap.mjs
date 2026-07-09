// Post-build gate for `npm run build:airgap`: fails the build if the shipped
// CSP allows any external host. The airgap guarantee is enforced here, not
// trusted. No dependencies — plain Node ESM.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const htmlUrl = new URL('../dist-airgap/index.html', import.meta.url);

// Fail closed on ANY external destination. Two layers:
// (1) connect-src is the exfiltration surface (fetch/XHR/WebSocket/beacon) — every
//     token must be a local, non-network source. An allow-list catches bare
//     hostnames (telemetry.example.com), wildcards (*), and ws/wss hosts that a
//     scheme-only regex misses.
// (2) a coarse scheme scan over the whole policy catches an external URL host
//     sneaking into any OTHER directive (img-src, font-src, …).
const SAFE_CONNECT = new Set(["'self'", "'none'", 'blob:', 'data:']);

export function decodeHtmlAttribute(value) {
  return value.replace(/&(#\d+|#x[\da-f]+|amp|apos|gt|lt|quot);/gi, (_match, entity) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith('#x')) return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
    if (normalized.startsWith('#')) return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
    return { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' }[normalized];
  });
}

export function extractCspFromHtml(html) {
  const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
  return match ? decodeHtmlAttribute(match[1]) : null;
}

export function getAirgapCspFailure(csp) {
  const connectMatch = csp.match(/connect-src ([^;]*)/i);
  const connectTokens = connectMatch ? connectMatch[1].trim().split(/\s+/).filter(Boolean) : [];
  const badConnect = connectTokens.filter((t) => !SAFE_CONNECT.has(t));
  if (badConnect.length > 0) {
    return 'non-local connect-src source(s): ' + badConnect.join(' ') + '\n  ' + csp;
  }
  if (/[a-z]+:\/\//i.test(csp)) {
    return 'external URL host present in airgap CSP:\n  ' + csp;
  }
  return null;
}

function run() {
  let html;
  try {
    html = readFileSync(htmlUrl, 'utf8');
  } catch {
    console.error('verify-airgap: dist-airgap/index.html not found — run the airgap build first.');
    process.exit(1);
  }

  const csp = extractCspFromHtml(html);
  if (!csp) {
    console.error('verify-airgap: FAIL — no CSP <meta> found in dist-airgap/index.html.');
    process.exit(1);
  }

  const failure = getAirgapCspFailure(csp);
  if (failure) {
    console.error('verify-airgap: FAIL — ' + failure);
    process.exit(1);
  }

  console.log('verify-airgap: OK — airgap CSP has no external host.\n  ' + csp);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run();
}
