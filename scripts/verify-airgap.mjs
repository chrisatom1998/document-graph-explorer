// Post-build gate for `npm run build:airgap`: fails the build if the shipped
// CSP allows any external host. The airgap guarantee is enforced here, not
// trusted. No dependencies — plain Node ESM.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const htmlUrl = new URL('../dist-airgap/index.html', import.meta.url);

// Validate every directive, including default-src fallbacks. A URL regex alone
// misses bare hostnames, wildcards and network schemes such as https:.
const LOCAL_SOURCES = ["'self'", "'none'", 'blob:', 'data:'];
const SAFE_SOURCES = new Map([
  ...['default-src', 'connect-src', 'img-src', 'font-src', 'media-src', 'worker-src',
    'child-src', 'frame-src', 'object-src', 'manifest-src', 'prefetch-src']
    .map((directive) => [directive, new Set(LOCAL_SOURCES)]),
  ...['script-src', 'script-src-elem', 'script-src-attr']
    .map((directive) => [directive, new Set([...LOCAL_SOURCES, "'wasm-unsafe-eval'"])]),
  ...['style-src', 'style-src-elem', 'style-src-attr']
    .map((directive) => [directive, new Set([...LOCAL_SOURCES, "'unsafe-inline'"])]),
  ...['base-uri', 'form-action', 'frame-ancestors']
    .map((directive) => [directive, new Set(["'self'", "'none'"])]),
]);

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
  const seen = new Set();
  for (const entry of csp.split(';')) {
    const tokens = entry.trim().split(/\s+/);
    if (!tokens[0]) continue;
    const directive = tokens.shift().toLowerCase();
    if (seen.has(directive)) return `duplicate airgap CSP directive: ${directive}`;
    seen.add(directive);
    const allowed = SAFE_SOURCES.get(directive);
    if (!allowed) return `unsupported airgap CSP directive: ${directive}`;
    if (tokens.length === 0) return `empty airgap CSP directive: ${directive}`;
    const unsafe = tokens.filter((token) => !allowed.has(token));
    if (unsafe.length > 0) {
      return `non-local or unsupported ${directive} source(s): ${unsafe.join(' ')}\n  ${csp}`;
    }
  }
  for (const required of ['default-src', 'connect-src']) {
    if (!seen.has(required)) return `missing required airgap CSP directive: ${required}`;
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
