# AGENTS.md

## Cursor Cloud specific instructions

This repo is a **single client-side web app** ("Document Graph Explorer" / "Knowledge Nebula"): React 19 + Vite + React Three Fiber. All parsing, embeddings, and clustering run in the browser (web workers + a self-hosted `bge-small-en-v1.5` model in `public/models/`). There is no backend server to run.

Standard commands live in `package.json` scripts and are documented in `README.md`; use those (`npm run dev`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`). CI (`.github/workflows/ci.yml`) runs lint → typecheck → test → build.

Non-obvious notes:

- **Run the app**: `npm run dev` serves at `http://localhost:5173/` (no `--host` by default; it's localhost-only). This is the dev flow — do not use the desktop/exe/preview scripts for development.
- **Hello-world / smoke test**: on the welcome screen click **"Load demo corpus"**, then wait ~20-60s (Parsing → Embedding → Clustering) for the force-directed 3D graph of ~40-60 document nodes to render. First run downloads/loads the bundled embedding model, so the initial ingest is slow.
- **Desktop / packaging scripts are platform-locked and NOT runnable here**: `build:desktop` / `dist:mac` require macOS; `build:exe` and `install:desktop` target Windows. On this Linux VM, stick to the web `dev`/`build` scripts.
- **Dev-server dependency gotcha**: worker-only deps are force-listed in `optimizeDeps.include` in `vite.config.ts` so a mid-ingest re-optimize ("optimized dependencies changed. reloading") doesn't abort an in-flight parse. If you add worker-only dependencies, mirror that pattern or ingestion can silently fail in dev.
- Tests run under Vitest (Node by default, jsdom where a file opts in) and cover pipeline/graph modules plus UI/jsdom helpers, coordinator ingest with mocked workers, and aggregator message contracts.
- **Browser e2e smoke suite**: `e2e/*.spec.ts` runs under Playwright against the *built* app (`npm run build`, then `npx playwright test` — the config starts `vite preview` itself). It loads the demo corpus end-to-end in headless Chromium (SwiftShader WebGL), so it exercises the real worker pipeline that vitest mocks. Never target the dev server (wasm MIME console errors + mid-ingest re-optimize reloads cause false failures), and never run `playwright install` in this sandbox (browsers are preinstalled at `PLAYWRIGHT_BROWSERS_PATH`).
