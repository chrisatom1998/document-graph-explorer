# Code Audit & Refactoring Suggestions

This document presents the comprehensive findings, recommendations, and candidate refactorings identified during the codebase audit of **Document Graph Explorer**.

---

## Executive Summary

The Document Graph Explorer codebase is well-structured, modular, and highly performant. Build, lint, and typecheck tooling run cleanly (`tsc --noEmit` and `eslint .` report zero errors). Out of 118 test files in the workspace, 117 pass cleanly (811 individual tests passing). 

This audit highlights specific code quality improvements across build setup, algorithmic core performance, React 19 / React Three Fiber rendering, component deduplication, DOM safety, and test coverage gaps.

---

## Category 1: Build Setup, Dependencies & Configuration

### 1. Fix macOS APFS Sandbox Hardlink Error in `agent/subagent.test.js`
* **File**: `agent/subagent.test.js` (line 47)
* **Issue**: Running `npm test` fails 1 test file (`agent/subagent.test.js > standalone subagent > blocks hardlink and symlink aliases to sensitive files from read and search`). On macOS APFS file systems, calling `linkSync` on `.git/config` fails with `EPERM: operation not permitted` due to system security policies.
* **Impact**: Blocks `npm test` from passing 100% cleanly in developer environments on macOS.
* **Refactoring**: Wrap `linkSync` in a `try...catch` block. If `EPERM` or `ENOTSUP` is thrown, catch the OS error gracefully while maintaining symlink and path security testing.

### 2. Missing `vite-node` Dependency for Layout Benchmark Script
* **File**: `package.json` (line 25)
* **Issue**: The script `"bench:layout": "vite-node scripts/bench-layout.mjs"` fails with `sh: vite-node: command not found`.
* **Impact**: Developers cannot run layout benchmarks via `npm run bench:layout`.
* **Refactoring**: Add `"vite-node": "^3.0.0"` to `devDependencies` in `package.json`.

### 3. Unused Dependency `unist-util-visit`
* **File**: `package.json` (line 51)
* **Issue**: `unist-util-visit` is declared in `dependencies`, but zero files in `src/`, `scripts/`, or `desktop/` import it (markdown AST processing in `src/ui/markdownAst.tsx` uses custom recursive traversal).
* **Impact**: Unnecessary package bloat.
* **Refactoring**: Remove `unist-util-visit` from `package.json`.

### 4. Vite Build Warning on Import Collision
* **Files**: `src/persistence/session.ts` vs `src/App.tsx` and `src/persistence/corpusActions.ts`
* **Issue**: `src/persistence/session.ts` imports `chatHistorySync` dynamically (`import('./chatHistorySync')`), whereas `App.tsx` and `corpusActions.ts` import it statically. Vite emits a build warning during `npm run build`: `dynamic import will not move module into another chunk`.
* **Impact**: Misleading build warning; dynamic import provides no code-splitting benefit since `chatHistorySync` is already bundled statically.
* **Refactoring**: Change `session.ts` to use a standard static import for `chatHistorySync`.

### 5. TypeScript Strictness Enhancements
* **File**: `tsconfig.json`
* **Issue**: `tsconfig.json` uses `"strict": true`, but omits `"forceConsistentCasingInFileNames"` and `"noImplicitOverride"`.
* **Impact**: Potential cross-platform case sensitivity mismatches or unflagged method override changes.
* **Refactoring**: Add `"forceConsistentCasingInFileNames": true` and `"noImplicitOverride": true` to `tsconfig.json`.

---

## Category 2: Pipeline Core & Algorithmic Performance

### 6. Reuse `TextEncoder` & Optimize Word Tokenization in `chunker.ts`
* **File**: `src/pipeline/chunker.ts` (lines 43-53, 83-100)
* **Issue**: `chunkText` instantiates `new TextEncoder()` inside the function on every chunking operation. Additionally, paragraph word splitting uses `para.trim().split(/\s+/).filter(...)`, allocating thousands of intermediate word string arrays for large documents.
* **Impact**: Creates high GC pressure during large corpus ingestion.
* **Refactoring**: Pull `const encoder = new TextEncoder();` to module scope. Optimize word splitting to scan token boundaries without allocating intermediate word arrays.

### 7. Optimize Top-K Similarity Array Insertions
* **File**: `src/pipeline/similarity.ts` (lines 37-52)
* **Issue**: `boundedInsert` uses `Array.prototype.splice` on every pair meeting similarity threshold criteria, shifting array elements in memory inside inner $O(N^2)$ candidate loops.
* **Impact**: Unnecessary array copying for small bounded lists ($K = 5..10$).
* **Refactoring**: Optimize bounded insertion in `boundedInsert` and `boundedDupInsert` using direct element assignment and array resizing without `splice`.

### 8. Worker Global Scope Type Safety
* **Files**: `src/workers/pipeline.worker.ts` (line 24), `src/workers/aggregator.worker.ts` (line 18)
* **Issue**: Uses `const ctx = self as unknown as DedicatedWorkerGlobalScope;` double-casting to bypass TypeScript scope warnings.
* **Impact**: Degrades worker file type safety.
* **Refactoring**: Declare worker global scope properly using TypeScript worker types (`declare const self: DedicatedWorkerGlobalScope`).

### 9. Isolated Unit Test Coverage for Math & Hash Helpers
* **Files**: `src/pipeline/spawnPosition.ts`, `src/pipeline/hash.ts`
* **Issue**: These standalone pipeline helper modules are tested indirectly via coordinator integration tests, but lack isolated unit test suites.
* **Impact**: Missing isolated unit test safety for coordinate generation and hashing algorithms.
* **Refactoring**: Add `src/pipeline/spawnPosition.test.ts` and `src/pipeline/hash.test.ts`.

---

## Category 3: UI, React 19 / R3F Cleanups & Component Deduplication

### 10. React 19 Empty Fragment Anti-Pattern in R3F Effects
* **File**: `src/scene/Effects.tsx` (line 90)
* **Issue**: `{dofOn ? <FocusedDoF /> : <></>}` returns an empty Fragment `<></>` when depth of field is disabled.
* **Impact**: Forces React 19 to allocate a fragment node tree instead of skipping mounting cleanly.
* **Refactoring**: Replace `<></>` with `null`.

### 11. Custom Three.js Buffer Resource Cleanup
* **File**: `src/scene/Nodes.tsx` (lines 296-311)
* **Issue**: Creates `THREE.InstancedBufferAttribute` dynamically in `useEffect` when `topicNodesEnabled` toggles without explicitly disposing of previous attributes.
* **Impact**: Potential GPU memory leaks during long session use with frequent topic node toggles.
* **Refactoring**: Add explicit `.dispose()` calls in the effect cleanup return function.

### 12. Consolidate Preview Fallback Constants & Slicing Logic
* **Files**: `src/ui/DocumentMarkdown.tsx` (lines 33, 60-64), `src/ui/HtmlPreview.tsx` (lines 52, 157-162)
* **Issue**: Both files duplicate identical `MAX_RENDER_CHARS` (8,000,000) and `FALLBACK_EXCERPT_CHARS` (200,000) constants and string slicing logic.
* **Impact**: Code duplication and potential divergence during reader preview tuning.
* **Refactoring**: Extract shared constants and text truncation logic into a shared helper `src/ui/readerUtils.ts`.

### 13. Create Centralized `CloseButton` UI Component
* **Files**: 9 panel/modal components (`SidePanel.tsx`, `SearchOverlay.tsx`, `ChatPanel.tsx`, `InsightsPanel.tsx`, `PathPanel.tsx`, `SnapshotDrawer.tsx`, `SettingsPanel.tsx`, `HelpPopover.tsx`, `FirstRunGuide.tsx`)
* **Issue**: Duplicate button markup and inconsistent close unicode characters (`×` vs `✕`), with missing `aria-label="Close"` in several places.
* **Impact**: Inconsistent UI presentation and accessibility issues for screen readers.
* **Refactoring**: Create `src/ui/CloseButton.tsx` with unified styling and `aria-label="Close"`, and use it across all 9 UI panels.

### 14. DOM Focus Safety in `useFocusTrap.ts`
* **File**: `src/ui/useFocusTrap.ts` (line 59)
* **Issue**: Calls `previouslyFocused?.focus?.()` without verifying `.isConnected`.
* **Impact**: If the element that opened a modal is unmounted while the modal is open, focus restoration fails silently and focus is lost to `document.body`.
* **Refactoring**: Check `if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();`.

### 15. Global Window Interface Type Safety
* **File**: `src/App.tsx` (line 133)
* **Issue**: Uses `(window as unknown as Record<string, unknown>).__nebula = ...` type assertion.
* **Impact**: Weak TypeScript safety for window debug helpers.
* **Refactoring**: Add proper TypeScript `declare global { interface Window { __nebula?: ... } }` interface declaration.

---

## Category 4: UI Unit Test Coverage Expansion

### 16. Unit Tests for Untested UI Components & Custom Hooks
* **Untested Modules**:
  1. `src/ui/useFocusTrap.ts`
  2. `src/ui/useActiveOptionScroll.ts`
  3. `src/ui/ToastHost.tsx`
  4. `src/ui/PathPanel.tsx`
  5. `src/ui/SnapshotDrawer.tsx`
* **Impact**: Critical modal focus, option scrolling, toast notification, pathfinding UI, and snapshot drawer components lack automated test regression protection.
* **Refactoring**: Add dedicated Vitest + React Testing Library test suites:
  - `src/ui/useFocusTrap.test.ts`
  - `src/ui/useActiveOptionScroll.test.ts`
  - `src/ui/ToastHost.test.tsx`
  - `src/ui/PathPanel.test.tsx`
  - `src/ui/SnapshotDrawer.test.tsx`

---

## Action Plan & Verification Matrix

| Refactoring Item | Impact Area | Priority | Target File(s) | Verification Command |
|---|---|---|---|---|
| **1. Hardlink test fix** | Build / Tests | High | `agent/subagent.test.js` | `npm test` |
| **2. Add `vite-node`** | Build / Scripts | Medium | `package.json` | `npm run bench:layout` |
| **3. Remove unused dep** | Dependencies | Low | `package.json` | `npm run typecheck` |
| **4. Fix import warning** | Vite Build | Medium | `src/persistence/session.ts` | `npm run build` |
| **5. TS Strictness** | Type Safety | Medium | `tsconfig.json` | `npm run typecheck` |
| **6. Chunker optimization** | Core Performance | High | `src/pipeline/chunker.ts` | `npm test` |
| **7. Similarity insert** | Core Performance | High | `src/pipeline/similarity.ts` | `npm test` |
| **8. Worker types** | Type Safety | Medium | `src/workers/*.worker.ts` | `npm run typecheck` |
| **9. Pipeline math tests** | Test Coverage | Medium | `src/pipeline/*.test.ts` | `npm test` |
| **10. R3F Effect null** | UI / R3F | Medium | `src/scene/Effects.tsx` | `npm run build` |
| **11. Buffer disposal** | Memory / R3F | Medium | `src/scene/Nodes.tsx` | `npm run build` |
| **12. Reader utils** | Code Cleanup | Medium | `src/ui/readerUtils.ts` | `npm test` |
| **13. Shared CloseButton** | UI / A11y | Medium | `src/ui/CloseButton.tsx` | `npm run build` |
| **14. Focus trap safety** | UI / DOM Safety | High | `src/ui/useFocusTrap.ts` | `npm test` |
| **15. Window type decl** | Type Safety | Low | `src/App.tsx` | `npm run typecheck` |
| **16. UI Unit Tests** | Test Coverage | High | `src/ui/*.test.ts(x)` | `npm test` |
