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

// CI runs the suite as parallel jobs, one per group, each on its own runner
// (SwiftShader + the ingest workers saturate a runner, so more workers per
// machine would only slow every test down). Playwright's --shard splits by
// test count, which leaves one shard with most of the minutes; these groups
// are balanced by measured CI duration instead (~37 min serial on 2026-10-06:
// smoke 9.6, annotations 4.9, audio-graph 4.8, graph-resolution 6.7,
// folder-theme 3.3, everything else ~8 combined). `rest` runs every spec not
// named here, so a new spec file is never silently skipped. Unset = all specs.
const E2E_GROUPS: Record<string, string[]> = {
  smoke: ['smoke.spec.ts'],
  collab: ['annotations.spec.ts', 'audio-graph.spec.ts'],
  graph: ['graph-resolution.spec.ts', 'folder-theme.spec.ts'],
};
const GROUP = ENV?.E2E_GROUP;
if (GROUP && GROUP !== 'rest' && !(GROUP in E2E_GROUPS)) {
  throw new Error(`E2E_GROUP must be one of: ${[...Object.keys(E2E_GROUPS), 'rest'].join(', ')}.`);
}
const groupFilter = !GROUP
  ? {}
  : GROUP === 'rest'
    ? { testIgnore: Object.values(E2E_GROUPS).flat() }
    : { testMatch: E2E_GROUPS[GROUP] };

export default defineConfig({
  testDir: 'e2e',
  ...groupFilter,
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
