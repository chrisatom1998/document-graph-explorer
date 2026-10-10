import { djAssistantPlugin } from './src/server/djAssistant';
import { djCopilotPlugin } from './src/server/djCopilot';
import { djReviewerPlugin } from './src/server/djReviewer';
/// <reference types="vitest/config" />
import { defineConfig, loadEnv, searchForWorkspaceRoot, type Plugin } from 'vite';
import { existsSync, realpathSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { buildCsp } from './src/security/csp';
import pkg from './package.json';
import { essentiaCsp } from './scripts/essentia-csp';

// In a git worktree, node_modules is a symlink to the main checkout. Because
// onnxruntime-web is in optimizeDeps.exclude below, its .wasm files are served
// from their real path, which then lies outside the worktree root: Vite's fs
// guard refuses them, the SPA fallback answers with index.html, and every ONNX
// model fails with "no available backend found" (the wasm compiler reports
// `expected magic word 00 61 73 6d, found 0a 20 20 20` — that is the HTML).
// Allowing the resolved node_modules keeps worktrees working; in an ordinary
// checkout it resolves inside the root and changes nothing.
function serveRoots(): string[] {
  const roots = [searchForWorkspaceRoot(process.cwd())];
  if (existsSync('node_modules')) roots.push(realpathSync('node_modules'));
  return roots;
}

function injectCsp(airgap: boolean): Plugin {
  const csp = buildCsp({ airgap });
  return {
    name: 'document-graph-explorer:inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      // Tags-array form (not a raw string replace) so this composes correctly
      // with other transformIndexHtml hooks instead of clobbering their edits.
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
            injectTo: 'head-prepend',
          },
        ],
      };
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
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // Disable browser features not used by the app. camera/microphone/geolocation
  // are irrelevant; payment/usb/serial would be surprising in a document viewer.
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()',
};

// Worker entry files get a per-deploy suffix. Under COEP require-corp a
// browser refuses to start a worker whose response lacks COEP, and a
// content-hashed worker whose code didn't change keeps its old URL across a
// header change — so visitors with a cached pre-COEP copy saw every worker
// fail ("Layout engine failed"). A new URL per deploy means a cached copy
// served with older headers can never be reused.
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 8);
/** pdf.js loads its worker from a plain asset URL (from the page and from
 * inside pdf.worker.ts), so that asset needs the same suffix. */
const workerAssetFileNames = (info: { names: string[] }): string =>
  info.names.some((n) => /\.worker\b.*\.m?js$/.test(n))
    ? `assets/[name]-[hash]-${BUILD_ID}[extname]`
    : 'assets/[name]-[hash][extname]';

// Isolation permits bounded ONNX WASM threading. All model/runtime resources
// remain same-origin; hosts without isolation retain one-thread inference.
export default defineConfig(({ mode }) => ({
  plugins: [essentiaCsp(), react(), tailwindcss(), injectCsp(mode === 'airgap'), ...(mode === 'airgap' ? [] : [djAssistantPlugin(loadEnv(mode, process.cwd(), '').OPENAI_API_KEY ?? ''), djCopilotPlugin(loadEnv(mode, process.cwd(), '').OPENAI_API_KEY ?? ''), djReviewerPlugin()])],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { fs: { allow: serveRoots() }, headers: { ...SECURITY_HEADERS, 'Permissions-Policy': mode === 'airgap' ? SECURITY_HEADERS['Permissions-Policy'] : SECURITY_HEADERS['Permissions-Policy'].replace('microphone=()', 'microphone=(self)') } },
  // Workers receive Vercel's CSP as a response header, not the page's meta tag.
  // Exercise the same restrictions in built-app browser tests.
  preview: { headers: { ...SECURITY_HEADERS, 'Content-Security-Policy': `${buildCsp({ airgap: mode === 'airgap' })}; frame-ancestors 'none'` } },
  worker: {
    format: 'es',
    plugins: () => [essentiaCsp()],
    rolldownOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
        assetFileNames: workerAssetFileNames,
      },
    },
  },
  build: {
    target: 'esnext',
    // Keep the app entry from eagerly preloading the React vendor chunk; the
    // bundle-budget gate in scripts/check-bundle.mjs counts that overhead as
    // part of the initial page budget and Vercel can drift above the threshold
    // when modulepreload is enabled even though the app itself still builds.
    modulePreload: false,
    // The largest chunk is the demand-loaded WebGL renderer. Eager code has a
    // much tighter, separately enforced budget in scripts/check-bundle.mjs.
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        assetFileNames: workerAssetFileNames,
        codeSplitting: {
          groups: [
            // React is the only eager framework vendor. Feature libraries stay
            // with their lazy route/panel so they cannot leak into index.html.
            { name: 'vendor-react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            // Follow-mode framing is used by the eager collaboration store, but
            // keeping that feature seam separate prevents camera sync growth from
            // consuming the tightly budgeted application entry chunk.
            { name: 'collab-view', test: /[\\/]src[\\/]collab[\\/]viewFrame\.ts$/, priority: 20 },
            // Rolldown otherwise gives every module the entry shares with a lazy
            // chunk its own small file, so the first load becomes ~20 requests and
            // an extra round trip (modulePreload is off). Keep them in one chunk.
            { name: 'app-shell', tags: ['$initial'], test: /^(?![\s\S]*[\\/]node_modules[\\/])/, priority: 10 },
          ],
        },
      },
    },
  },
  optimizeDeps: {
    // transformers.js does its own dynamic ORT backend imports; pre-bundling breaks it.
    // It is also dynamically imported inside pipeline.worker.ts so its module
    // graph never sits on a worker's boot path.
    exclude: ['@huggingface/transformers', 'onnxruntime-web', 'onnxruntime-web/webgpu', 'essentia.js/dist/essentia-wasm.es.js'],
    // Scan the worker sources at server start so their deps (remark, graphology,
    // d3-force-3d, …) are discovered and optimized UP FRONT. Discovering them
    // mid-session triggers "optimized dependencies changed. reloading", which
    // kills an in-flight ingestion (dev-only failure mode).
    entries: [
      'index.html',
      'src/workers/pipeline.worker.ts',
      'src/audio/musicAnalysis.worker.ts',
      'src/workers/aggregator.worker.ts',
      'src/workers/layout.worker.ts',
      'src/workers/insights.worker.ts',
      'src/workers/pdf.worker.ts',
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
    include: ['essentia.js/dist/essentia.js-core.es.js', 'graphology', 'graphology-communities-louvain', 'jszip', 'fast-xml-parser'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'agent/**/*.test.js'],
    setupFiles: ['src/test/setup.ts'],
  },
}));
