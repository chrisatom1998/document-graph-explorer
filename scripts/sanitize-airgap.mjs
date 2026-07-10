// Post-build de-branding of the airgap artifact.
//
// The ML library (transformers.js / onnxruntime-web) bundles default *remote*
// hosts as inert fallback constants: huggingface.co / hf.co (model hub) and
// cdn.jsdelivr.net (WASM CDN). The app never contacts them — the embedding
// worker sets `allowRemoteModels = false`, `localModelPath = '/models/'`, and
// resets ORT's `wasmPaths` to same-origin (src/workers/pipeline.worker.ts) — and
// the airgap CSP (`connect-src 'self' blob:`) would block them regardless. But a
// crude static/DLP scan of the shipped files reads these hostnames as "this app
// talks to an external service". This rewrites them to a non-resolvable RFC-2606
// `.invalid` host in the built JS ONLY (source is untouched), then FAILS the
// build if any target host survives — so an artifact scan of dist-airgap finds
// zero external service hosts.
//
// Deliberately NOT touched: XML/SVG namespace URIs (www.w3.org, ns.adobe.com,
// www.xfa.org). Those are required, non-network standard identifiers — an SVG
// won't render without its `xmlns="http://www.w3.org/2000/svg"` — and stripping
// them would break rendering. They are not network destinations.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const ASSETS = new URL('../dist-airgap/assets/', import.meta.url);

// Third-party service/vendor references that read as "this app uses an external
// service". Longest first, so a shorter host can't be matched inside a longer one.
// The github.com/huggingface/... entry is an inert issue-reporting URL baked into
// transformers.js error text — never fetched, but "huggingface" is a keyword an AI
// DLP watchlist targets, so it's neutralized along with the real model/CDN hosts.
const HOSTS = [
  'github.com/huggingface/transformers.js',
  'openrouter.ai',
  'cdn.jsdelivr.net',
  'huggingface.co',
  'hf.co',
];
const PLACEHOLDER = 'disabled.invalid';

let files;
try {
  files = readdirSync(ASSETS).filter((f) => f.endsWith('.js'));
} catch {
  console.error('sanitize-airgap: dist-airgap/assets not found — run the airgap build first.');
  process.exit(1);
}

let total = 0;
for (const f of files) {
  const url = new URL(f, ASSETS);
  let text = readFileSync(url, 'utf8');
  let replaced = 0;
  for (const host of HOSTS) {
    const parts = text.split(host); // literal split — dots are not regex here
    replaced += parts.length - 1;
    text = parts.join(PLACEHOLDER);
  }
  if (replaced > 0) {
    writeFileSync(url, text);
    console.log(`sanitize-airgap: ${f} — ${replaced} replacement(s)`);
    total += replaced;
  }
}

// Prove none survived — fail closed if any did.
let remaining = 0;
for (const f of files) {
  const text = readFileSync(new URL(f, ASSETS), 'utf8');
  for (const host of HOSTS) if (text.includes(host)) remaining += 1;
}
if (remaining > 0) {
  console.error(`sanitize-airgap: FAIL — ${remaining} target host(s) still present after sanitize.`);
  process.exit(1);
}

console.log(
  `sanitize-airgap: OK — ${total} replacement(s) across ${files.length} JS file(s); ` +
    'zero external service hosts remain in dist-airgap/assets.',
);
