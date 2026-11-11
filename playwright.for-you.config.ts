import { defineConfig, devices } from '@playwright/test';

// Browser tests for the For you view against a BUILT app served by `vite preview`
// on 127.0.0.1 (never the dev server, see AGENTS.md).
//
// The build is made by scripts/build-e2e.mjs with VITE_E2E_NO_INFERENCE=1, which
// turns on the test-only boundary in src/e2e/noInference.ts: no model preload, no
// audio analysis, and stub text embeddings. No model-fetch hook runs. Chrome is
// used through PLAYWRIGHT_CHANNEL (default `chrome`); no browser is downloaded.
// Chrome is additionally launched with a host-resolver rule that makes every
// host except 127.0.0.1 unresolvable, so a request cannot leave the machine even
// if a route filter is bypassed.
const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const PORT = Number(ENV?.PLAYWRIGHT_PORT ?? 4199);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PLAYWRIGHT_PORT must be an integer between 1 and 65535.');
const OUT_DIR = ENV?.E2E_DIST ?? 'node_modules/.cache/dge-e2e-dist';

export default defineConfig({
  testDir: 'e2e',
  testMatch: ['for-you.spec.ts'],
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  outputDir: ENV?.FOR_YOU_OUT ?? 'test-results',
  reporter: [['list'], ['json', { outputFile: ENV?.FOR_YOU_REPORT ?? 'test-results/for-you.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: ENV?.PLAYWRIGHT_CHANNEL ?? 'chrome',
    serviceWorkers: 'block',
    contextOptions: { reducedMotion: 'reduce' },
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx vite preview --outDir ${OUT_DIR} --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
