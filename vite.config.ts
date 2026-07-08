/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { buildCsp } from './src/security/csp';

function injectCsp(airgap: boolean): Plugin {
  const csp = buildCsp({ airgap });
  return {
    name: 'document-graph-explorer:inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</title>',
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

/**
 * Anti-clickjacking + misc hardening. `frame-ancestors` cannot be expressed
 * in a <meta> CSP, so framing is denied via headers instead. Vite serves
 * these in dev/preview; PRODUCTION HOSTING MUST SEND THEM TOO (plus ideally
 * the CSP above as a header) — copy them into your host's header config.
 */
const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

// NOTE: no COOP/COEP headers on purpose — we use transferable Float32Arrays
// (not SharedArrayBuffer), so cross-origin isolation buys nothing here.
export default defineConfig(({ mode }) => ({
  plugins: [react(), injectCsp(mode === 'airgap')],
  server: { headers: SECURITY_HEADERS },
  preview: { headers: SECURITY_HEADERS },
  worker: { format: 'es' },
  build: { target: 'esnext' },
  optimizeDeps: {
    // transformers.js does its own dynamic ORT backend imports; pre-bundling breaks it.
    // It is also dynamically imported inside pipeline.worker.ts so its module
    // graph never sits on a worker's boot path.
    exclude: ['@huggingface/transformers'],
    // Scan the worker sources at server start so their deps (remark, graphology,
    // d3-force-3d, …) are discovered and optimized UP FRONT. Discovering them
    // mid-session triggers "optimized dependencies changed. reloading", which
    // kills an in-flight ingestion (dev-only failure mode).
    entries: [
      'index.html',
      'src/workers/pipeline.worker.ts',
      'src/workers/aggregator.worker.ts',
      'src/workers/layout.worker.ts',
    ],
    // graphology is imported ONLY inside aggregator.worker.ts, and jszip /
    // fast-xml-parser ONLY inside pipeline.worker.ts (via parsers/office.ts).
    // Vite's entries scan doesn't reliably pre-bundle worker-only deps — so
    // without this they're discovered mid-ingest, and the re-optimize aborts
    // the worker's in-flight imports (every parse fails, the run collapses
    // back to idle). All four are DOM-free libs, so force-including them is
    // safe (this is the audited exception to avoiding a general include-list,
    // which under Vite 8 produced client-env chunks in workers — `document is
    // not defined`).
    include: ['graphology', 'graphology-communities-louvain', 'jszip', 'fast-xml-parser'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
}));
