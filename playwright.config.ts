import { defineConfig, devices } from '@playwright/test';

// E2E smoke suite for the built app. Serve dist via `vite preview` — the dev
// server emits benign-but-loud wasm MIME console errors and can reload
// mid-ingest on dependency re-optimization, so it is not a valid test target.
// Run `npm run build` before `npx playwright test`.
const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  // The demo-corpus ingest (100 PDFs, parse + OCR-capable + local embeddings)
  // takes 20-60s on a dev machine and can be several times slower on shared
  // CI under SwiftShader, so per-test budgets are deliberately generous.
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Camera focus commits synchronously under reduced motion, so node
    // selection opens the side panel without waiting on the camera glide.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    launchOptions: {
      // Headless CI has no GPU; SwiftShader provides the WebGL context the
      // 3D scene needs (side-panel opening runs inside the R3F frame loop).
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
