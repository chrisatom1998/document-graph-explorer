# Baseline Verification Report (Document Graph Explorer)

## 1. Observation

All baseline commands were executed in the project root directory `/Users/chrisjohnson/Projects/document-graph-explorer`.

### 1.1 Lint: `npm run lint`
- **Command executed**: `npm run lint` (`eslint .`)
- **Exit code**: `0`
- **Verbatim Output**:
```
> document-graph-explorer@1.1.14 lint
> eslint .
```
- **Diagnostics**: 0 errors, 0 warnings.

### 1.2 Typecheck: `npm run typecheck`
- **Command executed**: `npm run typecheck` (`tsc --noEmit`)
- **Exit code**: `0`
- **Verbatim Output**:
```
> document-graph-explorer@1.1.14 typecheck
> tsc --noEmit
```
- **Diagnostics**: 0 TypeScript errors.

### 1.3 Test Suite: `npm test`
- **Command executed**: `npm test` (`vitest run`)
- **Exit code**: `0`
- **Summary Metrics**:
  - Test Files: 179 passed (179 total)
  - Tests: 1,184 passed, 1 skipped (1,185 total)
  - Wall-clock Duration: 15.35s (transform 11.47s, setup 40.25s, import 32.22s, tests 33.38s, environment 73.86s)
  - Skipped Test: 1 test skipped in `src/tools/serveHelpers.test.ts` (30 passed | 1 skipped)
- **Stderr logs observed during execution**:
  - `src/pipeline/coordinator.ingest.test.ts` > "coordinator ingest > chips an embed-batch failure and still leaves the corpus ready" logged intentional error messages:
    - `embedding failed for one: embed batch failed`
    - `embedding failed for two: embed batch failed`
  - These log entries are expected behavior from negative failure recovery tests.

### 1.4 Production Build: `npm run build`
- **Command executed**: `npm run build` (`tsc --noEmit && vite build && node scripts/verify-runtime-assets.mjs dist && node scripts/check-bundle.mjs dist`)
- **Exit code**: `0`
- **Transform & Build Duration**: 1312 modules transformed, built in 17.87s
- **Post-Build Verification Steps**:
  1. `node scripts/verify-runtime-assets.mjs dist`:
     - Result: `Verified 1 WebAssembly runtime asset(s), bundled embedding model, same-origin OCR runtime, and pdf.js standard fonts in dist.`
  2. `node scripts/check-bundle.mjs dist`:
     - Result: `Bundle budget OK for /Users/chrisjohnson/Projects/document-graph-explorer/dist: entry 79.5 kB, eager JavaScript 79.5 kB.`
- **Key Generated Dist Assets**:
  - **WASM Asset**:
    - `dist/assets/ort-wasm-simd-threaded.asyncify-DMmc6YqF.wasm` (23,567.05 kB raw, 5,746.64 kB gzip)
  - **Worker Bundles**:
    - `dist/assets/pdf.worker.min-CHFwMXne.mjs` (1,262.40 kB)
    - `dist/assets/transformers.web-BrACkQIF.js` (549.01 kB)
    - `dist/assets/pipeline.worker-BLnZGEDV.js` (199.66 kB)
    - `dist/assets/aggregator.worker-CppVqbJx.js` (107.46 kB)
    - `dist/assets/layout.worker-Dy-7s7WR.js` (31.24 kB)
    - `dist/assets/insights.worker-V54zQ7Xl.js` (3.00 kB)
  - **Top JS Application & Vendor Chunks**:
    - `dist/assets/LineSegments2-DGcE74Ji.js` (538.53 kB raw, 145.93 kB gzip)
    - `dist/assets/coordinatorLazy-C-zT2tqf.js` (474.13 kB raw, 143.36 kB gzip)
    - `dist/assets/palette-Bs2oD1_1.js` (381.07 kB raw, 103.08 kB gzip)
    - `dist/assets/NebulaCanvas-DFyH7ez0.js` (366.05 kB raw, 119.49 kB gzip)
    - `dist/assets/session-rOe3uduM.js` (194.49 kB raw, 59.07 kB gzip)
    - `dist/assets/vendor-react-C2DflzvA.js` (192.49 kB raw, 60.31 kB gzip)
    - `dist/assets/markdownAst-sJaAOrVl.js` (129.51 kB raw, 38.30 kB gzip)
    - `dist/assets/index-DHw78rZj.js` (79.49 kB raw, 25.21 kB gzip) [Entry point]
  - **Styles & Fonts**:
    - `dist/assets/index-CSvKlTBf.css` (483.86 kB raw, 52.84 kB gzip)
    - `dist/assets/space-grotesk-latin-BhU9QXUp.woff2` (22.29 kB)
    - `dist/assets/space-grotesk-latin-ext-D9tNdqV9.woff2` (18.94 kB)

---

## 2. Logic Chain

1. **Step 1 (Linting)**: Executing `npm run lint` runs ESLint across the codebase. Since it returned exit code 0 without any error or warning lines, the codebase adheres strictly to the configured ESLint rules.
2. **Step 2 (Typechecking)**: Executing `npm run typecheck` runs `tsc --noEmit`. Since it returned exit code 0 without output, all TypeScript definitions, interfaces, and module typings across `src/` and test files are type-safe and consistent.
3. **Step 3 (Unit & Integration Tests)**: Executing `npm test` runs Vitest over the entire suite. 179 test files with 1,184 assertions passed without failure. The single skipped test in `src/tools/serveHelpers.test.ts` is explicitly gated or conditional, and does not indicate a regression.
4. **Step 4 (Production Bundle & Asset Validation)**: Executing `npm run build` executes typechecking, Vite bundling, runtime asset validation (`verify-runtime-assets.mjs`), and bundle size budget checks (`check-bundle.mjs`). All build steps succeeded with exit code 0. Runtime assets (ONNX WASM, embedding model, OCR runtime, PDF.js fonts) and the entrypoint budget (79.5 kB vs limit) are valid.

---

## 3. Caveats

- **Skipped Test**: 1 test is skipped in `src/tools/serveHelpers.test.ts`. This was verified as intentional in the test definition and not a test failure.
- **Environment**: Baseline was run on macOS (`Darwin`) in Node v22.x/v20.x environment. Desktop packaging scripts (`build:desktop`, `dist:mac`, `build:exe`) were not run as part of the core web baseline verification suite per `AGENTS.md` instructions.
- **End-to-End Visual Testing**: Vitest runs unit and integration tests with mocked/jsdom environments; full WebGL/Canvas rendering is not executed in headless Node Vitest.

---

## 4. Conclusion

The current codebase is in a **100% clean baseline state**:
- **Lint**: PASSED (0 errors, 0 warnings)
- **Typecheck**: PASSED (0 type errors)
- **Tests**: PASSED (179/179 files passed, 1,184 passed, 1 skipped, 0 failed)
- **Build**: PASSED (1312 modules, clean bundle budget at 79.5 kB, all runtime assets verified)

No regressions or baseline blockers exist.

---

## 5. Verification Method

To independently reproduce and verify this baseline report, run the following commands in `/Users/chrisjohnson/Projects/document-graph-explorer`:

```bash
# 1. Verify Linting
npm run lint

# 2. Verify TypeScript Types
npm run typecheck

# 3. Verify Vitest Test Suite
npm test

# 4. Verify Production Build & Asset Integrity
npm run build
```

**Invalidation conditions**:
- Any non-zero exit code from the four commands above.
- Any ESLint error or warning reported.
- Any TypeScript diagnostic reported by `tsc --noEmit`.
- Any test failure in Vitest (`> 0 failed`).
- Failure of `scripts/verify-runtime-assets.mjs` or `scripts/check-bundle.mjs` during build.
