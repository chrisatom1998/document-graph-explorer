# Requirement R4 Audit Report: Test Coverage, CI & Release Automation

**Auditor**: Teamwork Explorer (Requirement R4 Specialist)  
**Date**: August 17, 2026  
**Target Repository**: Document Graph Explorer (`document-graph-explorer`)  
**Scope**: Vitest automated tests, Web Worker message contracts, mock coordinators, coverage across all subsystems (pipeline, parsers, 3D scene/R3F, UI, stores, persistence, security, search, chat, collab, OpenUSD tools), TypeScript & ESLint configurations, benchmark infrastructure, packaging/build scripts, Docker runtime, and GitHub Actions CI/Release automation.

---

## 1. Executive Summary & Audit Telemetry

| Dimension | Measured State | Target / Production Benchmark | Status |
|---|---|---|---|
| **Vitest Test Suite** | 179 test files, 1,182 passed, 1 skipped | 100% passing across Node & jsdom | ✅ Operational |
| **Suite Execution Time** | ~11.4s (Node 24 JIT) | < 20s | ✅ High Speed |
| **Coverage Instrumentation** | `@vitest/coverage-v8` **missing**; 0% tracked in CI | Standardized LCOV + threshold gates (>85%) | ❌ Critical Gap |
| **R3F / 3D Scene Components** | 19 `.tsx` components completely untested (0% direct coverage) | WebGL mock / component unit / smoke tests | ❌ High Blind Spot |
| **Parser & Polyfill Units** | 6 critical parser/polyfill files lack unit tests | 100% unit test coverage on all codecs | ⚠️ Medium Gap |
| **TypeScript Strictness** | `strict: true`, but `noUncheckedIndexedAccess: false` | Comprehensive type-safety with index bounds check | ⚠️ Medium Debt |
| **ESLint Rule Strictness** | `@typescript-eslint/no-explicit-any: 'off'`, `ban-ts-comment: 'off'`, `react-hooks/exhaustive-deps: 'warn'` | Explicit any banned, exhaustive-deps error | ⚠️ Medium Debt |
| **OpenUSD CLI Tools** | 2 Python scripts (36.8 KB) with 0 unit tests and 0 CI checks | Pytest suite + ruff/mypy linting in CI | ❌ High Blind Spot |
| **CI Platform Matrix** | Single OS: `ubuntu-latest` only | Matrix: `ubuntu-latest`, `macos-latest`, `windows-latest` | ❌ High Gap |
| **Release Automation** | `release.yml` only ships Windows pkg + Electron portable exe; **macOS & Linux desktop releases omitted** | Full cross-platform release artifacts (DMG/App, Exe, AppImage) | ❌ High Gap |
| **Node Version Alignment** | 3 different major versions: CI (v24), Release (v22), `pkg` exe (v18) | Single pinned Node LTS across CI/Release/Docker | ⚠️ Medium Risk |
| **Benchmark Automation** | 1 script (`bench-layout.mjs`), 0 regression gates in CI | Automated benchmarks with CI threshold alerts | ⚠️ Medium Gap |

---

## 2. Automated Test Suite Audit (Vitest & Subsystems)

### 2.1 Subsystem Test Inventory & Distribution

The codebase contains 179 test files with 1,183 tests. The distribution across architectural modules is summarized below:

```
src/
├── pipeline/          36 test files (links, similarity, parsers, coordinator, chunker, tfidf)
│   └── parsers/       10 test files (code, epub, ipynb, ocr, office, pdf abort/ocr/timeout, rtf)
├── scene/             19 test files (visual math, camera policies, palette, birth, emphasis)
├── ui/                42 test files (panels, modals, buttons, markdownAst, virtualText, search)
├── graph/             8 test files (cluster naming, stats, insights, pathfinding, snapshotDiff)
├── search/            5 test files (retrieval, semantic search, hybrid rank, benchmark)
├── store/             5 test files (graphStore, settingsStore, annotationStore, corpusStore, uiStore dims)
├── persistence/       13 test files (cache, session, corpusRepository, usdExport, validateImport, shareUrl)
├── chat/              11 test files (ragChat providers/ollama/openrouter/airgap, extractive, starters)
├── collab/            6 test files (store, session, privacy, AppBridge, viewFrame)
├── enrich/            8 test files (queue, concurrency, disclosure, airgap, offline, parsing)
├── ingest/            8 test files (folderScanner, folderPicker, folderWatcher, fileRouter, textSniffer)
├── security/          3 test files (csp, hostileInput, verifyAirgapScript)
├── ai/                3 test files (modelCatalog, embeddingPolicy, bundledModel)
├── tools/             2 test files (serveHelpers, electronPackaging)
└── agent/             1 test file  (subagent.test.js - 11 tests)
```

---

### 2.2 Critical Test Coverage Blind Spots

#### Blind Spot A: 3D Scene & React Three Fiber (R3F) Rendering Components (Severity: High)
- **Location**: `src/scene/`
- **Observed Files**:
  - `src/scene/Nodes.tsx` (31.2 KB) — Instanced mesh rendering of 4,096 nodes, hover hit testing, picking, dynamic attribute buffers.
  - `src/scene/Edges.tsx` (26.5 KB) — Batched LineSegments2, quadratic bezier edge bundling, alpha blending.
  - `src/scene/CameraRig.tsx` (16.4 KB) — Spherical / planar camera animations, framing math, damping, focus transitions.
  - `src/scene/ClusterCollapse.tsx` (15.7 KB) — Cluster hull animations, centroid collapsing, bounding sphere calculations.
  - `src/scene/Labels.tsx` (13.7 KB) — Billboard text rendering, occlusion culling, level-of-detail sizing.
  - `src/scene/PathRouteOverlay.tsx` (12.9 KB) — Shortest path route glow tube, pulse particles.
  - `src/scene/ClusterBridges.tsx` (12.4 KB) — Cross-cluster inter-community bridge tubes.
  - `src/scene/Starfield.tsx` (8.7 KB), `AiCore.tsx` (7.9 KB), `NebulaCanvas.tsx` (7.8 KB), `EdgePulses.tsx` (7.1 KB), `AutoQuality.tsx` (6.4 KB), `ClusterAtmosphere.tsx` (6.2 KB), `NebulaClouds.tsx` (5.6 KB), `Effects.tsx` (5.3 KB), `FlatClusterLabels.tsx` (4.3 KB), `SelectionHalo.tsx` (3.4 KB), `PeerPresence.tsx` (2.9 KB), `FocusLight.tsx` (2.5 KB).
- **Analysis**:
  - All 19 R3F components have **0% unit test coverage**.
  - Current tests in `src/scene/` cover only pure math helpers (`emphasis.test.ts`, `palette.test.ts`, `cameraFocusPolicy.test.ts`, `ingestBirth.test.ts`).
  - Untested pure scene helpers: `src/scene/edgeCurve.ts` (4.1 KB), `src/scene/ingestGesture.ts` (4.0 KB), `src/scene/proceduralTextures.ts` (6.5 KB), `src/scene/positionBuffer.ts` (2.1 KB), `src/scene/cameraPose.ts` (0.5 KB), `src/scene/sceneCapture.ts` (1.0 KB).
  - **Risk**: Shader compile errors, broken uniforms, instanced buffer overflow (>4096 nodes), React 19 / R3F 9 context reconciliation errors, or camera crash regressions are completely invisible until manual testing.

#### Blind Spot B: Layout Worker & Layout Bridge Subsystem (Severity: High)
- **Location**: `src/layout/layoutBridge.ts` (14.3 KB, lines 1–375), `src/workers/layout.worker.ts` (14.7 KB, lines 1–453).
- **Analysis**:
  - `layoutBridge.ts` is the central coordinator between the main UI thread and the d3-force-3d simulation worker. It manages slot allocation (`nextSlot`, `freeSlots` recycling), transferable Float32Array buffer pooling, crash detection (`CRASH_WINDOW_MS = 10_000`), automatic worker restart/re-seeding (`reseed`), and dimension switching (2D vs 3D).
  - `layoutBridge.ts` has **no unit test file** (`layoutBridge.test.ts` does not exist).
  - `layout.worker.ts` has **no Vitest test file** (it is only driven in `scripts/bench-layout.mjs`).
  - **Risk**: Slot recycling bugs (slot collision, ghost nodes, buffer index out-of-bounds), worker crash recovery infinite loops, or position buffer tear conditions during rapid folder reloads are unverified.

#### Blind Spot C: Parser Codecs & Polyfill Invariants (Severity: Medium)
- **Location**: `src/pipeline/parsers/`
- **Observed Untested Files**:
  1. `src/pipeline/parsers/pdfUint8ArrayPolyfill.ts` (5.2 KB, lines 1–133):
     - Contains both runtime polyfill functions (`installUint8ArrayBase64HexPolyfill`) and string-serialized source (`INSTALL_UINT8ARRAY_POLYFILL_SOURCE`) for pdf.js worker injection.
     - **Untested**: Hex/base64 encode/decode equivalence, empty buffers, odd hex lengths, padding edge cases, and runtime feature detection (`hasUint8ArrayBase64HexSupport`).
  2. `src/pipeline/parsers/pdfMapUpsertPolyfill.ts` (2.2 KB, lines 1–51):
     - Polyfills `Map.prototype.getOrInsertComputed` and `Map.prototype.getOrInsert` for pdf.js canvas preview.
     - **Untested**: Callback invocation semantics, missing key insertion, existing key avoidance.
  3. `src/pipeline/parsers/pdfLinkLabels.ts` (2.3 KB, lines 1–60):
     - Performs 2D geometry collision detection between PDF annotation rectangles and stream text spans.
     - **Untested**: Annotation coordinate inversion, baseline tolerance bounds (`V_TOLERANCE`), label truncation (`MAX_LABEL_CHARS = 140`).
  4. `src/pipeline/parsers/txt.ts` (1.3 KB), `src/pipeline/parsers/html.ts` (7.5 KB), `src/pipeline/parsers/markdown.ts` (6.0 KB):
     - Only tested indirectly through pipeline integration tests, missing dedicated unit test coverage for edge cases (e.g. malformed HTML entities, unclosed tags, deeply nested blockquotes, non-UTF8 encodings).

#### Blind Spot D: Core UI Panels & State Stores (Severity: Medium)
- **Location**: `src/ui/`, `src/store/`
- **Observed Untested Files**:
  - `src/App.tsx` (18.0 KB) — Root application shell, keyboard shortcut orchestration, drag-and-drop listener, panel layout.
  - `src/ui/SettingsPanel.tsx` (32.1 KB) — The largest UI component in the codebase (LLM API keys, model parameters, airgap toggles, color palettes, layout sliders). Only a 1.1 KB clear test exists (`SettingsPanel.clear.test.ts`).
  - `src/ui/CorpusSwitcher.tsx` (14.3 KB) — Multi-corpus creation, switching, deletion, snapshot export.
  - `src/ui/Minimap.tsx` (14.8 KB) — Interactive 2D viewport radar, pan/zoom projection.
  - `src/ui/PdfPreview.tsx` (6.8 KB), `JsonPreview.tsx` (2.9 KB), `YamlPreview.tsx` (2.6 KB), `DocAiSection.tsx` (6.4 KB), `EmptyState.tsx` (7.4 KB), `HeroConstellation.tsx` (16.6 KB).
  - `src/store/chatStore.ts` (2.8 KB), `folderWatchStore.ts` (0.6 KB), `runtimeStores.ts` (2.1 KB), `uiStore.ts` (10.0 KB - only `uiStore.dims.test.ts` exists).
  - `src/persistence/db.ts` (10.0 KB) — IndexedDB schema versioning, store creation, upgrade migrations.

#### Blind Spot E: OpenUSD Python CLI Tools (Severity: High)
- **Location**: `tools/usd_pipeline/`
- **Observed Files**:
  - `tools/usd_pipeline/usd_agent.py` (28.2 KB, lines 1–708) — Autonomous LLM agent for OpenUSD stage analysis and queries.
  - `tools/usd_pipeline/usd_pipeline.py` (8.7 KB, lines 1–222) — CLI validation (`report`) and packaging (`usdz`) tool using `usd-core`.
  - `tools/usd_pipeline/requirements.txt` (`usd-core>=24.5`).
- **Analysis**:
  - **Zero automated tests**: No `pytest` test suite exists.
  - **Zero CI execution**: Not tested, linted, or executed anywhere in `.github/workflows/ci.yml`.
  - **Zero type/lint checks**: No `ruff`, `mypy`, or `black` configuration in the repository.
  - **Risk**: OpenUSD stage export format changes in `src/persistence/usdExport.ts` will silently break `usd_pipeline.py` and `usd_agent.py` without CI detection.

---

### 2.3 Worker Mock Coordinator vs End-to-End Worker Integration

- **Observation**:
  In `src/pipeline/coordinator.ingest.test.ts` (lines 30–100):
  - `layoutBridge` is mocked (`vi.mock('../layout/layoutBridge')`).
  - `WorkerPool` is mocked (`vi.mock('../workers/pool')`).
  - `cache`, `sessionSave`, `originals`, `corpusRepository`, `quota`, `parsePdf` are all mocked.
- **Analysis**:
  - Mock coordinator tests verify orchestration flow, status emissions, cancellation, and error handling effectively in Node.
  - However, the real communication pipeline between `WorkerPool` -> `pipeline.worker.ts` -> `aggregator.worker.ts` -> `layout.worker.ts` is never exercised in an integration test.
  - When running in production Vite builds, workers use ES module worker syntax (`format: 'es'`, dynamic imports). A bundler misconfiguration or missing worker asset can pass Vitest completely while crashing in the browser.

---

## 3. Linting & Typechecking Configuration Audit

### 3.1 TypeScript Configuration (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitOverride": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

#### TypeScript Findings & Recommendations:
1. **Missing `noUncheckedIndexedAccess: true` (Severity: Medium)**:
   - In a codebase heavily manipulating typed arrays (`Float32Array`, `Uint8Array`), graph adjacency lists, and cluster lookup maps (`Record<string, number>`), indexing `array[i]` or `map[key]` is typed as `T` instead of `T | undefined`.
   - Adding `noUncheckedIndexedAccess: true` prevents out-of-bounds runtime crashes in buffer math and graph queries.
2. **Missing `exactOptionalPropertyTypes: true` (Severity: Low)**:
   - Allows `{ foo: undefined }` to be passed where `{ foo?: string }` is expected, causing subtle bugs in message serialization across worker boundaries (`postMessage`).
3. **Missing Tooling Project Coverage (Severity: Low)**:
   - `scripts/` (`.mjs`, `.cjs`) and `agent/` (`.mjs`) are not included in `tsconfig.json` `include` list.

---

### 3.2 ESLint Configuration (`eslint.config.js`)

```javascript
// eslint.config.js (lines 55–66)
rules: {
  'react-hooks/rules-of-hooks': 'error',
  'react-hooks/exhaustive-deps': 'warn',
  '@typescript-eslint/no-unused-vars': 'off',
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/ban-ts-comment': 'off',
  '@typescript-eslint/no-floating-promises': 'error',
}
```

#### ESLint Findings & Recommendations:
1. **`@typescript-eslint/no-explicit-any: 'off'` (Severity: Medium)**:
   - Turning off `no-explicit-any` repo-wide allows uncontrolled `any` proliferation across stores, components, and workers, eroding TypeScript guarantees.
   - **Recommendation**: Set to `'warn'` or `'error'` with targeted inline disables only for justified WebGL/Three.js shader uniform bindings.
2. **`@typescript-eslint/ban-ts-comment: 'off'` (Severity: Medium)**:
   - Unrestricted `@ts-ignore` / `@ts-expect-error` comments can mask real type breakage during dependency upgrades.
   - **Recommendation**: Configure with `'allow-with-description'` so every escape hatch requires an audited explanation comment.
3. **`react-hooks/exhaustive-deps: 'warn'` (Severity: Medium)**:
   - Warnings do not fail CI. Stale closure bugs in Three.js `useFrame`, animation frame callbacks, and event listeners can slip into production.
   - **Recommendation**: Upgrade to `'error'` in CI or audit existing warnings to reach 0 warnings.
4. **No Typed Linting for Unsafe Operations (Severity: Low)**:
   - `projectService` is enabled solely for `no-floating-promises`. Adding `no-unsafe-argument` and `no-unsafe-assignment` on critical directories (`src/security/`, `src/persistence/`) would strengthen trust boundaries.
5. **No Python Linter (Severity: Medium)**:
   - `tools/usd_pipeline/*.py` has no linter configured in the repository. Adding `ruff check tools/` ensures OpenUSD pipeline quality.

---

## 4. CI Workflows & Release Automation Audit

### 4.1 CI Workflow (`.github/workflows/ci.yml`)

```yaml
# .github/workflows/ci.yml (lines 12–61)
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Lint
        run: npm run lint
      - name: Type-check
        run: npm run typecheck
      - name: Test
        run: npm test
      - name: Build (production)
        run: npm run build
      - name: Build (air-gapped) + verify zero external hosts
        run: npm run build:airgap
      - name: Enforce eager bundle budget
        run: npm run check:bundle
      - name: Build (Windows .exe) + verify icon embedded
        run: ...
```

#### CI Findings & Vulnerabilities:
1. **Single OS Runner (`ubuntu-latest`) — No Cross-Platform Verification (Severity: High)**:
   - The repository produces macOS `.app`/`.dmg` bundles, Windows portable `.exe`, and Linux `AppImage`.
   - `build:desktop` and `dist:mac` (`electron-builder --mac`) are **never tested in CI** because electron-builder requires macOS to produce Darwin binaries and run `scripts/deploy-app.mjs`.
   - Platform-specific code in `src/ingest/desktopFolderWatch.ts`, `src/tools/serveHelpers.test.ts` (`it.runIf(process.platform === 'win32')`), and `scripts/install-desktop-shortcut.ps1` are never executed in CI on native hosts.
2. **Missing Test Coverage Step & Reporting (Severity: High)**:
   - CI runs `npm test` without generating code coverage reports, tracking test coverage trends, or blocking PRs on coverage regression.
3. **Missing E2E / Browser Smoke Tests in CI (Severity: Medium)**:
   - The app has a `.playwright-mcp` directory and artifacts for visual inspection, but CI does not run any headless Chromium/Playwright smoke tests to verify real WebGL context initialization, worker spawn, and demo corpus ingestion in a browser.
4. **Missing Python USD Pipeline Gate (Severity: Medium)**:
   - CI does not test or validate `tools/usd_pipeline/usd_pipeline.py` or run `usdExport.ts` output against OpenUSD schema validation in CI.

---

### 4.2 Release Automation (`.github/workflows/release.yml`)

```yaml
# .github/workflows/release.yml (lines 11–84)
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 22   # Discrepancy with ci.yml (node 24)
      - name: Build standard app
        run: npm run build
      - name: Build air-gapped app
        run: npm run build:airgap
      - name: Build portable Windows runtime (pkg)
        run: npm run build:exe
      - name: Build Electron Windows portable
        run: npx electron-builder --win portable
      - name: Package artifacts
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          zip -r dist.zip dist
          zip -r dist-airgap.zip dist-airgap
          zip -r "Document-Graph-Explorer-${VERSION}-win-pkg.zip" release/win
          ...
      - name: Publish GitHub Release
        run: ...
```

#### Release Automation Findings:
1. **Critical Omission: No macOS or Linux Desktop Artifacts in Release (Severity: High)**:
   - `release.yml` runs only on `ubuntu-latest` and only packages:
     - `dist.zip` (static web)
     - `dist-airgap.zip` (airgapped web)
     - `Document-Graph-Explorer-${VERSION}-win-pkg.zip` (Windows pkg exe + dist)
     - `Document-Graph-Explorer-${GITHUB_REF_NAME}-windows-x64-portable.zip` (Electron portable Windows exe)
     - `Document.Graph.Explorer-${VERSION}.exe`
   - **macOS DMG/ZIP (`dist:mac`) and Linux AppImage (`dist:linux`) are completely omitted from the automated GitHub release!** Mac and Linux desktop users get no downloadable binaries on release tag publication.
2. **Node Version Drift Across Environments (Severity: Medium)**:
   - `ci.yml` uses `node-version: 24`
   - `release.yml` uses `node-version: 22`
   - `Dockerfile` uses `node:24-alpine`
   - `package.json` `build:exe` targets `node18-win-x64` via `pkg`
   - This triple-version mismatch creates potential runtime discrepancy risks between development, CI testing, and production binary packaging.
3. **Missing Release Checksums & Provenance (Severity: Medium)**:
   - Releases do not generate or publish `SHA256SUMS` or attestations for released binaries.
4. **Missing Draft Release / Approval Gate (Severity: Low)**:
   - Tag pushes immediately publish public releases without a staging/draft verification step.

---

## 5. Benchmark Infrastructure Audit

### 5.1 Existing Benchmark Assets

| Benchmark | Implementation | Location | Execution Mode | CI Gated? |
|---|---|---|---|---|
| **Layout Convergence** | `scripts/bench-layout.mjs` | Runs headless `layout.worker.ts` with mock worker global | `npm run bench:layout` | ❌ No |
| **Search Retrieval Quality** | `src/search/retrievalBenchmark.test.ts` & `docs/retrieval-benchmark-2026-07-11.json` | 50 query test cases against synthetic corpus | Ran in Vitest (`retrievalBenchmark.test.ts`) | ✅ Yes (test only) |
| **Ingest Pipeline (End-to-End)** | Documented in `docs/benchmarks.md` (§1) | Table: 100 PDFs → 202 nodes in 9.2s | Manual in-browser | ❌ No script |
| **Render Frame Rate (FPS)** | Documented in `docs/benchmarks.md` (§3) | Table: 202 to 2,000 nodes at 120 FPS | Manual in-browser | ❌ No script |
| **OpenUSD Export Speed** | Documented in `docs/benchmarks.md` (§4) | Table: 202 nodes in 2.8ms | Manual in-browser | ❌ No script |

---

### 5.2 Benchmark Findings & Vulnerabilities:
1. **Layout Benchmark Has No Automated Regression Assertion (Severity: Medium)**:
   - `scripts/bench-layout.mjs` runs 3 iterations across 100, 250, 500, 1000, 2000 nodes and prints timing tables, but does not assert upper bounds or fail exit codes if convergence regresses.
2. **Missing Scripted Ingestion Benchmark (Severity: Medium)**:
   - `docs/benchmarks.md` cites a 9.2s ingest time for 100 PDFs, but there is no automated headless or CLI script to reproduce this benchmark systematically.
3. **No Benchmark Tracking in CI (Severity: Low)**:
   - Benchmarks are not tracked over git commits to catch algorithmic performance regressions.

---

## 6. Packaging, Desktop Builds & Airgap Security Audit

### 6.1 Packaging Verification Scripts Review

The project has robust security verification scripts in `scripts/`:

```
scripts/
├── sanitize-airgap.mjs         # Neutralizes remote vendor hosts in built JS to disabled.invalid
├── verify-airgap.mjs           # Asserts CSP in dist-airgap/index.html allows 0 external domains
├── verify-runtime-assets.mjs   # Checks WASM magic bytes, ONNX model existence, Tesseract OCR assets, fonts
├── check-bundle.mjs            # Enforces strict entry budget (80 KB) and eager JS budget (280 KB)
├── harden-fuses.cjs            # electron-builder afterPack: flips RunAsNode, inspect flags off
├── serve-exe.cjs               # pkg Windows launcher with security headers and local static server
└── staticServer.cjs            # Safe path normalization, traversal attack defense (resolveSafe)
```

### 6.2 Packaging Findings & Edge Cases:

1. **Fixed Desktop Server Port Collision Hazard (Severity: High)**:
   - In `desktop/main.cjs` (line 13): `const LOCAL_SERVER_PORT = 47182;`
   - In `desktop/main.cjs` (line 112): `server.once('error', reject);`
   - If port 47182 is occupied by a dead zombie process or conflicting service, the desktop app will throw an uncaught rejection and fail to open.
   - While the port is fixed to preserve origin-partitioned IndexedDB persistence, the app needs a clear recovery prompt or fallback detection rather than a hard crash.
2. **Hardcoded Architecture in macOS Deploy Script (`scripts/deploy-app.mjs`) (Severity: Medium)**:
   - Line 12: `const SRC = join(import.meta.dirname, '..', 'release', 'mac-arm64', 'Document Graph Explorer.app');`
   - Hardcoding `mac-arm64` causes `npm run build:desktop` to fail on Intel Macs (`mac-x64`) or universal builds (`mac-universal`).
   - Line 31: `spawnSync('ditto', [SRC, DEST])` to `/Applications` fails if the user does not have write permissions to system `/Applications`.
3. **Electron Code Signing & Notarization Missing (Severity: Medium)**:
   - In `package.json` (lines 95–119): Electron builder config does not configure macOS hardened runtime, entitlements (`entitlements.mac.plist`), or Apple Developer notarization. On macOS Sequoia / modern macOS, untrusted Gatekeeper blocks will prevent end-users from opening the downloaded DMG without right-click overrides.
4. **Rebuild Script Documentation Mismatch (Severity: Low)**:
   - `rebuild.sh` line 2 claims to deploy to `~/Applications`, but `scripts/deploy-app.mjs` line 13 targets `/Applications`.

---

## 7. Prioritized Remediation Matrix

| ID | Finding / Area | Severity | Effort | Expected Quality / Reliability Gain | Concrete File & Line References |
|---|---|---|---|---|---|
| **R4-1** | Add `@vitest/coverage-v8` & enforce CI coverage thresholds | **Critical** | **S** | Prevents untested code merges; provides automated LCOV reports & coverage regression gating in CI. | `package.json`: devDependencies; `vite.config.ts`: test.coverage; `.github/workflows/ci.yml` |
| **R4-2** | Add Matrix CI for macOS & Windows + Release macOS/Linux builds | **High** | **M** | Restores automated release builds for Mac & Linux users; validates cross-platform file watch & packaging in CI. | `.github/workflows/ci.yml`: lines 12–15; `.github/workflows/release.yml`: lines 11–85 |
| **R4-3** | Add unit test suite for Layout Bridge (`layoutBridge.test.ts`) | **High** | **M** | Guarantees slot allocation, node recycling, buffer transfer, and worker crash recovery resilience. | `src/layout/layoutBridge.ts`: lines 34–100; create `src/layout/layoutBridge.test.ts` |
| **R4-4** | Add unit tests for Parser Polyfills & Link Label geometry | **Medium** | **S** | Eliminates silent PDF import crashes on Electron and broken PDF annotation links. | `src/pipeline/parsers/pdfUint8ArrayPolyfill.ts`, `pdfMapUpsertPolyfill.ts`, `pdfLinkLabels.ts` |
| **R4-5** | Add testing & linting for OpenUSD Python pipeline (`usd_pipeline`) | **High** | **M** | Prevents silent bitrot and format desync between TypeScript USD export and Python USD CLI tools. | `tools/usd_pipeline/usd_pipeline.py`, `usd_agent.py`; create `tools/usd_pipeline/test_usd_pipeline.py` |
| **R4-6** | Add R3F WebGL Mock / Component Unit Smoke Tests for Scene | **High** | **L** | Validates scene components (`Nodes.tsx`, `Edges.tsx`, `CameraRig.tsx`) mount and update without runtime exceptions. | `src/scene/*.tsx` (19 components); create `src/scene/sceneSmoke.test.tsx` |
| **R4-7** | Enable `noUncheckedIndexedAccess: true` in `tsconfig.json` | **Medium** | **M** | Eliminates out-of-bounds array/buffer indexing crashes across all math and graph modules. | `tsconfig.json`: line 13 |
| **R4-8** | Tighten ESLint rules (`no-explicit-any`, `exhaustive-deps: 'error'`) | **Medium** | **M** | Eliminates stale closure bugs in React hooks and stops unchecked `any` leakage across codebase. | `eslint.config.js`: lines 56–66 |
| **R4-9** | Harmonize Node.js major versions across CI, Release, and Packaging | **Medium** | **S** | Eliminates environment drift between CI (v24), Release (v22), and Packaging (v18). | `.github/workflows/ci.yml`: line 21; `.github/workflows/release.yml`: line 20; `Dockerfile`: line 4 |
| **R4-10** | Add automated layout convergence assertions to benchmark script | **Low** | **S** | Converts layout benchmark into an automated performance regression gate with threshold checks. | `scripts/bench-layout.mjs`: lines 98–115; `package.json`: line 25 |
| **R4-11** | Fix macOS architecture detection & port collision in desktop app | **Medium** | **S** | Allows building desktop app on Intel/Universal Macs and gracefully recovers from occupied server port. | `scripts/deploy-app.mjs`: line 12; `desktop/main.cjs`: lines 13, 112 |

---

## 8. Phased Remediation Execution Roadmap

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: Quick Wins & Safety Gates (Days 1–3)                                                   │
│ • Install @vitest/coverage-v8 and configure coverage threshold in vitest.config.ts & CI        │
│ • Harmonize Node.js versions (standardize on Node 22 or 24 LTS across CI/Release/Docker)       │
│ • Add unit tests for pdfUint8ArrayPolyfill.ts, pdfMapUpsertPolyfill.ts, pdfLinkLabels.ts       │
│ • Fix architecture hardcoding in scripts/deploy-app.mjs                                         │
└────────────────────────────────┬────────────────────────────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────────────────────────────┐
│ PHASE 2: Core Subsystem Coverage & Multi-Platform CI (Days 4–7)                                  │
│ • Add layoutBridge.test.ts covering slot allocation, recycling, and crash recovery              │
│ • Add worker message routing tests for layout.worker.ts and pipeline.worker.ts                 │
│ • Expand .github/workflows/ci.yml with macOS & Windows test matrix                              │
│ • Add pytest and ruff/mypy checks in CI for tools/usd_pipeline/                                 │
│ • Expand .github/workflows/release.yml to build and publish macOS (.dmg/.zip) & Linux AppImage   │
└────────────────────────────────┬────────────────────────────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────────────────────────────┐
│ PHASE 3: Scene Testing, Type Tightening & Benchmark Gates (Days 8–12)                           │
│ • Implement R3F component smoke test suite using mock WebGL context / Three.js test helpers    │
│ • Enable noUncheckedIndexedAccess: true in tsconfig.json and resolve index typing debts        │
│ • Upgrade react-hooks/exhaustive-deps to error in eslint.config.js                             │
│ • Add automated budget threshold assertions to scripts/bench-layout.mjs                         │
│ • Add Playwright headless browser smoke test in CI for 3D canvas and demo ingestion            │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```
