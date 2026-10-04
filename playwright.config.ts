import { defineConfig, devices } from '@playwright/test';

// E2E smoke suite for the built app. Serve dist via `vite preview` — the dev
// server emits benign-but-loud wasm MIME console errors and can reload
// mid-ingest on dependency re-optimization, so it is not a valid test target.
// Run `npm run build` before `npx playwright test`.
// This config is typechecked with the app's browser-scoped tsconfig (no node
// ambient types), so CI detection reads process off globalThis instead.
const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const IS_CI = Boolean(ENV?.CI);
const CHANNEL = ENV?.PLAYWRIGHT_CHANNEL;
const PORT = Number(ENV?.PLAYWRIGHT_PORT ?? 4173);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PLAYWRIGHT_PORT must be an integer between 1 and 65535.');
}

export default defineConfig({
  testDir: 'e2e',
  // The demo-corpus ingest (100 PDFs, parse + OCR-capable + local embeddings)
  // takes 20-60s on a dev machine and can be several times slower on shared
  // CI under SwiftShader, so per-test budgets are deliberately generous.
  // SwiftShader renders the 3D scene at seconds-per-frame, and node selection
  // commits inside the render loop — frame-dependent expects need minutes,
  // and a small viewport keeps software frames as cheap as possible.
  timeout: 420_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: IS_CI ? 1 : 0,
  reporter: IS_CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: CHANNEL,
    // Camera focus commits synchronously under reduced motion, so node
    // selection opens the side panel without waiting on the camera glide.
    // (A browser-context option, not a first-class test option — putting it
    // at the `use` top level typechecks red and silently does nothing.)
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    launchOptions: {
      // Headless CI has no GPU; SwiftShader provides the WebGL context the
      // 3D scene needs (side-panel opening runs inside the R3F frame loop).
      args: CHANNEL ? [] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    },
  },
  projects: [
    {
      name: 'chromium',
      // The device descriptor carries its own 1280x720 viewport, so the small
      // SwiftShader-friendly viewport must be set AFTER the spread to win.
      use: { ...devices['Desktop Chrome'], viewport: { width: 800, height: 500 } },
    },
  ],
  webServer: {
    // Bind the preview server to the same address Playwright polls. Vite's
    // default host is `localhost`, which resolves to ::1 first on machines
    // with IPv6 (GitHub runners do; this matters even though it happens to
    // resolve to 127.0.0.1 elsewhere) — the server would then listen on IPv6
    // only while Playwright waits on IPv4 and times out with no error output.
    command: `npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    // Never silently exercise an unrelated local app that owns this port.
    // Set PLAYWRIGHT_PORT when the default port is already occupied.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
