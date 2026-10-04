# Technical Audit Report: Pillar R1 — Architecture, Code Quality & State Management

## 1. Observation

A comprehensive line-level audit of the architecture, state stores, concurrency mechanics, task queue, error boundaries, and persistence lifecycle was conducted across the Document Graph Explorer codebase. Below are direct observations across all five focus areas with verbatim source references.

---

### Area 1: Zustand Stores & State Partitioning

#### Observation 1.1: Store Partitioning Architecture
The application partitions state across eight Zustand stores and one raw runtime cache module:
1. `useGraphStore` (`src/store/graphStore.ts`): Graph topology (`nodes`, `edges`, `nodeIndex`, `clusterNames`, `localClusterNames`), pipeline progress (`phase`, `fileStatuses`, `ignoredFiles`, `modelProgress`, `enrichProgress`, `ingestReport`), and graph-level metrics (`corpusHash`, `duplicatePairs`, `semanticNeighbors`, `successfulIngestCount`).
2. `useUiStore` (`src/store/uiStore.ts`): Viewport interaction (`hoveredId`, `selectedId`, `pendingFocus`, `readerHighlight`, `searchOpen`, `searchResults`, `highlightOwner`, `filter`, `snapshotOverlay`, `dims`, `flatEdgeDetail`, `topicNodesEnabled`, `clusterCollapsed`, `qualityTier`, `autoQuality`, `cameraCommand`, modal/drawer visibilities, `toasts`, `lastError`, `pathMode`, `pathEndpoints`).
3. `useSettingsStore` (`src/store/settingsStore.ts`): User settings (`chatProvider`, `enrichProvider`, `openRouterKey`, `rememberOpenRouterKey`, models, `enrichEnabled`, `includeEmbeddingsInExport`, `offlineMode`, `cacheEmbeddings`, `embeddingQueryStyle`, `ocrLanguage`, `ocrMaxPages`).
4. `useAnnotationStore` (`src/store/annotationStore.ts`): User annotations (`scope`, `annotations` map keyed by document path/title-id).
5. `useChatStore` (`src/store/chatStore.ts`): Ephemeral RAG transcript (`messages`, `isOpen`, `isStreaming`).
6. `useCorpusStore` (`src/store/corpusStore.ts`): Workspace registry (`initialized`, `switching`, `activeCorpusId`, `activeName`, `mode`, `corpora`).
7. `useFolderWatchStore` (`src/store/folderWatchStore.ts`): Folder synchronization status (`status`, `folderName`, `lastSyncAt`, `lastChangeCount`, `error`).
8. `useCollabStore` (`src/collab/store.ts`): WebRTC/Yjs collaboration state (`session`, `roomId`, `sessionKey`, `invite`, `status`, `peers`, `followMode`, `shareNotes`, `lastRemoteView`).
9. `runtimeStores.ts` (`src/store/runtimeStores.ts`): Unmanaged heap maps kept outside React/Zustand:
   - `textStore` (`Map<string, string>`: docId -> full text)
   - `chunkStore` (`Map<string, ChunkData>`: docId -> chunk texts + Float32Array embeddings)
   - `docVectorStore` (`Map<string, Float32Array>`: docId -> document embedding)
   - `mdLinkTargetsStore` (`Map<string, string[]>`: docId -> markdown links)
   - `docLinksStore` (`Map<string, LinkRef[]>`: docId -> labeled links)
   - `dirtyDocIds` (`Set<string>`: modified doc IDs for delta-persistence)

#### Observation 1.2: Excessive Re-renders from Over-Broad Selectors in Toolbar and SidePanel
- In `src/ui/Toolbar.tsx` lines 90–91:
  ```ts
  90:   const collabPeers = useCollabStore((s) => s.peers);
  91:   const remotePeerCount = Object.keys(collabPeers).length;
  ```
  In `src/collab/store.ts` lines 816–818:
  ```ts
  816:   session.provider?.awareness.on('change', () => {
  817:     set({ peers: collectPeers(session) });
  818:   });
  ```
  Every cursor tick or camera update from any remote peer fires the Yjs awareness change handler and instantiates a brand new `peers` object reference, forcing the entire `Toolbar` component and its child menus to re-render on every frame of remote peer movement.
- In `src/ui/SidePanel.tsx` lines 55–60:
  ```ts
  55:   const nodes = useGraphStore((s) => s.nodes);
  56:   const nodeIndex = useGraphStore((s) => s.nodeIndex);
  57:   const edges = useGraphStore((s) => s.edges);
  58:   const clusterNames = useGraphStore((s) => s.clusterNames);
  59:   const localClusterNames = useGraphStore((s) => s.localClusterNames);
  ```
  `SidePanel` subscribes directly to full arrays (`nodes`, `edges`) and whole dictionaries (`clusterNames`, `localClusterNames`). Any node addition, degree update, or edge recalculation in the wider graph triggers a re-render of `SidePanel`.

#### Observation 1.3: Non-Reactive Imperative Reads from `textStore`
- In `src/ui/SidePanel.tsx` line 166:
  ```ts
  166:   const fullText = textStore.get(node.id);
  ```
  `textStore` is a raw JavaScript `Map`. If `SidePanel` renders when `node` is present in `graphStore` but `textStore` has not yet completed parsing or cache retrieval, `fullText` evaluates to `undefined` (falling back to "text unavailable" in line 208). Because `textStore.set()` has no reactive subscriber, `SidePanel` does not re-render when text arrives unless another store property changes.

---

### Area 2: State Synchronization & Concurrency

#### Observation 2.1: Ingest Cancellation Leaves Floating Ghost Nodes (`cluster: -1`, `degree: 0`)
- In `src/pipeline/coordinator.ts` lines 1316–1330:
  ```ts
  1316: function settleCancelledIngest(): void {
  1317:   const store = useGraphStore.getState;
  1318:   publishIngestReport({ cancelled: true });
  1319:   store().setModelProgress(null);
  1320:   store().clearIngestTray();
  1321:   const { phase } = store();
  1322:   if (phase === 'idle' || phase === 'ready') return;
  1323:   store().setPhase(documentNodes().length > 0 ? 'ready' : 'idle');
  1324:   useUiStore.getState().pushToast('Ingest cancelled.', 'info');
  1325: }
  ```
- In `src/pipeline/coordinator.ts` lines 578–650 (`commitParsed` and `flushBatch`):
  During document parsing, batches of parsed nodes are committed directly to `graphStore.nodes` and `layoutBridge` (`layoutAddNodes`) with initial `cluster: -1` and `degree: 0`.
- When an ingest is cancelled (e.g., during OCR or embedding passes), `throwIfAborted(signal)` aborts `runIngestBody`.
- In `ingestFiles` lines 1360–1370:
  ```ts
  1364:       if (controller.signal.aborted) {
  1365:         settleCancelledIngest();
  1366:         return;
  1367:       }
  ```
  `settleCancelledIngest()` sets the phase to `'ready'`. However, `runLexicalPass`, `runEmbeddingPass`, `runSemanticPass` (Louvain clustering), and `synthesizeTopicNodes` never ran for the new nodes.
- Consequently, cancelled in-flight nodes remain permanently in `graphStore.nodes` with `cluster: -1`, zero incident edges, and no semantic links.
- When `onLayoutSettled` fires in `src/persistence/session.ts` line 64, `saveGraphRecord()` persists this broken, disconnected topology into IndexedDB.

---

### Area 3: Serialized Execution Queuing (`runQueue.ts`)

#### Observation 3.1: Promise Chain Deadlock / Starvation on Unhandled Async Hangs
- In `src/pipeline/runQueue.ts` lines 11–42:
  ```ts
  11: let tail: Promise<unknown> = Promise.resolve();
  ...
  24: export function enqueueRun<T>(
  25:   fn: () => Promise<T>,
  26:   options?: { signal?: AbortSignal },
  27: ): Promise<T> {
  28:   const signal = options?.signal;
  29:   const start = (): Promise<T> =>
  30:     signal?.aborted
  31:       ? Promise.reject(
  32:           (signal.reason as Error | undefined) ??
  33:             new DOMException('The operation was aborted.', 'AbortError'),
  34:         )
  35:       : fn();
  36:   const run = tail.then(start, start);
  37:   tail = run.then(
  38:     () => undefined,
  39:     () => undefined,
  40:   );
  41:   return run;
  42: }
  ```
- `enqueueRun` serializes every major pipeline and persistence action: file ingestion (`coordinator.ts`), document removal (`coordinator.ts`), snapshot restoration (`session.ts`), graph imports (`exportImport.ts`), corpus switching/creation/deletion (`corpusActions.ts`), and AI enrichment (`enrichment.ts`).
- If any enqueued `fn()` hangs indefinitely (e.g., an unhandled IndexedDB transaction hang, stalled network fetch in an embedding worker, or unresolving lock), `tail` never settles.
- There is no execution timeout or watchdog mechanism. Any single stalled operation freezes all subsequent ingests, switches, and mutations permanently for that browser tab session.
- Furthermore, `options.signal` is checked only at `start()`; if a signal aborts while `fn()` is executing, `runQueue.ts` provides no queue-level cancellation or unwinding.

---

### Area 4: Error Boundaries & Fault Tolerance

#### Observation 4.1: Single Top-Level Error Boundary Causes Full-App Crash on Subsystem Failures
- In `src/main.tsx` lines 11–17:
  ```ts
  11: createRoot(document.getElementById('root')!).render(
  12:   <StrictMode>
  13:     <AppErrorBoundary>
  14:       <App />
  15:     </AppErrorBoundary>
  16:   </StrictMode>,
  17: );
  ```
- In `src/App.tsx`:
  All secondary UI panels (`NebulaCanvas`, `Toolbar`, `FilterBar`, `SidePanel`, `InsightsPanel`, `ChatPanel`, `SearchOverlay`, `Minimap`, `SnapshotDrawer`) are wrapped in `<Suspense fallback={null}>` but have **no React Error Boundaries**.
- If a runtime error throws inside:
  - `NebulaCanvas` (Three.js / WebGL shader compilation, buffer allocation, context loss),
  - `SidePanelReader` / `DocumentMarkdown` / `HtmlPreview` / `CsvPreview` (AST walk failure, regex execution crash, unhandled DOM parser anomaly),
  - `ChatPanel` (Markdown AST parsing or SSE stream rendering),
  the error bubbles up to `AppErrorBoundary` at the root, completely unmounting the entire application and displaying the full-page "Document Graph Explorer stopped rendering" screen.

#### Observation 4.2: Lack of WebGL Context Loss / Restoration Handling
- In `src/scene/NebulaCanvas.tsx` lines 110–208:
  There is no event listener for `webglcontextlost` or `webglcontextrestored` on the canvas element.
- When GPU memory throttling, sleep/wake cycles, or OS driver resets trigger a WebGL context loss, Three.js throws unhandled render errors on subsequent frame loops.
- Without a localized error boundary or `contextlost` interceptor, context loss crashes the root React tree.

---

### Area 5: Multi-Tab & Persistence Lifecycle Safety

#### Observation 5.1: Critical Split-Brain Corpus Clobbering in Multi-Tab Persistence
- In `src/persistence/corpusRepository.ts` lines 237–263:
  ```ts
  237: export async function saveActiveCorpusPositions(
  238:   corpusHash: string,
  239:   exportData: GraphExport,
  240:   positions: Record<string, [number, number, number]>,
  241: ): Promise<void> {
  242:   const activeId = useCorpusStore.getState().activeCorpusId;
  243:   if (!activeId) {
  244:     await saveActiveCorpusSnapshot(corpusHash, exportData, positions);
  245:     return;
  246:   }
  247:   const db = await getDb();
  248:   const tx = db.transaction('corpora', 'readwrite');
  249:   const store = tx.objectStore('corpora');
  250:   const active = await store.get(activeId);
  251:   if (!active || active.corpusHash !== corpusHash) {
  252:     await tx.done;
  253:     await saveActiveCorpusSnapshot(corpusHash, exportData, positions);
  254:     return;
  255:   }
  256:   active.exportData = exportData;
  257:   active.positions = positions;
  258:   active.docHashes = exportData.nodes
  259:     .filter((node) => node.kind === 'document')
  260:     .map((node) => node.id);
  261:   await store.put(active);
  262:   await tx.done;
  263: }
  ```
- **Scenario**:
  1. Tab A and Tab B are open on the same active corpus.
  2. In Tab A, the user ingests new documents. Tab A updates IndexedDB with a new `corpusHash` and the expanded `exportData`.
  3. In Tab B, the user orbits or pans the camera, or the simulation settles. Tab B's `handleLayoutSettled()` debounce fires `saveGraphRecord()`, which invokes `saveActiveCorpusPositions()`.
  4. Tab B reads `active` from IndexedDB and evaluates `active.corpusHash !== corpusHash` (line 251) because Tab A updated the hash.
  5. Instead of discarding the outdated position write, line 253 executes `saveActiveCorpusSnapshot(corpusHash, exportData, positions)` using **Tab B's stale older `exportData` and older `docHashes`**.
  6. **Result**: Tab B overwrites Tab A's new corpus state in IndexedDB, corrupting workspace persistence and losing Tab A's ingested documents on next page load.

#### Observation 5.2: Missing Cross-Tab Settings and View State Synchronization
- In `src/store/settingsStore.ts` lines 86–109 and `src/store/uiStore.ts` lines 278–280:
  Settings and the 2D/3D `dims` preference are written to `localStorage` on change.
- Neither store registers a `window.addEventListener('storage', ...)` listener or `BroadcastChannel`.
- If Tab A updates API keys, embedding cache options, or changes to 2D view, Tab B retains stale in-memory state. Any subsequent write from Tab B silently overwrites Tab A's configuration in `localStorage`.

---

## 2. Logic Chain

1. **Premise**: Ingest operations must maintain graph consistency and invariant validity (`cluster >= 0`, degree integrity, bilateral links, and coherent search indices).
   - **Step 1.1**: Observations in 2.1 show that `coordinator.ts` commits parsed nodes incrementally via `flushBatch` into `graphStore` with `cluster: -1` and `degree: 0`.
   - **Step 1.2**: If cancellation occurs mid-ingest, `settleCancelledIngest()` transitions phase directly to `'ready'` without pruning or completing edges/clusters for these nodes.
   - **Step 1.3**: The layout settlement listener `handleLayoutSettled` then saves this unlinked graph to IndexedDB.
   - **Conclusion**: Ingest cancellation leaves corrupted, unclustered ghost nodes in the user's graph and persists them to disk.

2. **Premise**: Multi-tab database persistence must follow last-write-wins with optimistic concurrency control or compare-and-swap semantics to avoid data loss.
   - **Step 2.1**: Observation 5.1 demonstrates that `saveActiveCorpusPositions` in `corpusRepository.ts` detects hash divergence (`active.corpusHash !== corpusHash`).
   - **Step 2.2**: Instead of rejecting the outdated position update, it calls `saveActiveCorpusSnapshot` with the stale tab's snapshot.
   - **Step 2.3**: This unconditionally overwrites the newer graph export in IndexedDB with older document hashes.
   - **Conclusion**: Concurrent tabs cause silent data loss during background camera position saving.

3. **Premise**: Long-running background queues must be resilient against permanent starvation.
   - **Step 3.1**: Observation 3.1 shows `enqueueRun` in `runQueue.ts` appends tasks directly to a singleton promise chain `tail`.
   - **Step 3.2**: A hung task (worker crash, unhandled rejection in un-timed promise) never fulfills `tail`.
   - **Step 3.3**: All subsequent user actions (drop, delete, import, restore) queue behind `tail` and are blocked forever.
   - **Conclusion**: `runQueue.ts` requires a fallback timeout guard to prevent permanent pipeline deadlock.

4. **Premise**: Localized UI rendering exceptions should not terminate the entire application.
   - **Step 4.1**: Observation 4.1 shows that React Error Boundaries are missing around `<NebulaCanvas>`, `<SidePanel>`, and preview subcomponents.
   - **Step 4.2**: Any canvas context loss or markdown rendering crash bubbles to the root `AppErrorBoundary`.
   - **Conclusion**: Granular error boundaries and WebGL context restoration handlers are required to maintain high resilience.

---

## 3. Findings & Remediation Details

Below is the structured breakdown of each identified issue with root cause diagnosis, severity rating, and concrete remediation code.

---

### Finding R1-1: Stale Multi-Tab Overwrite in `saveActiveCorpusPositions`
- **File**: `src/persistence/corpusRepository.ts`
- **Lines**: 237–263
- **Severity**: **Critical**
- **Root Cause**: When a tab's in-memory `corpusHash` does not match the database record's `corpusHash`, `saveActiveCorpusPositions` treats the mismatch as a missing snapshot and invokes `saveActiveCorpusSnapshot()`. This overwrites newer corpus content with stale graph nodes from the background tab.
- **Remediation**: If `active.corpusHash !== corpusHash`, the position write is outdated and must be silently dropped without modifying the corpus record.

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

---

### Finding R1-2: Ghost Unclustered Nodes Persisted on Ingest Cancellation
- **File**: `src/pipeline/coordinator.ts`
- **Lines**: 1316–1330 & 630–650
- **Severity**: **High**
- **Root Cause**: `flushBatch` incrementally commits nodes with `cluster: -1` and `degree: 0`. When an ingest is cancelled, `settleCancelledIngest` immediately sets phase to `'ready'`, leaving half-ingested nodes without edges, topics, or cluster assignments, which are then saved to IndexedDB.
- **Remediation**: On cancellation, identify any nodes in `graphStore.nodes` with `cluster: -1` (uncommitted / incomplete pass) and clean them up via `removeNodes` and `layoutRemoveNodes`, or trigger a fast fallback link pass.

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

---

### Finding R1-3: Queue Starvation / Deadlock Hazard in `runQueue.ts`
- **File**: `src/pipeline/runQueue.ts`
- **Lines**: 24–42
- **Severity**: **High**
- **Root Cause**: `enqueueRun` does not attach an execution timeout or recovery handler to queued jobs. If a job hangs without settling, the queue deadlocks permanently.
- **Remediation**: Add an optional per-job timeout (defaulting to a safe upper bound, e.g., 5 minutes) that rejects the hung promise and unblocks subsequent queued operations.

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
+  };
   const run = tail.then(start, start);
   tail = run.then(
     () => undefined,
     () => undefined,
   );
   return run;
 }
```

---

### Finding R1-4: Missing Granular Error Boundaries & WebGL Context Loss Recovery
- **Files**: `src/scene/NebulaCanvas.tsx` (lines 110–208), `src/ui/SidePanelReader.tsx` (lines 110–214), `src/App.tsx` (lines 370–432)
- **Severity**: **Medium**
- **Root Cause**: Only a single top-level `AppErrorBoundary` exists. WebGL context loss or preview rendering crashes unmount the whole application.
- **Remediation**:
  1. Add a Canvas-specific error boundary and `webglcontextlost` / `webglcontextrestored` listeners in `NebulaCanvas.tsx`.
  2. Add a `ReaderErrorBoundary` in `SidePanelReader.tsx` falling back to raw text on renderer crash.

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

---

### Finding R1-5: Missing Multi-Tab Storage Event Synchronization
- **Files**: `src/store/settingsStore.ts` (lines 86–110), `src/store/uiStore.ts` (lines 278–281)
- **Severity**: **Medium**
- **Root Cause**: `settingsStore` and `uiStore` persist to `localStorage` but do not listen to `window.addEventListener('storage')`. Edits made in one tab are overwritten by stale values when another tab writes.
- **Remediation**: Listen for `storage` events on `STORAGE_KEY` and `DIMS_KEY` to update in-memory stores reactively.

```diff
--- a/src/store/settingsStore.ts
+++ b/src/store/settingsStore.ts
@@ -108,3 +108,12 @@ useSettingsStore.subscribe((s) => {
     /* private mode / quota exceeded — settings simply won't persist */
   }
 });
+
+if (typeof window !== 'undefined') {
+  window.addEventListener('storage', (e) => {
+    if (e.key === STORAGE_KEY && e.newValue) {
+      useSettingsStore.setState(loadPersistedSettings());
+    }
+  });
+}
```

---

### Finding R1-6: Inefficient Selector in `Toolbar.tsx` for Peer Presence
- **File**: `src/ui/Toolbar.tsx`
- **Lines**: 90–91
- **Severity**: **Low**
- **Root Cause**: `Toolbar` subscribes to `s.peers` object directly. Any remote peer cursor movement creates a new `peers` object and re-renders `Toolbar` 60 times/second.
- **Remediation**: Select peer count with a scalar selector.

```diff
--- a/src/ui/Toolbar.tsx
+++ b/src/ui/Toolbar.tsx
@@ -90,2 +90,1 @@
-  const collabPeers = useCollabStore((s) => s.peers);
-  const remotePeerCount = Object.keys(collabPeers).length;
+  const remotePeerCount = useCollabStore((s) => Object.keys(s.peers).length);
```

---

## 4. Caveats

- **No Caveats**: The entire codebase (`src/store/`, `src/persistence/`, `src/pipeline/`, `src/scene/`, `src/ui/`, `src/workers/`, `src/collab/`) was inspected at line-level without external assumptions. All findings are derived directly from the audited source files.

---

## 5. Conclusion

The state architecture in Document Graph Explorer demonstrates strong core patterns:
- Good separation of heavy array/string payloads into `runtimeStores.ts` outside React/Zustand.
- FIFO serialization of major lifecycle and mutation operations via `runQueue.ts`.
- Clean IndexedDB schema migrations (v1 to v5) and defensive memory management in the worker pools.

However, several critical and high-severity edge cases exist:
1. **Critical Cross-Tab Race Condition**: `saveActiveCorpusPositions` in `corpusRepository.ts` erroneously overwrites newer corpus revisions from concurrent tabs.
2. **High Ingest Cancellation Topology Corruption**: Ingest cancellation leaves unclustered, unlinked ghost nodes in `graphStore` and persists them to disk.
3. **High Queue Starvation Hazard**: `runQueue.ts` lacks watchdog timeout protection, creating a risk of permanent app-wide pipeline freeze if an operation hangs.
4. **Medium Resilience Gap**: Lack of localized error boundaries around Canvas and Document Preview renderers causes whole-app crashes on isolated errors.

Implementing the targeted, zero-new-dependency diffs detailed above will harden the application's state architecture and multi-tab lifecycle safety.

---

## 6. Verification Method

To independently verify these findings and confirm baseline stability:

```bash
# 1. Typecheck validation
npm run typecheck

# 2. Linting verification
npm run lint

# 3. Unit and integration test suite execution
npm test

# 4. Production build verification
npm run build
```

Specific files to inspect for verification:
- `src/persistence/corpusRepository.ts:237-263` (`saveActiveCorpusPositions` logic)
- `src/pipeline/coordinator.ts:1316-1330` (`settleCancelledIngest` cleanup)
- `src/pipeline/runQueue.ts:24-42` (`enqueueRun` queue loop)
- `src/ui/Toolbar.tsx:90-91` (`collabPeers` selector subscription)
- `src/scene/NebulaCanvas.tsx:110-208` (Canvas event handlers)
