# Requirement R4 Technical Audit: Test Coverage, CI/CD, Linting Rigor & Airgap Verification

**Auditor**: Teamwork Explorer (Requirement R4 Specialist)  
**Date**: August 21, 2026  
**Target Repository**: Document Graph Explorer (`document-graph-explorer`)  
**Scope**: Vitest automated test suites, Web Worker contracts & mock realism, TypeScript/ESLint rigor, Airgap security & CSP compliance, Packaging scripts, and GitHub Actions CI/Release pipelines.

---

## 1. Executive Summary & Audit Scorecard

| Dimension | Measured State | Benchmark / Target | Evaluation | Status |
|---|---|---|---|---|
| **Vitest Test Suite** | 179 test files, 1,184 passed, 1 skipped (16.07s duration) | > 1,000 unit/integration tests | 100% passing across Node & jsdom | ✅ Operational |
| **Code Coverage Tooling** | `@vitest/coverage-v8` **missing**; 0% tracked in CI | Standardized LCOV + CI threshold gates (>80%) | Vitest crashes on `--coverage` flag | ❌ Critical Gap |
| **R3F Scene Components** | 19 `.tsx` components in `src/scene/` (0% direct coverage) | WebGL mock / component smoke tests | Untested rendering, shaders, buffers | ❌ High Blind Spot |
| **Layout Worker & Bridge** | `layoutBridge.ts` (375 lines) has 0 unit tests | Unit tests for slot allocation & crash recovery | Critical single-point of failure | ❌ High Blind Spot |
| **Parser Polyfills & Codecs** | `pdfUint8ArrayPolyfill`, `pdfMapUpsertPolyfill`, `pdfLinkLabels` untested | 100% unit test coverage on all polyfills/codecs | Risk of silent Electron/preview crashes | ⚠️ Medium Gap |
| **Mock Realism** | Ingest coordinator heavily mocked (`layoutBridge`, `WorkerPool`, `cache`) | Worker message serialization & transfer buffer integration | Mocks pass even if transferables detach | ⚠️ Medium Gap |
| **TypeScript Strictness** | `strict: true`, but `noUncheckedIndexedAccess: false` | Comprehensive bounds-checked array access | Out-of-bounds array/buffer indexing risk | ⚠️ Medium Debt |
| **ESLint Rule Strictness** | `@typescript-eslint/no-explicit-any: 'off'`, `ban-ts-comment: 'off'`, `exhaustive-deps: 'warn'` | Explicit any banned, exhaustive-deps error in CI | Stale closures & unchecked any escapes | ⚠️ Medium Debt |
| **OpenUSD Python Tools** | `usd_pipeline.py` & `usd_agent.py` (36.8 KB) have 0 tests and 0 CI checks | Pytest suite + ruff/mypy checks in CI | Schema desync risks with `usdExport.ts` | ❌ High Blind Spot |
| **Airgap Security & CSP** | Zero remote calls; local model `/models/`, OCR `/ocr/`, fonts self-hosted; strict CSP | 100% airgap compliance, no external leaks | Validated via `verify-airgap` & `verify-runtime-assets` | ✅ Fully Compliant |
| **CI Platform Matrix** | Single OS runner: `ubuntu-latest` only | Matrix: `ubuntu-latest`, `macos-latest`, `windows-latest` | macOS `.app` & Windows native paths untested | ❌ High Gap |
| **Release Automation** | `release.yml` only releases Windows pkg + portable exe; **macOS & Linux desktop omitted** | Cross-platform release artifacts (DMG/App, Exe, AppImage) | macOS DMG and Linux AppImage never released | ❌ High Gap |
| **Node Version Alignment** | CI (Node 22), Release (Node 22), Docker (Node 24-alpine), Pkg (Node 18) | Single pinned Node LTS across all pipelines | Packaging drift risk | ⚠️ Medium Risk |

---

## 2. 5-Component Technical Audit Handoff

### Component 1: Observations (Line-Level Citations & Telemetry)

#### 1. Vitest Test Suite & Coverage Infrastructure
- **Observation 1.1 (Coverage Provider Missing)**:
  - `package.json` lines 56–80: `@vitest/coverage-v8` and `@vitest/coverage-istanbul` are completely missing from `devDependencies`.
  - `vite.config.ts` lines 110–114:
    ```ts
    test: {
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}', 'agent/**/*.test.js'],
      setupFiles: ['src/test/setup.ts'],
    },
    ```
    There is no `coverage` configuration block, no reporter, and no coverage threshold gate. Running `vitest run --coverage` fails with `Error: Failed to load coverage provider "@vitest/coverage-v8"`.
- **Observation 1.2 (3D Scene R3F Component Blind Spot)**:
  - `src/scene/` contains 19 `.tsx` components totaling over 200 KB:
    - `Nodes.tsx` (31.2 KB, 680 lines): Instanced mesh rendering of 4,096 nodes, dynamic Float32Array attribute binding, hover picking, selection uniforms.
    - `Edges.tsx` (26.5 KB, 580 lines): Batched LineSegments2, quadratic bezier curve evaluation, alpha blending.
    - `CameraRig.tsx` (16.4 KB, 390 lines): Orbit controls, focus framing, 2D/3D planar projection transitions.
    - `ClusterCollapse.tsx` (15.7 KB), `Labels.tsx` (13.7 KB), `PathRouteOverlay.tsx` (13.3 KB), `ClusterBridges.tsx` (12.4 KB), `Starfield.tsx` (8.7 KB), `NebulaCanvas.tsx` (7.8 KB), `AiCore.tsx` (7.9 KB), `EdgePulses.tsx` (7.1 KB), `AutoQuality.tsx` (6.4 KB), `ClusterAtmosphere.tsx` (6.2 KB), `NebulaClouds.tsx` (5.6 KB), `Effects.tsx` (5.3 KB), `FlatClusterLabels.tsx` (4.3 KB), `SelectionHalo.tsx` (3.4 KB), `PeerPresence.tsx` (2.9 KB), `FocusLight.tsx` (2.5 KB).
  - All 19 components have **0% unit test coverage** (0 `*.test.tsx` files exist in `src/scene/`).
  - Untested pure scene math helpers: `src/scene/edgeCurve.ts` (126 lines — quadratic bezier out-of-bounds and origin singularity math), `src/scene/positionBuffer.ts` (59 lines), `src/scene/cameraPose.ts` (20 lines), `src/scene/proceduralTextures.ts` (181 lines).
- **Observation 1.3 (Layout Worker & Layout Bridge Subsystem)**:
  - `src/layout/layoutBridge.ts` (375 lines): Owns node slot allocation (`nextSlot`, `freeSlots` recycling), transferable buffer return (`returnBuffer`), worker crash recovery within `CRASH_WINDOW_MS = 10_000`, state mirroring (`lastLinks`, `lastClusterOf`, `lastDims`), and dimension changes.
  - `src/layout/layoutBridge.ts` has **0 unit tests** (`layoutBridge.test.ts` does not exist).
- **Observation 1.4 (Parser Polyfills & Edge Cases)**:
  - `src/pipeline/parsers/pdfUint8ArrayPolyfill.ts` (133 lines): Polyfills `Uint8Array.prototype.toHex`, `toBase64`, `fromHex`, `fromBase64` and generates string-serialized source `INSTALL_UINT8ARRAY_POLYFILL_SOURCE`. Has **0 unit tests**.
  - `src/pipeline/parsers/pdfMapUpsertPolyfill.ts` (51 lines): Polyfills `Map.prototype.getOrInsertComputed` and `getOrInsert` for pdf.js canvas renderer. Has **0 unit tests**.
  - `src/pipeline/parsers/pdfLinkLabels.ts` (60 lines): 2D geometry collision detection between PDF annotation rectangles and stream text spans. Has **0 unit tests**.
  - `src/pipeline/parsers/txt.ts`, `html.ts`, `markdown.ts`: Lack standalone codec unit tests for malformed HTML, nested blockquotes, non-UTF8 buffers.
- **Observation 1.5 (Zustand Store Coverage Gaps)**:
  - `src/store/chatStore.ts` (84 lines): Message ordering, streaming state, restored session transcript ID re-indexing (`replaceMessages`). Has **0 direct unit tests**.
  - `src/store/folderWatchStore.ts` (28 lines): Folder handle & watch status. Has **0 unit tests**.
  - `src/store/runtimeStores.ts` (58 lines): `dirtyDocIds`, `clearRuntimeStores`, chunk vector lookup. Has **0 unit tests**.
  - `src/store/uiStore.ts` (280 lines): Only dimension toggle is tested (`uiStore.dims.test.ts`); panel state, focus trap, search overlay, and modal state are untested at store level.
- **Observation 1.6 (Mock Realism in Ingest Coordinator)**:
  - `src/pipeline/coordinator.ingest.test.ts` lines 30–102 mock `WorkerPool`, `layoutBridge`, `cache`, `sessionSave`, `originals`, `corpusRepository`, `quota`, and `parsePdf`, and uses a mock `FakeAggWorker`.
  - There is no contract test asserting that real `Transferable` buffers passed between `WorkerPool` -> `pipeline.worker.ts` -> `aggregator.worker.ts` -> `layout.worker.ts` maintain structural clone validity and do not throw detached buffer errors in production builds.

#### 2. Linting & Typechecking Configuration
- **Observation 2.1 (TypeScript `tsconfig.json`)**:
  - `tsconfig.json` lines 1–24:
    - `"strict": true` is enabled.
    - `"noUncheckedIndexedAccess"` is **missing** (defaults to `false`). In `src/scene/edgeCurve.ts`, `src/graph/pathfinding.ts`, `src/search/retrieval.ts`, indexing `arr[i]` returns `T` instead of `T | undefined`.
    - `"exactOptionalPropertyTypes"` is **missing** (defaults to `false`).
    - `"include": ["src", "vite.config.ts"]` excludes `scripts/`, `agent/`, and `tools/`.
- **Observation 2.2 (ESLint `eslint.config.js`)**:
  - `eslint.config.js` lines 55–66:
    - `'@typescript-eslint/no-explicit-any': 'off'` disables all `any` warnings across the repository.
    - `'@typescript-eslint/ban-ts-comment': 'off'` permits unannotated `@ts-ignore` comments.
    - `'react-hooks/exhaustive-deps': 'warn'` emits warnings but does not fail CI.
- **Observation 2.3 (OpenUSD Python Tooling)**:
  - `tools/usd_pipeline/usd_pipeline.py` (222 lines) and `usd_agent.py` (708 lines) have 0 tests, no `pytest` configuration, and no `ruff`/`flake8`/`mypy` checks configured in CI.

#### 3. Airgap Security & CSP Compliance
- **Observation 3.1 (Content Security Policy Enforcement)**:
  - `src/security/csp.ts` lines 23–42: Builds CSP with `airgap` boolean flag.
  - Standard mode: `connect-src 'self' blob: https://openrouter.ai http://127.0.0.1:11434 http://localhost:11434 wss://signaling.yjs.dev`.
  - Airgap mode: `connect-src 'self' blob:`.
  - `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval' blob:`, `style-src 'self' 'unsafe-inline'`, `font-src 'self' data:`, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`.
  - Anti-clickjacking headers configured in `vite.config.ts` (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`).
- **Observation 3.2 (Offline Model & Asset Isolation)**:
  - Embeddings (`src/workers/pipeline.worker.ts` lines 199–208): `env.allowLocalModels = true; env.allowRemoteModels = false; env.localModelPath = '/models/'; env.backends.onnx.wasm.wasmPaths = undefined;`. Prevents any HuggingFace Hub network calls and routes WASM loading through same-origin `import.meta.url`.
  - OCR (`src/pipeline/parsers/ocr.ts` lines 14–16): Loads same-origin worker `/ocr/worker.min.js`, `/ocr/core`, and `/ocr/lang/eng.traineddata.gz`.
  - Fonts (`src/styles.css` lines 16–25): `Space Grotesk` self-hosted in `assets/fonts/space-grotesk-latin.woff2`. Zero Google Fonts URLs.
  - PDF fonts: Standard-14 fonts bundled in `public/standard_fonts/LiberationSans-*.ttf`.
  - Sanitization (`scripts/sanitize-airgap.mjs`): Replaces fallback host strings (`openrouter.ai`, `cdn.jsdelivr.net`, `huggingface.co`, `hf.co`) with RFC-2606 `disabled.invalid` in built JS bundles.
  - Verification (`scripts/verify-airgap.mjs` and `scripts/verify-runtime-assets.mjs`): Asserts zero external hosts in CSP and validates WASM headers, ONNX models, OCR binaries, and font files.

#### 4. CI/CD & Release Workflows
- **Observation 4.1 (GitHub Actions CI Workflow)**:
  - `.github/workflows/ci.yml` lines 13–61:
    - Runs exclusively on `ubuntu-latest`.
    - Node version: `22`.
    - Steps: `npm run lint` -> `npm run typecheck` -> `npm test` -> `npm run build` -> `npm run build:airgap` -> `npm run check:bundle` -> Windows PE exe verification.
    - Gaps: No multi-OS matrix (`macos-latest`, `windows-latest`); no test coverage step/upload; no Python validation step; no headless browser smoke test.
- **Observation 4.2 (GitHub Actions Release Workflow)**:
  - `.github/workflows/release.yml` lines 11–84:
    - Runs on `ubuntu-latest`.
    - Node version: `22`.
    - Publishes: `dist.zip`, `dist-airgap.zip`, `Document-Graph-Explorer-*-win-pkg.zip`, `Document-Graph-Explorer-*-windows-x64-portable.zip`, and `Document.Graph.Explorer-*.exe`.
    - **Critical Omission**: macOS desktop bundle (`dist:mac` -> `.dmg`/`.zip`) and Linux desktop bundle (`dist:linux` -> `.AppImage`) are **never built or published** on release tag pushes!
- **Observation 4.3 (Packaging & Desktop Scripts)**:
  - `scripts/deploy-app.mjs` line 12: Hardcodes `release/mac-arm64/Document Graph Explorer.app`, breaking on Intel Macs (`mac-x64`) or universal builds.
  - `desktop/main.cjs` lines 13, 112: Fixed port `47182` rejects on port conflict with an uncaught error rather than diagnosing the collision.

---

### Component 2: Logic Chain (Root Cause Diagnosis & Reasoning)

1. **Why is missing coverage tooling a Critical risk?**
   - *Premise*: Without `@vitest/coverage-v8` in `devDependencies` and a configured `test.coverage` in `vite.config.ts`, Vitest cannot generate coverage reports (LCOV, HTML, or text summary).
   - *Deduction*: Pull requests cannot be gated on coverage thresholds. Critical subsystems like `layoutBridge.ts` and 19 R3F scene components can sit at 0% coverage indefinitely without developer or CI awareness.

2. **Why do R3F scene component blind spots cause high production risk?**
   - *Premise*: The 19 `.tsx` components in `src/scene/` contain complex Three.js render loop logic, shader uniform bindings, instanced attribute updates (e.g. `Nodes.tsx` 4,096-node buffer indexing), and camera animations.
   - *Deduction*: Unit tests covering pure math helpers (`emphasis.test.ts`, `palette.test.ts`) do not exercise React Three Fiber reconciliation or WebGL context behavior. A broken React 19 hook, invalid Three.js prop, or instanced buffer overflow will compile cleanly, pass Vitest, but crash the 3D canvas at runtime.

3. **Why does `layoutBridge.ts` lack of testing threaten application stability?**
   - *Premise*: `layoutBridge.ts` is the stateful bridge between the main thread and the background layout worker. It recycles node slots (`freeSlots`), swaps Float32Array transferable position buffers, and implements automatic crash detection (`CRASH_WINDOW_MS = 10_000`) and state re-seeding (`reseed`).
   - *Deduction*: Any logic error in slot recycling causes ghost nodes or out-of-bounds buffer reads in `positionBuffer.ts`. Any bug in crash recovery results in infinite spawn loops or permanent layout lockup.

4. **Why does `release.yml` omit macOS and Linux releases?**
   - *Premise*: `release.yml` runs only on `ubuntu-latest` and only executes `npm run build:exe` (pkg) and `npx electron-builder --win portable`. Electron-builder cannot produce macOS `.dmg` files on an Ubuntu host without macOS Darwin toolchains.
   - *Deduction*: Tagged releases published to GitHub only provide Windows executables. Mac and Linux users are completely deprived of release binaries despite package scripts (`dist:mac`, `dist:linux`) existing in `package.json`.

5. **Why is Airgap security verified as fully compliant?**
   - *Premise*: Codebase audit confirmed that `@huggingface/transformers` disables remote models (`allowRemoteModels = false`), routes ONNX WASM via `import.meta.url`, loads embeddings from `/models/`, loads OCR from `/ocr/`, uses local fonts, builds strict CSP with zero external destinations in airgap mode, and sanitizes built bundles.
   - *Deduction*: Under airgap mode, the browser cannot emit any off-origin HTTP, WebSocket, or DNS requests.

---

### Component 3: Caveats & Edge Cases

1. **WebGL / Canvas Mocking in Node Environment**:
   - Testing Three.js / React Three Fiber components in Vitest requires either jsdom with a mock WebGL context (`gl` or mock HTMLCanvasElement) or lightweight component smoke testing. Full WebGL shader execution and GPU rendering fidelity cannot be fully verified in Node without a real GPU or headless Chromium (Playwright).
2. **Platform Constraints for Desktop Packaging**:
   - macOS `.dmg` creation requires macOS (`macos-latest` GitHub runner). Windows portable executables require Windows or wine/pkg. A complete multi-platform release requires GitHub Actions matrix jobs across `ubuntu-latest`, `macos-latest`, and `windows-latest`.
3. **OpenUSD `usd-core` Binary Dependency**:
   - Pixar's `usd-core` Python package is large (~150 MB). CI jobs testing `tools/usd_pipeline/` will require caching `pip` wheels to avoid slow CI runs.

---

### Component 4: Conclusion & Prioritized Remediation Roadmap

The Document Graph Explorer codebase demonstrates **outstanding airgap security compliance**, **near-zero type escape hatches (`as any` / `@ts-ignore`)**, and a fast, reliable baseline test suite (179 test files, 1,184 passing tests).

However, significant coverage blind spots exist in:
1. **Tooling & Gating**: Missing `@vitest/coverage-v8` instrumentation and threshold enforcement.
2. **Subsystems**: 19 R3F scene components, `layoutBridge.ts`, and parser polyfills have 0% direct unit test coverage.
3. **CI/Release Pipeline**: Single-OS CI and omission of macOS/Linux desktop binaries in GitHub Releases.

#### Prioritized Remediation Matrix:

| ID | Finding | Severity | Effort | Target Files | Remediation Summary |
|---|---|---|---|---|---|
| **R4-1** | Missing `@vitest/coverage-v8` & CI Coverage Gate | **Critical** | **S** | `package.json`, `vite.config.ts`, `.github/workflows/ci.yml` | Install `@vitest/coverage-v8`, add coverage config with 80% threshold gate in CI. |
| **R4-2** | Multi-Platform CI Matrix & Automated macOS/Linux Releases | **High** | **M** | `.github/workflows/ci.yml`, `.github/workflows/release.yml` | Add `macos-latest` & `windows-latest` matrix; build and publish macOS DMG and Linux AppImage on release tags. |
| **R4-3** | Missing Layout Bridge Unit Test Suite | **High** | **M** | `src/layout/layoutBridge.ts`, create `src/layout/layoutBridge.test.ts` | Test slot allocation, slot recycling, transferable buffer return, and crash recovery re-seeding. |
| **R4-4** | Missing R3F Scene Component Smoke Tests | **High** | **L** | `src/scene/*.tsx`, create `src/scene/sceneSmoke.test.tsx` | Add WebGL mock test harness to verify `Nodes`, `Edges`, `CameraRig` mount and update without exceptions. |
| **R4-5** | Untested OpenUSD Python Pipeline & Missing CI Gate | **High** | **M** | `tools/usd_pipeline/`, `.github/workflows/ci.yml` | Add `pytest` test suite and `ruff`/`mypy` linting step in CI for OpenUSD tools. |
| **R4-6** | Missing Unit Tests for Parser Polyfills & Geometry Math | **Medium** | **S** | `src/pipeline/parsers/pdfUint8ArrayPolyfill.ts`, `pdfMapUpsertPolyfill.ts`, `pdfLinkLabels.ts` | Add dedicated unit tests for base64/hex conversion, map upsert callbacks, and PDF link bounding box math. |
| **R4-7** | Enable `noUncheckedIndexedAccess: true` in `tsconfig.json` | **Medium** | **M** | `tsconfig.json` | Enable `noUncheckedIndexedAccess: true` and resolve unchecked array/buffer index accesses. |
| **R4-8** | Tighten ESLint Strictness (`no-explicit-any`, `exhaustive-deps: 'error'`) | **Medium** | **M** | `eslint.config.js` | Enforce `exhaustive-deps: 'error'` and restrict `@typescript-eslint/no-explicit-any`. |
| **R4-9** | Harmonize Node.js Versions Across CI, Release, and Docker | **Medium** | **S** | `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `Dockerfile` | Standardize on Node 22 LTS across all pipeline configurations. |
| **R4-10** | Fix Hardcoded Architecture in `scripts/deploy-app.mjs` | **Medium** | **S** | `scripts/deploy-app.mjs` | Dynamically resolve `mac-arm64` vs `mac-x64` / `mac` based on `process.arch`. |
| **R4-11** | Add Automated Layout Convergence Benchmark Assertions | **Low** | **S** | `scripts/bench-layout.mjs` | Add upper-bound assertion thresholds to layout benchmark script. |

---

### Component 5: Verification Method & Concrete Code Diffs

#### Independent Verification Commands:
```bash
# 1. Verify baseline checks
npm run lint
npm run typecheck
npm test
npm run build
npm run build:airgap

# 2. Verify airgap security & asset integrity
node scripts/verify-airgap.mjs
node scripts/verify-runtime-assets.mjs dist
node scripts/verify-runtime-assets.mjs dist-airgap
node scripts/check-bundle.mjs dist
node scripts/check-bundle.mjs dist-airgap
```

---

### Concrete Remediation Diffs:

#### Remediation R4-1: Configure Vitest Coverage in `package.json` and `vite.config.ts`

```diff
--- a/package.json
+++ b/package.json
@@ -79,6 +79,7 @@
     "typescript": "^6.0.3",
     "typescript-eslint": "^8.62.1",
     "vite": "^7.3.6",
     "vite-node": "^3.0.0",
+    "@vitest/coverage-v8": "^4.1.9",
     "vitest": "^4.1.9"
   },
```

```diff
--- a/vite.config.ts
+++ b/vite.config.ts
@@ -111,6 +111,16 @@ export default defineConfig(({ mode }) => ({
     environment: 'node',
     include: ['src/**/*.test.{ts,tsx}', 'agent/**/*.test.js'],
     setupFiles: ['src/test/setup.ts'],
+    coverage: {
+      provider: 'v8',
+      reporter: ['text', 'json', 'html', 'lcov'],
+      include: ['src/**/*.{ts,tsx}'],
+      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
+      thresholds: {
+        lines: 80,
+        functions: 80,
+        branches: 75,
+        statements: 80,
+      },
+    },
   },
 }));
```

#### Remediation R4-2: Multi-Platform Matrix in `.github/workflows/ci.yml` and Multi-OS Release in `.github/workflows/release.yml`

```diff
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -13,7 +13,11 @@ concurrency:
 jobs:
   build-and-test:
-    runs-on: ubuntu-latest
+    strategy:
+      matrix:
+        os: [ubuntu-latest, macos-latest, windows-latest]
+    runs-on: ${{ matrix.os }}
     steps:
       - uses: actions/checkout@v4
```

```diff
--- a/.github/workflows/release.yml
+++ b/.github/workflows/release.yml
@@ -11,9 +11,13 @@ permissions:
   contents: write
 
 jobs:
-  release:
+  build-artifacts:
+    strategy:
+      matrix:
+        os: [ubuntu-latest, macos-latest, windows-latest]
+    runs-on: ${{ matrix.os }}
     steps:
       - uses: actions/checkout@v4
+      # Build macOS DMG/zip on macos-latest, Linux AppImage on ubuntu-latest, Windows exe on windows-latest
```

#### Remediation R4-3: Layout Bridge Unit Test Suite (`src/layout/layoutBridge.test.ts`)

```typescript
// Proposed src/layout/layoutBridge.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { positionBuffer, resetPositionBuffer } from '../scene/positionBuffer';
import {
  layoutAddNodes,
  layoutRemoveNodes,
  layoutSetLinks,
  layoutReset,
} from './layoutBridge';

describe('layoutBridge', () => {
  beforeEach(() => {
    resetPositionBuffer();
    layoutReset();
  });

  it('allocates and recycles node slots without exceeding MAX_NODES', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `doc-${i}`);
    layoutAddNodes(ids.map((id) => ({ id })));
    expect(positionBuffer.count).toBe(10);

    // Remove 5 nodes
    layoutRemoveNodes(ids.slice(0, 5));
    
    // Add 5 new nodes - should reuse freed slots
    const newIds = Array.from({ length: 5 }, (_, i) => `new-doc-${i}`);
    layoutAddNodes(newIds.map((id) => ({ id })));
    expect(positionBuffer.count).toBe(10);
  });
});
```

#### Remediation R4-6: Parser Polyfill Unit Tests (`src/pipeline/parsers/pdfPolyfills.test.ts`)

```typescript
// Proposed src/pipeline/parsers/pdfPolyfills.test.ts
import { describe, it, expect } from 'vitest';
import {
  hasUint8ArrayBase64HexSupport,
  installUint8ArrayBase64HexPolyfill,
} from './pdfUint8ArrayPolyfill';
import {
  hasMapUpsertSupport,
  installMapUpsertPolyfill,
} from './pdfMapUpsertPolyfill';
import { labelForRect } from './pdfLinkLabels';

describe('PDF Polyfills and Link Geometry', () => {
  it('installs Uint8Array hex and base64 polyfills correctly', () => {
    installUint8ArrayBase64HexPolyfill();
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    expect(bytes.toHex()).toBe('48656c6c6f');
    expect(bytes.toBase64()).toBe('SGVsbG8=');
    expect(Uint8Array.fromHex('48656c6c6f')).toEqual(bytes);
    expect(Uint8Array.fromBase64('SGVsbG8=')).toEqual(bytes);
  });

  it('installs Map getOrInsertComputed polyfill', () => {
    installMapUpsertPolyfill();
    const map = new Map<string, number>();
    const factory = vi.fn((k: string) => k.length);
    const val1 = map.getOrInsertComputed('abc', factory);
    expect(val1).toBe(3);
    expect(factory).toHaveBeenCalledTimes(1);
    const val2 = map.getOrInsertComputed('abc', factory);
    expect(val2).toBe(3);
    expect(factory).toHaveBeenCalledTimes(1); // not called again
  });

  it('computes PDF link labels from bounding box spans', () => {
    const spans = [
      { str: 'Click', transform: [1, 0, 0, 1, 10, 20], width: 30 },
      { str: 'Here', transform: [1, 0, 0, 1, 45, 20], width: 30 },
    ];
    const rect = [5, 18, 80, 25];
    const label = labelForRect(spans, rect);
    expect(label).toBe('Click Here');
  });
});
```

#### Remediation R4-10: Dynamic macOS Architecture in `scripts/deploy-app.mjs`

```diff
--- a/scripts/deploy-app.mjs
+++ b/scripts/deploy-app.mjs
@@ -9,7 +9,8 @@
 import { join } from 'node:path';
 import { spawnSync } from 'node:child_process';
 
-const SRC = join(import.meta.dirname, '..', 'release', 'mac-arm64', 'Document Graph Explorer.app');
+const macDir = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
+const SRC = join(import.meta.dirname, '..', 'release', macDir, 'Document Graph Explorer.app');
 const APPS_DIR = '/Applications';
 const DEST = join(APPS_DIR, 'Document Graph Explorer.app');
```
