# Master Technical Audit Report: Document Graph Explorer (Knowledge Nebula)

**Target Repository**: Document Graph Explorer (`document-graph-explorer`)  
**Auditor**: Project Technical Audit Orchestration Team  
**Date**: August 21, 2026  
**Repository Architecture**: Single client-side web application (React 19, Vite, React Three Fiber, Web Workers, IndexedDB, ONNX WASM/WebGPU `bge-small-en-v1.5`)  
**Audit Scope**: Pillars R1 (Architecture & State), R2 (Ingestion & Workers), R3 (3D Scene & UI/UX), R4 (Testing, CI/CD & Airgap Security), and Baseline Verification.

---

## 1. Executive Summary & Health Scorecard

Document Graph Explorer is a high-performance, fully client-side knowledge graph web application capable of parsing, embedding, clustering, and visualizing multidimensional document corpora entirely in the browser without any backend server.

The codebase exhibits exceptional architectural strengths in **airgap isolation**, **zero-copy worker marshalling**, **defensive memory boundaries**, and **strict type safety**. All four baseline quality checks (`npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`) pass cleanly with **zero errors, zero warnings, 1,184 passing unit/integration tests across 179 files, and 100% compliant bundle budgeting**.

However, deep line-level inspection revealed specific vulnerabilities, edge-case race conditions, and test coverage blind spots that must be addressed:
1. **Critical Cross-Tab Overwrite**: `saveActiveCorpusPositions` in `src/persistence/corpusRepository.ts` overwrites newer corpus content with stale graph state from background tabs.
2. **Missing Coverage Instrumentation**: `@vitest/coverage-v8` is not installed or configured, leaving 19 React Three Fiber scene components and `layoutBridge.ts` with 0% verified coverage.
3. **Ingest Cancellation Ghost Nodes**: Aborting an in-flight ingest leaves unclustered (`cluster: -1`), unlinked nodes in `graphStore` that get saved to disk.
4. **GPU Resource Leaks & WebGL Context Loss**: `SelectionHalo.tsx` leaks `PlaneGeometry` instances on selection cycles, and `<NebulaCanvas>` lacks `webglcontextlost` handlers and dialog focus traps.
5. **Release Automation Gaps**: GitHub Actions `release.yml` only packages Windows binaries, completely omitting macOS `.dmg` and Linux `.AppImage` desktop bundles.

### Subsystem Health Scorecard

| Subsystem / Dimension | Health Grade | Status | Key Architectural Findings & Evaluation |
|---|---|---|---|
| **Architecture & State Management (R1)** | **B+** | Action Required | Clean store partitioning and raw heap cache (`runtimeStores.ts`), but multi-tab background saves can clobber active corpora, and `runQueue.ts` lacks watchdog timeout protection. |
| **Ingestion Pipeline & Workers (R2)** | **A+** | Exceptional | Outstanding parser security (zip-bomb limits, DOM-free AST walkers), pinned embedding worker with WebGPU/WASM fallback, zero-copy `Transferable` buffers, and hybrid RRF search. |
| **3D Scene Graph & Rendering (R3)** | **A-** | Action Required | Efficient instanced meshes (`Nodes.tsx`), but per-frame buffer re-allocation in `PathRouteOverlay.tsx`, geometry leak in `SelectionHalo.tsx`, and WCAG 2.1 AA focus trap gaps in dialogs. |
| **Test Coverage, CI & Airgap (R4)** | **B** | Action Required | 100% verified airgap security (zero external network leaks), 1,184 passing Vitest tests, but 0% coverage on 19 R3F components, missing coverage provider, and single-OS CI. |
| **Baseline Quality Checks** | **100% Clean** | Operational | `npm run lint` (0 errors), `npm run typecheck` (0 errors), `npm test` (1184 pass), `npm run build` (79.5 kB eager JS, runtime assets verified). |

---

## 2. Baseline Verification Audit Results

All baseline verification commands were executed in the project root (`/Users/chrisjohnson/Projects/document-graph-explorer`). Every check passed cleanly with zero regressions:

```
================================================================================
BASELINE EXECUTION METRICS
================================================================================
1. ESLint (`npm run lint`):
   Command: eslint .
   Result: Exit Code 0 | 0 errors | 0 warnings

2. TypeScript Compiler (`npm run typecheck`):
   Command: tsc --noEmit
   Result: Exit Code 0 | 0 errors

3. Vitest Suite (`npm test`):
   Command: vitest run
   Result: Exit Code 0 | 179/179 test files passed | 1,184 passed | 1 skipped | 0 failed
   Duration: 15.35s total execution time

4. Production Build (`npm run build`):
   Command: tsc --noEmit && vite build && node scripts/verify-runtime-assets.mjs dist && node scripts/check-bundle.mjs dist
   Result: Exit Code 0 | 1,312 modules transformed
   Asset Verification: 1 WASM SIMD runtime, bundled bge-small-en-v1.5 model, OCR runtime, LiberationSans fonts verified.
   Bundle Budget: Entrypoint 79.5 kB (within strict 100 kB eager limit).
================================================================================
```

---

## 3. Pillar R1: Architecture, Code Quality & State Management

### 3.1 Subsystem Architecture Overview
The application partitions state across eight Zustand stores and one raw runtime cache module:
- **`useGraphStore`** (`src/store/graphStore.ts`): Graph topology (`nodes`, `edges`, `nodeIndex`, `clusterNames`), pipeline progress (`phase`, `fileStatuses`), and metrics (`corpusHash`, `duplicatePairs`).
- **`useUiStore`** (`src/store/uiStore.ts`): Viewport interaction (`hoveredId`, `selectedId`, `pendingFocus`, `dims`, `qualityTier`, modal/drawer visibilities, `toasts`).
- **`useSettingsStore`** (`src/store/settingsStore.ts`): User configuration (`chatProvider`, `openRouterKey`, `ocrLanguage`, `cacheEmbeddings`).
- **`useAnnotationStore`**, **`useChatStore`**, **`useCorpusStore`**, **`useFolderWatchStore`**, **`useCollabStore`**: Domain-specific state.
- **`runtimeStores.ts`** (`src/store/runtimeStores.ts`): Unmanaged heap maps kept outside React/Zustand for zero-overhead access (`textStore`, `chunkStore`, `docVectorStore`, `mdLinkTargetsStore`, `dirtyDocIds`).
- **`runQueue.ts`** (`src/pipeline/runQueue.ts`): FIFO serialization queue chaining all major mutation and ingestion jobs onto a singleton promise chain `tail`.

### 3.2 Prioritized Findings & Remediation Diffs

#### Finding R1-1: Stale Multi-Tab Overwrite in `saveActiveCorpusPositions`
- **File**: `src/persistence/corpusRepository.ts` (Lines 237–263)
- **Severity**: **Critical**
- **Root Cause**: When a background tab saves settled camera positions or layout node coordinates, `saveActiveCorpusPositions` checks if `active.corpusHash !== corpusHash`. If the hash diverges (because another tab ingested new documents), it invokes `saveActiveCorpusSnapshot(corpusHash, exportData, positions)` using the background tab's **stale older `exportData` and older `docHashes`**, completely overwriting the newer corpus in IndexedDB.
- **Remediation**: If `active.corpusHash !== corpusHash`, the position update is obsolete and must be silently dropped without modifying the stored corpus record.

```diff
--- a/src/persistence/corpusRepository.ts
+++ b/src/persistence/corpusRepository.ts
@@ -248,10 +248,11 @@ export async function saveActiveCorpusPositions(
   const tx = db.transaction('corpora', 'readwrite');
   const store = tx.objectStore('corpora');
   const active = await store.get(activeId);
-  if (!active || active.corpusHash !== corpusHash) {
+  // If the record does not exist or was updated to a newer hash by another
+  // tab/ingest run, discard this stale position write instead of overwriting.
+  if (!active || active.corpusHash !== corpusHash) {
     await tx.done;
-    await saveActiveCorpusSnapshot(corpusHash, exportData, positions);
     return;
   }
   active.exportData = exportData;
```

#### Finding R1-2: Ghost Unclustered Nodes Persisted on Ingest Cancellation
- **File**: `src/pipeline/coordinator.ts` (Lines 1316–1330 & 630–650)
- **Severity**: **High**
- **Root Cause**: `flushBatch` incrementally commits parsed nodes to `graphStore` with `cluster: -1` and `degree: 0`. When an ingest is cancelled (e.g. during OCR or embedding), `settleCancelledIngest` sets the phase to `'ready'` without pruning or linking these half-ingested nodes. When `handleLayoutSettled` fires, this disconnected topology is saved to IndexedDB.
- **Remediation**: On cancellation, identify any nodes in `graphStore.nodes` with `cluster: -1` and prune them via `removeNodes` and `layoutRemoveNodes`.

```diff
--- a/src/pipeline/coordinator.ts
+++ b/src/pipeline/coordinator.ts
@@ -1316,6 +1316,14 @@ export function removeDocuments(ids: string[]): Promise<void> {
 function settleCancelledIngest(): void {
   const store = useGraphStore.getState;
+  // Prune unlinked/unclustered nodes (cluster === -1) added in aborted batch
+  const unlinkedIds = store().nodes
+    .filter((n) => n.kind === 'document' && n.cluster === -1)
+    .map((n) => n.id);
+  if (unlinkedIds.length > 0) {
+    store().removeNodes(unlinkedIds);
+    layoutRemoveNodes(unlinkedIds);
+  }
   publishIngestReport({ cancelled: true });
   store().setModelProgress(null);
   store().clearIngestTray();
```

#### Finding R1-3: Queue Starvation / Deadlock Hazard in `runQueue.ts`
- **File**: `src/pipeline/runQueue.ts` (Lines 24–42)
- **Severity**: **High**
- **Root Cause**: `enqueueRun` appends tasks directly to a singleton promise chain `tail` without an execution timeout. If any enqueued job hangs indefinitely (e.g. an unhandled IndexedDB lock, stalled worker, or unresolving promise), `tail` never settles, permanently locking all future ingests, document deletions, and corpus switches for that browser tab.
- **Remediation**: Wrap queued execution in a race against a 5-minute timeout watchdog.

```diff
--- a/src/pipeline/runQueue.ts
+++ b/src/pipeline/runQueue.ts
@@ -11,6 +11,7 @@
 let tail: Promise<unknown> = Promise.resolve();
+const DEFAULT_RUN_TIMEOUT_MS = 300_000; // 5 minutes max per queue item
 
 export function enqueueRun<T>(
   fn: () => Promise<T>,
-  options?: { signal?: AbortSignal },
+  options?: { signal?: AbortSignal; timeoutMs?: number },
 ): Promise<T> {
   const signal = options?.signal;
+  const timeoutMs = options?.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
   const start = (): Promise<T> => {
     if (signal?.aborted) {
       return Promise.reject(
         (signal.reason as Error | undefined) ??
           new DOMException('The operation was aborted.', 'AbortError'),
       );
     }
+    let timer: ReturnType<typeof setTimeout>;
+    const timeoutPromise = new Promise<never>((_, reject) => {
+      timer = setTimeout(() => reject(new Error('Queued operation timed out')), timeoutMs);
+    });
+    return Promise.race([fn(), timeoutPromise]).finally(() => clearTimeout(timer));
   };
   const run = tail.then(start, start);
   tail = run.then(
```

#### Finding R1-4: Missing Granular Error Boundaries & Context Recovery
- **Files**: `src/scene/NebulaCanvas.tsx` (Lines 110–208), `src/ui/SidePanelReader.tsx` (Lines 110–214), `src/App.tsx`
- **Severity**: **Medium**
- **Root Cause**: Only a single top-level `AppErrorBoundary` exists. Any WebGL shader compilation error, context loss, or markdown preview rendering failure unmounts the whole application.
- **Remediation**: Introduce localized error boundaries for canvas and document preview panels, falling back to raw text/clean placeholders rather than crashing the root tree.

#### Finding R1-5: Missing Multi-Tab Storage Event Synchronization
- **Files**: `src/store/settingsStore.ts` (Lines 86–110), `src/store/uiStore.ts` (Lines 278–281)
- **Severity**: **Medium**
- **Root Cause**: `settingsStore` and `uiStore` persist to `localStorage` but do not register `window.addEventListener('storage', ...)`. Settings updated in Tab A are not reflected in Tab B until reload and can be overwritten by Tab B.
- **Remediation**: Listen for `storage` events on `SETTINGS_KEY` and `DIMS_KEY` to update in-memory stores reactively.

#### Finding R1-6: Inefficient Peer Presence Selector in `Toolbar.tsx`
- **File**: `src/ui/Toolbar.tsx` (Lines 90–91)
- **Severity**: **Low**
- **Root Cause**: `Toolbar` subscribes to `s.peers` object directly. Every remote peer cursor movement creates a new `peers` reference, causing the entire toolbar and child menus to re-render 60 times/second.
- **Remediation**: Select scalar peer count via `useCollabStore((s) => Object.keys(s.peers).length)`.

---

## 4. Pillar R2: Ingestion Pipeline, Web Workers & Performance

### 4.1 Subsystem Architecture Overview
- **Document Parsers**: Comprehensive multi-format support (PDF via `pdfjs-dist`, DOCX/PPTX/XLSX/ODF via `fast-xml-parser` and `JSZip`, Markdown with Obsidian wikilinks, HTML/MHTML, Source Code across 15+ languages, EPUB, Jupyter `.ipynb`, and RTF).
- **Resource Limits**: Strict defensive bounding: `MAX_INGEST_FILE_BYTES = 64MB`, `MAX_INGEST_TOTAL_BYTES = 512MB`, `MAX_ZIP_ENTRY_BYTES = 40MB`, `MAX_PPTX_SLIDES = 300`, `MAX_XLSX_SHEETS = 200`, and `MAX_EMBED_TEXT_BYTES = 200KB`.
- **Worker Pool**: `WorkerPool` pins all embedding requests to `embeddingWorkerIndex` to prevent multi-model memory duplication (~130MB ONNX model).
- **Execution Providers**: WebGPU with `shader-f16` + `fp16` execution, gracefully falling back to WASM `q8` on adapter failure.
- **3D Physics**: `d3-force-3d` runs in `layout.worker.ts` with 33ms tick throttling (~30fps), spherical shell constraints, and `SETTLE_ALPHA = 0.005` convergence.
- **Transferable Buffers**: Full zero-copy transfers for all typed arrays (`file.bytes`, `docVector`, `chunkVectors`, `queryVector`, `positions`) with bidirectional buffer recycling in the layout worker.
- **Search & Retrieval**: Multi-signal Reciprocal Rank Fusion (RRF) combining exact lexical title/phrase matching with vectorized cosine similarity dot products ($O(d)$ on normalized unit vectors).

### 4.2 Prioritized Findings & Remediation Recommendations

#### Finding R2-1: Unchecked Task Backlog During High-Frequency Folder Watch Events
- **Files**: `src/pipeline/coordinator.ts` (Lines 1415–1450), `src/ingest/folderWatcher.ts` (Lines 180–220)
- **Severity**: **Medium**
- **Root Cause**: Rapid file churn in watched folders can queue multiple full Louvain clustering passes (`aggRequest({ type: 'cluster' })`) sequentially behind `runQueue`.
- **Remediation**: Apply a 500ms trailing debounce on folder change events to coalesce burst file edits into a single reconciliation run.

#### Finding R2-2: Suboptimal TypedArray Slicing in `handleEmbedBatch`
- **File**: `src/workers/pipeline.worker.ts` (Lines 327–330)
- **Severity**: **Low**
- **Root Cause**: `allVectors.slice(...)` allocates a new `Float32Array` copy for each document. For single-document requests, this is an unnecessary memory allocation.
- **Remediation**: If `req.docs.length === 1`, transfer `allVectors.buffer` directly.

#### Finding R2-3: Linear Scan Hash Map Lookup in `similarDocuments`
- **File**: `src/search/similarDocuments.ts` (Lines 106–114)
- **Severity**: **Low**
- **Root Cause**: `similarDocuments()` performs `deps.vectors.get(node.id)` inside candidate iteration loops, incurring hash map overhead.
- **Remediation**: Iterate directly over `deps.vectors` or maintain a contiguous vector matrix when corpus size exceeds 2,000 nodes.

---

## 5. Pillar R3: 3D Scene Graph, Rendering & UI/UX

### 5.1 Subsystem Architecture Overview
- **Rendering Architecture**: Built with Three.js and `@react-three/fiber` (R3F). Node rendering is batched into instanced meshes (`InstancedMesh` in `Nodes.tsx` for 4,096 instances), and edges are drawn using `LineSegments2` (`Edges.tsx`).
- **Camera & Navigation**: Orbit controls and camera rig with smooth focus framing, 2D/3D projection transitions (`CameraRig.tsx`), and analytic ray-sphere picking (`instancedSphereRaycast`).
- **Accessibility & Focus**: Floating glassmorphism panels (`SidePanel`, `ChatPanel`, `InsightsPanel`, `PathPanel`), minimap canvas, and keyboard navigation.

### 5.2 Prioritized Findings & Remediation Diffs

#### Finding R3-1: GPU Geometry Memory Leak in `SelectionHalo.tsx`
- **File**: `src/scene/SelectionHalo.tsx` (Lines 56, 85–92)
- **Severity**: **High**
- **Root Cause**: When a node is selected, `SelectionHalo` mounts and creates `useMemo(() => new THREE.PlaneGeometry(1, 1), [])`. Because it lacks an unmount cleanup hook (`geometry.dispose()`), every selection and deselection cycle leaks a GPU vertex buffer and VAO.
- **Remediation**: Add a `useEffect` disposal hook to free the geometry on unmount.

```diff
--- a/src/scene/SelectionHalo.tsx
+++ b/src/scene/SelectionHalo.tsx
@@ -53,7 +53,10 @@ const ringMaterial = new THREE.ShaderMaterial({
 export default function SelectionHalo() {
   const selectedId = useUiStore((s) => s.selectedId);
   const meshRef = useRef<THREE.Mesh>(null);
   const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
+  useEffect(() => {
+    return () => geometry.dispose();
+  }, [geometry]);
 
   useFrame(({ camera, clock }) => {
```

#### Finding R3-2: Missing WebGL Context Loss & Restoration Lifecycle Handlers
- **File**: `src/scene/NebulaCanvas.tsx` (Lines 119–142)
- **Severity**: **High**
- **Root Cause**: The canvas element does not handle `webglcontextlost` or `webglcontextrestored`. On GPU sleep/wake or driver reset, the browser marks the context as permanently dead without `event.preventDefault()`, and module-level singleton shader materials retain stale program handles.
- **Remediation**: Attach `webglcontextlost` and `webglcontextrestored` listeners in `onCreated` and notify the UI toast system.

```diff
--- a/src/scene/NebulaCanvas.tsx
+++ b/src/scene/NebulaCanvas.tsx
@@ -131,6 +131,14 @@ export default function NebulaCanvas() {
       gl={{ antialias: false, powerPreference: 'high-performance' }}
       onCreated={({ gl }) => {
         gl.outputColorSpace = THREE.SRGBColorSpace;
         gl.toneMapping = THREE.ACESFilmicToneMapping;
         gl.toneMappingExposure = 1.08;
+        const canvas = gl.domElement;
+        canvas.addEventListener('webglcontextlost', (e) => {
+          e.preventDefault();
+          useUiStore.getState().pushToast('Graphics context lost — restoring...', 'warning');
+        });
+        canvas.addEventListener('webglcontextrestored', () => {
+          useUiStore.getState().pushToast('Graphics context restored.', 'info');
+        });
       }}
```

#### Finding R3-3: Missing Focus Traps on Modal Dialogs (WCAG 2.1 AA Violation)
- **Files**: `src/ui/SidePanel.tsx` (Line 183), `src/ui/ChatPanel.tsx` (Line 249), `src/ui/InsightsPanel.tsx` (Line 267), `src/ui/PathPanel.tsx` (Line 108)
- **Severity**: **High**
- **Root Cause**: While `SettingsPanel.tsx` and `SnapshotDrawer.tsx` integrate `useFocusTrap`, `SidePanel`, `ChatPanel`, `InsightsPanel`, and `PathPanel` omit `useFocusTrap` and `aria-modal="true"`. Keyboard users tabbing through these dialogs escape into background scene controls.
- **Remediation**: Integrate `useFocusTrap` and `aria-modal="true"` across all modal panels.

```diff
--- a/src/ui/SidePanel.tsx
+++ b/src/ui/SidePanel.tsx
@@ -10,6 +10,7 @@ import { codeLanguageForNode, fileTypeChip, fileTypeLabel } from '../pipeline/co
 import { focusNode } from './focusNode';
 import { type ConnectionRow } from './sidePanelModel';
+import { useFocusTrap } from './useFocusTrap';
 import SidePanelAbout from './SidePanelAbout';
@@ -62,6 +63,8 @@ export default function SidePanel() {
   const nodeId = node?.id;
+  const panelRef = useRef<HTMLDivElement>(null);
+  useFocusTrap(panelRef, Boolean(nodeId));
   const closeButtonRef = useRef<HTMLButtonElement>(null);
@@ -182,3 +185,3 @@ export default function SidePanel() {
     <div className="side-panel-layer">
-      <div className="side-panel glass-panel" role="dialog" aria-label={dialogLabel}>
+      <div ref={panelRef} className="side-panel glass-panel" role="dialog" aria-modal="true" aria-label={dialogLabel}>
```

#### Finding R3-4: WebGL Buffer Attribute Re-allocation in `PathRouteOverlay.tsx`
- **File**: `src/scene/PathRouteOverlay.tsx` (Lines 260–272)
- **Severity**: **High**
- **Root Cause**: `useFrame` invokes `geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))` when `useFat` is false. Creating new `BufferAttribute` instances inside the render loop causes GPU driver VBO thrashing.
- **Remediation**: Allocate a fixed-size attribute with `THREE.DynamicDrawUsage` and update `needsUpdate = true`.

#### Finding R3-5: Redundant 3x Matrix Decomposition per Node Instance
- **File**: `src/scene/Nodes.tsx` (Lines 704–717)
- **Severity**: **Medium**
- **Root Cause**: `dummy.updateMatrix()` is called three times per node instance across `core`, `halo`, and `topic` meshes, executing 12,288 matrix compositions per frame during materialization animations.
- **Remediation**: Compute position/rotation once and apply scale directly or share the matrix across meshes.

#### Finding R3-6: Heap Object Allocations in Community Field Calculation
- **Files**: `src/scene/FlatClusterLabels.tsx` (Lines 59–72), `src/scene/clusterFields.ts`
- **Severity**: **Medium**
- **Root Cause**: `FlatClusterLabels` allocates thousands of temporary `{ cluster, x, y, z }` object literals on a 100ms interval during simulation.
- **Remediation**: Read directly from `positionBuffer.array` without allocating intermediate objects.

#### Finding R3-7: Analytic Picking Vector Allocation in Pointer Move Loop
- **File**: `src/scene/Nodes.tsx` (Line 194)
- **Severity**: **Medium**
- **Root Cause**: `instancedSphereRaycast` clones `ray.direction` and instantiates a new `THREE.Vector3` on every intersection test during pointer movement.
- **Remediation**: Reuse a static scratch `THREE.Vector3` instance.

#### Finding R3-8: Missing WASD and Zoom Keyboard Controls
- **File**: `src/App.tsx` (Lines 286–315)
- **Severity**: **Medium**
- **Root Cause**: Viewport keyboard navigation is limited to arrow keys; standard WASD, Q/E, and `+`/`-` zoom bindings are unsupported.
- **Remediation**: Expand `handleKeyDown` in `App.tsx` to support WASD navigation and zoom hotkeys.

#### Finding R3-9: Toolbar ARIA Semantics & Menu Navigation
- **File**: `src/ui/Toolbar.tsx` (Lines 263, 321, 399)
- **Severity**: **Medium**
- **Root Cause**: Toolbar menus lack `role="toolbar"`, `role="menu"`, and `role="menuitem"`, and do not support Arrow key navigation.
- **Remediation**: Add ARIA roles and arrow-key focus management.

#### Finding R3-10: Screen Reader Live Region for Model & OCR Progress
- **File**: `src/ui/ProgressStrip.tsx` (Lines 200–216)
- **Severity**: **Medium**
- **Root Cause**: Embedding model download and OCR progress bars are placed outside the `role="status"` live region.
- **Remediation**: Wrap model/OCR progress inside an `aria-live="polite"` container.

#### Finding R3-11: Interactive Minimap Missing `:focus-visible` Styling
- **Files**: `src/ui/Minimap.tsx` (Line 382), `src/styles.css` (Line 5004)
- **Severity**: **Medium**
- **Root Cause**: The minimap canvas is focusable via Tab (`tabIndex={0}`) but lacks a visible focus outline in CSS.
- **Remediation**: Add `.minimap canvas:focus-visible { outline: 2px solid var(--accent); }`.

#### Finding R3-12: Sub-4.5:1 Text Color Contrast on 2D Cluster Labels
- **File**: `src/scene/FlatClusterLabels.tsx` (Lines 109–110)
- **Severity**: **Low**
- **Root Cause**: Text color `#b9cbd8` at `fillOpacity={0.5}` against `#06101a` yields a contrast ratio of ~3.2:1 (below WCAG 2.1 AA 4.5:1).
- **Remediation**: Increase opacity or brighten label color to `#e2edf5`.

#### Finding R3-13: Orphaned Dead Scene Components
- **Files**: `src/scene/ClusterAtmosphere.tsx`, `src/scene/NebulaClouds.tsx`
- **Severity**: **Low**
- **Root Cause**: Complete shader components are defined but unimported and unrendered.
- **Remediation**: Remove or archive unused shader files to streamline the bundle.

---

## 6. Pillar R4: Test Coverage, CI/CD & Airgap Verification

### 6.1 Subsystem Architecture Overview
- **Vitest Configuration**: Fast Node-based test execution (`vite.config.ts`), with jsdom opted in for UI helper tests. 179 test files and 1,184 tests pass cleanly.
- **Airgap Security**: Verified 100% compliant. `@huggingface/transformers` is configured with `allowRemoteModels = false` and `localModelPath = '/models/'`; OCR assets load from `/ocr/`; fonts are self-hosted; strict Content Security Policy (`connect-src 'self' blob:`) blocks all unauthorized remote network requests.
- **CI/CD Workflows**: `.github/workflows/ci.yml` runs lint, typecheck, test, build, airgap build, and bundle checks on `ubuntu-latest`.

### 6.2 Prioritized Findings & Remediation Diffs

#### Finding R4-1: Missing `@vitest/coverage-v8` & CI Coverage Gate
- **Files**: `package.json` (Lines 56–80), `vite.config.ts` (Lines 110–114), `.github/workflows/ci.yml`
- **Severity**: **Critical**
- **Root Cause**: `@vitest/coverage-v8` is not installed, and `vite.config.ts` has no `coverage` block. Running `vitest run --coverage` crashes with an error. Pull requests cannot enforce coverage thresholds.
- **Remediation**: Install `@vitest/coverage-v8`, add coverage reporters (lcov, text, html), and establish an 80% coverage threshold gate in CI.

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

#### Finding R4-2: Multi-Platform CI Matrix & Automated macOS/Linux Releases
- **Files**: `.github/workflows/ci.yml` (Lines 13–61), `.github/workflows/release.yml` (Lines 11–84)
- **Severity**: **High**
- **Root Cause**: CI runs only on `ubuntu-latest`. In `release.yml`, only Windows portable executables are built and released; macOS `.dmg`/`.app` and Linux `.AppImage` desktop packages are **never published on release tags** despite packaging scripts existing in `package.json`.
- **Remediation**: Add matrix jobs across `[ubuntu-latest, macos-latest, windows-latest]` in CI and build/publish cross-platform release artifacts.

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

#### Finding R4-3: Missing Unit Test Suite for `layoutBridge.ts`
- **File**: `src/layout/layoutBridge.ts` (375 lines)
- **Severity**: **High**
- **Root Cause**: `layoutBridge.ts` controls slot allocation (`nextSlot`), slot recycling (`freeSlots`), transferable buffer return (`returnBuffer`), and crash recovery (`CRASH_WINDOW_MS = 10_000`), but has **0 unit tests**.
- **Remediation**: Create `src/layout/layoutBridge.test.ts` testing slot recycling, buffer swaps, and crash re-seeding.

#### Finding R4-4: 19 Untested React Three Fiber Scene Components (0% Coverage)
- **Files**: `src/scene/*.tsx` (`Nodes.tsx`, `Edges.tsx`, `CameraRig.tsx`, `NebulaCanvas.tsx`, etc.)
- **Severity**: **High**
- **Root Cause**: Over 200 KB of 3D rendering and shader logic across 19 components has 0 component unit tests.
- **Remediation**: Implement a WebGL mock harness (`sceneSmoke.test.tsx`) to verify scene components mount, update, and unmount cleanly.

#### Finding R4-5: Untested OpenUSD Python Pipeline in CI
- **Files**: `tools/usd_pipeline/usd_pipeline.py`, `usd_agent.py` (36.8 KB)
- **Severity**: **High**
- **Root Cause**: Python OpenUSD export and agent scripts have 0 unit tests and no lint/mypy checks in CI.
- **Remediation**: Add a `pytest` suite and `ruff`/`mypy` lint step in `.github/workflows/ci.yml`.

#### Finding R4-6: Missing Unit Tests for Parser Polyfills & Geometry Math
- **Files**: `src/pipeline/parsers/pdfUint8ArrayPolyfill.ts`, `pdfMapUpsertPolyfill.ts`, `pdfLinkLabels.ts`
- **Severity**: **Medium**
- **Root Cause**: Critical polyfills and PDF annotation bounding-box collision math have no standalone unit tests.
- **Remediation**: Add unit tests for hex/base64 conversions, map upsert callbacks, and link bounding box calculations.

#### Finding R4-7: Enable `noUncheckedIndexedAccess: true` in `tsconfig.json`
- **File**: `tsconfig.json` (Line 12)
- **Severity**: **Medium**
- **Root Cause**: `noUncheckedIndexedAccess` is false, meaning array/buffer indexing `arr[i]` returns `T` instead of `T | undefined`.
- **Remediation**: Enable `noUncheckedIndexedAccess: true` and resolve un-checked index lookups.

#### Finding R4-8: Tighten ESLint Strictness (`no-explicit-any`, `exhaustive-deps: 'error'`)
- **File**: `eslint.config.js` (Lines 55–66)
- **Severity**: **Medium**
- **Root Cause**: `@typescript-eslint/no-explicit-any: 'off'` and `react-hooks/exhaustive-deps: 'warn'` allow untyped escapes and stale closures.
- **Remediation**: Restrict `any` usage and elevate hook dependency warnings to errors in CI.

#### Finding R4-9: Node.js Version Drift Across Tooling
- **Files**: `.github/workflows/ci.yml`, `release.yml`, `Dockerfile`
- **Severity**: **Medium**
- **Root Cause**: CI uses Node 22, Docker uses Node 24-alpine, and `pkg` uses Node 18.
- **Remediation**: Standardize on Node 22 LTS across all runtime configurations.

#### Finding R4-10: Hardcoded Architecture in `scripts/deploy-app.mjs`
- **File**: `scripts/deploy-app.mjs` (Line 12)
- **Severity**: **Medium**
- **Root Cause**: Hardcodes `release/mac-arm64/Document Graph Explorer.app`, breaking on Intel Macs (`mac-x64`).
- **Remediation**: Resolve path dynamically using `process.arch === 'arm64' ? 'mac-arm64' : 'mac'`.

#### Finding R4-11: Missing Upper-Bound Assertions in Layout Benchmark
- **File**: `scripts/bench-layout.mjs`
- **Severity**: **Low**
- **Root Cause**: Benchmark measures layout convergence time but does not assert upper-bound thresholds.
- **Remediation**: Add regression threshold assertions to fail on performance degradation.

---

## 7. Master Prioritization & Impact vs. Effort Matrix

The 33 audited findings are categorized below by severity, implementation effort, and architectural impact:

| Finding ID | Pillar | Subsystem / Area | Severity | Effort | Impact | Target File(s) |
|---|---|---|---|---|---|---|
| **R1-1** | R1 | Multi-Tab Persistence Race | **Critical** | **S** | Prevents silent corpus data loss in concurrent tabs | `src/persistence/corpusRepository.ts:237-263` |
| **R4-1** | R4 | Vitest Coverage Tooling & CI Gate | **Critical** | **S** | Enables code coverage tracking and CI quality gates | `package.json`, `vite.config.ts`, `.github/workflows/ci.yml` |
| **R1-2** | R1 | Ingest Cancellation Ghost Nodes | **High** | **S** | Prevents saving corrupted, disconnected topologies | `src/pipeline/coordinator.ts:1316-1330` |
| **R1-3** | R1 | `runQueue.ts` Queue Starvation Guard | **High** | **S** | Eliminates risk of permanent app-wide pipeline freeze | `src/pipeline/runQueue.ts:24-42` |
| **R3-1** | R3 | `SelectionHalo` GPU Geometry Leak | **High** | **S** | Fixes GPU VBO/VAO memory leak on node selections | `src/scene/SelectionHalo.tsx:56, 85-92` |
| **R3-2** | R3 | WebGL Context Loss & Restore | **High** | **M** | Prevents unrecoverable black screen on GPU sleep/wake | `src/scene/NebulaCanvas.tsx:119-142` |
| **R3-3** | R3 | Dialog Focus Traps (WCAG 2.1 AA) | **High** | **S** | Fixes keyboard navigation bleeding out of dialogs | `src/ui/SidePanel.tsx`, `ChatPanel.tsx`, `InsightsPanel.tsx` |
| **R3-4** | R3 | `PathRouteOverlay` Buffer Thrashing | **High** | **S** | Eliminates per-frame VBO driver reallocations | `src/scene/PathRouteOverlay.tsx:260-272` |
| **R4-2** | R4 | Cross-Platform CI & Releases | **High** | **M** | Automates macOS (.dmg) and Linux (.AppImage) releases | `.github/workflows/ci.yml`, `release.yml` |
| **R4-3** | R4 | `layoutBridge.ts` Unit Test Suite | **High** | **M** | Guarantees stability of node slot recycling & worker crashes | `src/layout/layoutBridge.ts`, `layoutBridge.test.ts` |
| **R4-4** | R4 | R3F Scene Component Smoke Tests | **High** | **L** | Catches WebGL/R3F render crashes in automated test suite | `src/scene/*.tsx`, `sceneSmoke.test.tsx` |
| **R4-5** | R4 | OpenUSD Python Pipeline Tests in CI | **High** | **M** | Prevents schema drift in OpenUSD export tools | `tools/usd_pipeline/`, `.github/workflows/ci.yml` |
| **R1-4** | R1 | Granular Error Boundaries | **Medium** | **M** | Isolates renderer crashes from crashing root app | `src/scene/NebulaCanvas.tsx`, `SidePanelReader.tsx` |
| **R1-5** | R1 | Multi-Tab Storage Event Sync | **Medium** | **S** | Syncs settings & 2D/3D mode across active browser tabs | `src/store/settingsStore.ts:86-110`, `uiStore.ts` |
| **R2-1** | R2 | Watched Folder Debounce | **Medium** | **S** | Coalesces rapid file churn into single layout runs | `src/pipeline/coordinator.ts:1415`, `folderWatcher.ts` |
| **R3-5** | R3 | Nodes 3x Matrix Decomposition | **Medium** | **S** | Saves 12,000 matrix compositions/frame on main thread | `src/scene/Nodes.tsx:704-717` |
| **R3-6** | R3 | Community Field Heap Churn | **Medium** | **S** | Eliminates GC spikes during graph layout ticks | `src/scene/FlatClusterLabels.tsx:59`, `clusterFields.ts` |
| **R3-7** | R3 | Raycast Vector Heap Allocations | **Medium** | **S** | Achieves zero-GC pointer movement over 3D canvas | `src/scene/Nodes.tsx:194` |
| **R3-8** | R3 | WASD & Zoom Keyboard Controls | **Medium** | **S** | Enables full keyboard 3D spatial exploration | `src/App.tsx:286-315` |
| **R3-9** | R3 | Toolbar ARIA Roles & Menus | **Medium** | **M** | Complies with WAI-ARIA Toolbar and Menu patterns | `src/ui/Toolbar.tsx:263, 321, 399` |
| **R3-10**| R3 | Model/OCR Screen Reader Status | **Medium** | **S** | Announces download and OCR progress to screen readers | `src/ui/ProgressStrip.tsx:200-216` |
| **R3-11**| R3 | Minimap Focus Visible Outline | **Medium** | **S** | Satisfies WCAG 2.4.7 focus visibility requirements | `src/styles.css:5004`, `Minimap.tsx:382` |
| **R4-6** | R4 | Parser Polyfill Unit Tests | **Medium** | **S** | Verifies base64/hex and PDF link geometry codecs | `src/pipeline/parsers/pdfPolyfills.test.ts` |
| **R4-7** | R4 | `noUncheckedIndexedAccess: true` | **Medium** | **M** | Enforces compile-time bounds checking on array indices | `tsconfig.json:12` |
| **R4-8** | R4 | Tighten ESLint Rules | **Medium** | **M** | Catches stale hook closures and untyped escapes | `eslint.config.js:55-66` |
| **R4-9** | R4 | Harmonize Node Versions | **Medium** | **S** | Standardizes Node 22 LTS across CI and Docker | `.github/workflows/ci.yml`, `Dockerfile` |
| **R4-10**| R4 | Dynamic macOS Deployment Arch | **Medium** | **S** | Fixes `deploy-app.mjs` path resolution on Intel Macs | `scripts/deploy-app.mjs:12` |
| **R1-6** | R1 | Toolbar Peer Presence Selector | **Low** | **S** | Avoids 60fps toolbar re-renders on remote cursor ticks | `src/ui/Toolbar.tsx:90-91` |
| **R2-2** | R2 | Single-Doc Embedding Buffer Copy | **Low** | **S** | Eliminates intermediate TypedArray slice on 1-doc embeds | `src/workers/pipeline.worker.ts:327` |
| **R2-3** | R2 | `similarDocuments` Iteration Loop | **Low** | **S** | Optimizes CPU cache locality during similarity scans | `src/search/similarDocuments.ts:106` |
| **R3-12**| R3 | 2D Label Text Contrast Ratio | **Low** | **S** | Increases flat cluster label contrast to >4.5:1 | `src/scene/FlatClusterLabels.tsx:109-110` |
| **R3-13**| R3 | Deprecate Dead Scene Shaders | **Low** | **S** | Reduces bundle size by pruning unused shaders | `src/scene/ClusterAtmosphere.tsx`, `NebulaClouds.tsx` |
| **R4-11**| R4 | Benchmark Performance Gates | **Low** | **S** | Adds regression assertion limits to layout benchmarks | `scripts/bench-layout.mjs` |

*Effort Scale*: **S** (< 2 hours, localized diff), **M** (2–8 hours, multi-file integration), **L** (> 8 hours, substantial test harness / architecture).

---

## 8. Phased Remediation Roadmap

```
                               PHASED REMEDIATION ROADMAP
 ┌─────────────────────────┐     ┌─────────────────────────┐     ┌─────────────────────────┐
 │        PHASE 1          │     │        PHASE 2          │     │        PHASE 3          │
 │  Critical Integrity &   │ ──> │   High Reliability &    │ ──> │ Performance, Rendering  │
 │       Data Safety       │     │  Platform Automation    │     │      & A11y Polish      │
 └─────────────────────────┘     └─────────────────────────┘     └─────────────────────────┘
   - R1-1: Multi-Tab Fix           - R1-3: runQueue Timeout        - R3-4: PathRoute VBO Fix
   - R1-2: Ingest Ghost Prune      - R3-2: WebGL Context Loss      - R3-5: Nodes 3x Matrix
   - R3-1: SelectionHalo Leak      - R3-3: Dialog Focus Traps      - R3-7: Raycast Vector Pool
   - R4-1: Vitest Coverage v8      - R4-2: Multi-Platform CI/Rel   - R3-8: WASD Key Controls
                                   - R4-3: layoutBridge Tests      - R3-9: Toolbar ARIA Roles
                                   - R4-4: R3F Smoke Tests         - R3-11: Minimap Focus Ring
                                   - R4-5: OpenUSD Pytest CI       - R4-6: Polyfill Tests
```

### Phase 1: Critical Integrity, Data Safety & Coverage Tooling (Immediate)
- **Objective**: Eliminate silent data loss in IndexedDB persistence, prevent corrupted graph states on ingest abort, fix GPU geometry leaks, and unblock CI coverage instrumentation.
- **Action Items**:
  1. Patch `saveActiveCorpusPositions` in `src/persistence/corpusRepository.ts` (R1-1).
  2. Implement unclustered ghost node pruning in `settleCancelledIngest()` in `src/pipeline/coordinator.ts` (R1-2).
  3. Attach `useEffect` geometry disposal in `src/scene/SelectionHalo.tsx` (R3-1).
  4. Install `@vitest/coverage-v8` and configure 80% coverage threshold gates in `vite.config.ts` (R4-1).

### Phase 2: High Reliability, Platform Automation & Subsystem Testing (Near-Term)
- **Objective**: Protect the background task queue from permanent starvation, handle WebGL context loss gracefully, secure accessibility compliance on modal dialogs, and automate cross-platform releases.
- **Action Items**:
  1. Add 5-minute timeout watchdog to `enqueueRun()` in `src/pipeline/runQueue.ts` (R1-3).
  2. Add `webglcontextlost` and `webglcontextrestored` event handlers in `src/scene/NebulaCanvas.tsx` (R3-2).
  3. Integrate `useFocusTrap` and `aria-modal="true"` in `SidePanel.tsx`, `ChatPanel.tsx`, `InsightsPanel.tsx`, and `PathPanel.tsx` (R3-3).
  4. Implement GitHub Actions multi-OS runner matrix (`macos-latest`, `windows-latest`, `ubuntu-latest`) and automate macOS `.dmg` and Linux `.AppImage` release builds in `release.yml` (R4-2).
  5. Write unit test suites for `layoutBridge.ts` (R4-3) and create R3F component smoke test harness (R4-4).
  6. Add `pytest` test suite and `ruff`/`mypy` checks for `tools/usd_pipeline/` in CI (R4-5).

### Phase 3: Performance, 3D Rendering & Accessibility Polish (Mid-Term)
- **Objective**: Maximize rendering frame rates, eliminate JS heap garbage collection churn during simulation, and achieve full WCAG 2.1 AA keyboard navigation.
- **Action Items**:
  1. Pre-allocate fixed attribute buffers with `DynamicDrawUsage` in `src/scene/PathRouteOverlay.tsx` (R3-4).
  2. Optimize matrix compositions in `src/scene/Nodes.tsx` (R3-5).
  3. Refactor community field calculations in `FlatClusterLabels.tsx` to read directly from typed arrays (R3-6).
  4. Pool raycast intersection vectors in `Nodes.tsx` (R3-7).
  5. Implement WASD, Q/E, and zoom keyboard navigation in `src/App.tsx` (R3-8).
  6. Add ARIA toolbar/menu roles and Arrow-key navigation to `Toolbar.tsx` (R3-9).
  7. Wrap model download and OCR progress in `aria-live="polite"` live regions in `ProgressStrip.tsx` (R3-10).
  8. Style `.minimap canvas:focus-visible` in `src/styles.css` (R3-11).
  9. Add unit tests for `pdfUint8ArrayPolyfill.ts`, `pdfMapUpsertPolyfill.ts`, and `pdfLinkLabels.ts` (R4-6).

### Phase 4: Type Strictness, Codebase Hygiene & Tooling (Long-Term)
- **Objective**: Strengthen compile-time safety and prune dead legacy code.
- **Action Items**:
  1. Enable `noUncheckedIndexedAccess: true` in `tsconfig.json` (R4-7).
  2. Tighten ESLint rules for `no-explicit-any` and `exhaustive-deps: 'error'` in CI (R4-8).
  3. Standardize on Node 22 LTS across all pipeline configurations (R4-9).
  4. Fix dynamic architecture resolution in `scripts/deploy-app.mjs` (R4-10).
  5. Prune dead shader files `ClusterAtmosphere.tsx` and `NebulaClouds.tsx` (R3-13).

---

## 9. Verification & Reproduction Guide

To independently reproduce the baseline verification and validate future remediation patches, execute the following commands from the project root:

```bash
# ==============================================================================
# 1. CODE QUALITY & TYPE SAFETY CHECKS
# ==============================================================================
npm run lint
npm run typecheck

# ==============================================================================
# 2. AUTOMATED UNIT & INTEGRATION TEST SUITES
# ==============================================================================
npm test

# ==============================================================================
# 3. PRODUCTION BUNDLE & RUNTIME ASSET INTEGRITY
# ==============================================================================
npm run build
npm run build:airgap

# ==============================================================================
# 4. AIRGAP SECURITY & BUNDLE BUDGET AUDIT
# ==============================================================================
node scripts/verify-airgap.mjs
node scripts/verify-runtime-assets.mjs dist
node scripts/verify-runtime-assets.mjs dist-airgap
node scripts/check-bundle.mjs dist
node scripts/check-bundle.mjs dist-airgap
```

### Audit Sign-off
- **Baseline Integrity**: Confirmed 100% clean passes across all standard build and test targets.
- **Airgap Compliance**: Verified zero remote network leaks; local models, WASM runtimes, OCR, and fonts are strictly self-hosted.
- **Master Report Location**: `/Users/chrisjohnson/Projects/document-graph-explorer/AUDIT_REPORT.md`
