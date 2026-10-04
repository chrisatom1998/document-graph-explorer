# Requirement R1: Architecture, Code Quality & State Management Audit
**Document Graph Explorer ("Knowledge Nebula")**
**Audit Date:** 2026-08-17
**Auditor:** Teamwork Explorer R1 (State Management & Architecture Specialist)

---

## 1. Executive Summary

A comprehensive architectural, code quality, and state management audit was conducted on the Document Graph Explorer codebase. The application is a client-side React 19 + Vite + React Three Fiber single-page application that runs completely in-browser without a dedicated backend server. All compute-heavy operations (file parsing, tokenization, embeddings inference, layout physics, community detection, graph insights) are offloaded to dedicated Web Workers and WebAssembly/TensorFlow modules, with persistence backed by IndexedDB (`idb` v8) and localStorage, and peer-to-peer collaboration enabled via Yjs and WebRTC.

### Key Architectural Strengths
- **Clean Worker Subsystem Boundaries:** Strict message protocols (`PoolRequest`/`PoolResponse`, `AggRequest`/`AggResponse`, `LayoutRequest`/`LayoutResponse`, `InsightsRequest`/`InsightsResponse`) defined in `src/model/types.ts`.
- **Zero-Copy Memory Architecture:** Heavy full text and `Float32Array` chunk vectors are deliberately stored in non-reactive JS `Map` objects (`src/store/runtimeStores.ts`) outside React/Zustand, avoiding costly reactivity proxies and React re-render cascades.
- **Differential Persistence & Memory Protection:** Ingestion and auto-save utilize dirty-set tracking (`dirtyDocIds`) to persist only modified documents, avoiding hundreds of megabytes of structured-clone overhead during auto-saves.
- **Strict Execution Serialization:** A centralized promise-chain run queue (`src/pipeline/runQueue.ts`) serializes all mutating operations (ingests, corpus switches, snapshot restores, JSON imports), eliminating concurrent graph corruption.
- **High Baseline Type Safety:** `tsconfig.json` has `strict: true` with all pedantic compiler options enabled; `npm run typecheck` and `npm run lint` pass with 0 errors/warnings across 179 test files (1,182 unit/integration tests).

### Key Architectural Vulnerabilities & Technical Debt
1. **Monolithic God Components & Stores:**
   - `src/ui/Toolbar.tsx` (620 lines, 29 separate Zustand selector hooks, 5 nested popover menus).
   - `src/ui/SettingsPanel.tsx` (750 lines, 45 selector hooks and local state declarations).
   - `src/collab/store.ts` (1,025 lines mixing Yjs lifecycle, WebRTC awareness, 2D/3D camera remapping, and CRDT map sync).
   - `src/store/uiStore.ts` (281 lines mixing modal visibility, selection, camera commands, filters, and pathfinding).
2. **Multi-Tab IndexedDB Write Concurrency Gaps:**
   - No cross-tab concurrency lock (e.g., `navigator.locks`) exists; concurrent writes from multiple browser tabs editing the same corpus can race in IndexedDB.
3. **Defensive Gaps in Ephemeral vs Local Graph Persistence:**
   - `sessionSave.ts` (`saveGraphRecord` and `saveSession`) lacks an explicit check for `useCorpusStore.getState().mode === local`, relying solely on `!state.corpusHash`. If an imported or shared graph acquires a hash, `corpusRepository.ts:saveActiveCorpusPositions` will create an unintended corpus record.
4. **Domain Model Circular Dependency:**
   - `src/model/types.ts` imports calculation shapes from `src/graph/clusterStats.ts` and `src/graph/insights.ts`, which in turn import domain entities from `src/model/types.ts`.
5. **Disabled Strict ESLint Rules:**
   - `@typescript-eslint/no-explicit-any` and `@typescript-eslint/ban-ts-comment` are explicitly turned off in `eslint.config.js`.

---

## 2. State Management Architecture & Store Slicing Audit

The application leverages Zustand 5 (`zustand@^5.0.14`) partitioned across several distinct stores:

| Store Name | File Path | Lines | Responsibilities | Modularity Assessment |
|---|---|---|---|---|
| `useGraphStore` | `src/store/graphStore.ts` | 205 | `nodes`, `edges`, `clusterNames`, `phase`, `fileStatuses`, `enrichProgress`, `ingestReport`, `duplicatePairs` | **Mixed Concerns:** Blends persistent graph topology with high-frequency ingest telemetry. |
| `useUiStore` | `src/store/uiStore.ts` | 281 | Selection, modal dialogs, search overlay, graph filters, camera commands, 2D/3D dims, quality tiers, toasts, pathfinding | **Monolithic God Store:** 23 fields + 25 actions spanning 7 unrelated UI domains. |
| `useCorpusStore` | `src/store/corpusStore.ts` | 54 | Active corpus ID/name, mode (`local`/`shared`/`imported`), corpus registry summary list | **High:** Clean, single responsibility. |
| `useAnnotationStore` | `src/store/annotationStore.ts` | 264 | Document notes, tags, pins, debounced per-key persistence, dirty generation tracking | **Good, but Module Singleton Debt:** Uses module-level state variables outside store. |
| `useSettingsStore` | `src/store/settingsStore.ts` | 110 | AI providers, model IDs, API keys, OCR config, embedding cache policy | **High:** Persistence and migrations cleanly delegated to `settingsMigration.ts`. |
| `useChatStore` | `src/store/chatStore.ts` | 84 | In-memory chat messages, streaming state, citation metadata | **High:** Ephemeral in-memory transcript with ID deduplication. |
| `useFolderWatchStore` | `src/store/folderWatchStore.ts` | 29 | Directory sync status, watched folder name, sync timestamps | **High:** Compact, focused status store. |
| `useCollabStore` | `src/collab/store.ts` | 1,025 | Yjs document lifecycle, WebRTC awareness, remote camera anchor remapping, CRDT notes sync | **Monolithic & Overcoupled:** Heavy math, networking, and CRDT observation in one file. |
| `runtimeStores` | `src/store/runtimeStores.ts` | 58 | `textStore`, `chunkStore`, `docVectorStore`, `mdLinkTargetsStore`, `docLinksStore`, `dirtyDocIds` | **Excellent High-Performance Design:** Raw JS Maps/Sets avoiding React overhead. |

### In-Depth Findings: Store Slicing & Reactivity

#### 1. Ingest Telemetry Polluting Graph Domain Store (`graphStore.ts`)
- **Citation:** `src/store/graphStore.ts:13-28`
```ts
interface GraphState {
  nodes: DocNode[];
  nodeIndex: Record<string, number>;
  edges: Edge[];
  clusterNames: Record<number, string>;
  phase: PipelinePhase;
  fileStatuses: Record<string, FileStatus>;
  ignoredFiles: { name: string; reason: string }[];
  modelProgress: PipelineTaskProgress | null;
  enrichProgress: { done: number; total: number; note: string } | null;
  ingestReport: IngestReport | null;
  corpusHash: string | null;
  duplicatePairs: DuplicatePair[];
  semanticNeighbors: SemanticNeighbor[];
  successfulIngestCount: number;
  localClusterNames: Record<number, string>;
  ...
}
```
- **Issue:** During large file batch ingestion, `setFileStatus` and `setFileStatuses` mutate `fileStatuses` at dozens of times per second. Any component subscribing to `useGraphStore` with non-primitive selectors or without fine-grained selectors re-evaluates frequently.
- **Recommendation:** Split `graphStore.ts` into two stores:
  1. `useGraphStore` (persistent graph domain model: `nodes`, `nodeIndex`, `edges`, `clusterNames`, `corpusHash`, `duplicatePairs`, `semanticNeighbors`).
  2. `useIngestProgressStore` (ephemeral pipeline execution telemetry: `phase`, `fileStatuses`, `modelProgress`, `enrichProgress`, `ignoredFiles`, `ingestReport`).

#### 2. Monolithic `uiStore.ts` God Store
- **Citation:** `src/store/uiStore.ts:105-168`
- **Issue:** `uiStore` manages 23 distinct state fields covering 8 distinct UI sub-domains:
  1. Node selection & hover (`selectedId`, `hoveredId`, `pendingFocus`, `readerHighlight`)
  2. Modal & Drawer toggles (`settingsOpen`, `insightsOpen`, `insightsFocus`, `snapshotsOpen`, `helpOpen`, `searchOpen`)
  3. View configuration & quality tiers (`dims`, `flatEdgeDetail`, `topicNodesEnabled`, `clusterCollapsed`, `qualityTier`, `autoQuality`)
  4. Camera commands (`cameraCommand`)
  5. Search highlight ownership (`searchResults`, `highlightOwner`)
  6. Graph filtering & overlays (`filter`, `snapshotOverlay`)
  7. Path route mode (`pathMode`, `pathEndpoints`)
  8. Toast notifications & errors (`toasts`, `lastError`)
- **Recommendation:** Refactor `uiStore.ts` using Zustand store slicing pattern into modular slices (`createSelectionSlice`, `createViewSlice`, `createModalSlice`, `createSearchSlice`, `createPathSlice`, `createToastSlice`).

#### 3. Module-Level State Variables in `annotationStore.ts` and `chatHistorySync.ts`
- **Citation:** `src/store/annotationStore.ts:96-105`, `src/persistence/chatHistorySync.ts:26-30`
- **Issue:** `annotationStore.ts` maintains 8 module-level variables (`loadingScope`, `dirty`, `dirtyScope`, `editGeneration`, `debounceTimer`, `retryTimer`, `failureToastShown`, `lifecycleArmed`). `chatHistorySync.ts` maintains 5 module-level variables. While this keeps the Zustand state pure and avoids unnecessary component re-renders, it introduces hidden global state singletons that require manual reset test seams (`_resetAnnotationsForTests()`, `_resetChatHistorySyncForTests()`).
- **Recommendation:** Encapsulate persistence sync controllers into stateful service classes (e.g. `AnnotationSyncService` and `ChatSyncService`) instantiated with clear lifecycles.

---

## 3. Persistence & Concurrency Subsystem Audit

Persistence is handled by IndexedDB (`idb` v8) in database `knowledge-nebula` (schema v5) and localStorage.

### Database Schema Structure (`src/persistence/db.ts:151-164`)

```ts
export interface NebulaDB extends DBSchema {
  documents: { key: string; value: DocumentRecord };
  embeddings: { key: string; value: EmbeddingRecord };
  graphs: { key: string; value: GraphRecord };
  settings: { key: string; value: unknown };
  snapshots: { key: number; value: SnapshotRecord; indexes: { "by-savedAt": number } };
  originals: { key: string; value: OriginalFileRecord };
  chats: { key: string; value: ChatRecord };
  corpora: { key: string; value: CorpusRecord; indexes: { "by-updatedAt": number } };
}
```

### Strengths & Rigor
1. **Native Float32Array Binary Storage:** Vectors are stored directly as `Float32Array` in IndexedDB without base64 serialization, hitting sub-3-second startup restore benchmarks for corpora up to thousands of documents.
2. **Schema Sanitization at Trust Boundaries:** `src/persistence/validateImport.ts:sanitizeGraphExport` validates every incoming document and edge, clamping string lengths, checking finite numbers, and discarding dangling edges that would crash `d3-force-3d` or React Three Fiber.
3. **Execution Serialization:** All state-modifying operations are funneled through `enqueueRun` in `src/pipeline/runQueue.ts`.

### Persistence Gaps & Technical Debt

#### 1. Multi-Tab Write Race Hazard (Lack of Web Locks)
- **Citation:** `src/persistence/corpusRepository.ts:84-100`, `src/persistence/sessionSave.ts:46-85`
- **Issue:** IndexedDB transactions within a single tab are transactional, but across multiple browser tabs open to the same corpus, there is no cross-tab mutual exclusion. If Tab A runs an ingest while Tab B edits annotations or restores a snapshot, both tabs will write to the same IndexedDB corpus record concurrently without distributed locking.
- **Recommendation:** Implement the Web Locks API (`navigator.locks.request("knowledge-nebula-corpus-" + corpusId, ...)`) with fallback for older browsers to ensure single-writer exclusivity across browser tabs.

#### 2. Ephemeral vs Local Graph Persistence Defensiveness
- **Citation:** `src/persistence/sessionSave.ts:31-43`, `src/persistence/corpusRepository.ts:237-263`
- **Issue:** When viewing an imported or shared graph (`mode === "imported"` or `mode === "shared"`), `activeCorpusId` is `null`. In `sessionSave.ts`, `saveGraphRecord` checks `if (state.phase !== "ready" || !state.corpusHash || state.nodes.length === 0) return;`. If an imported graph has or acquires a `corpusHash`, `saveActiveCorpusPositions` in `corpusRepository.ts` executes:
```ts
const activeId = useCorpusStore.getState().activeCorpusId;
if (!activeId) {
  await saveActiveCorpusSnapshot(corpusHash, exportData, positions);
  return;
}
```
Which calls `emptyRecord(...)` and creates an unintended persistent corpus record in IndexedDB for an ephemeral session!
- **Recommendation:** Add an explicit guard in `sessionSave.ts`:
```ts
if (useCorpusStore.getState().mode !== "local") return;
```

#### 3. Synchronous LocalStorage Subscriptions
- **Citation:** `src/store/settingsStore.ts:86-109`, `src/store/uiStore.ts:278-280`
- **Issue:** `useSettingsStore.subscribe` and `useUiStore.subscribe` execute synchronous `localStorage.setItem` on every state change. During rapid UI interactions (e.g. dragging sliders or rapid toggle clicking), this causes synchronous main-thread storage I/O.
- **Recommendation:** Debounce localStorage writes or use a microtask-deferred persistence batcher.

---

## 4. Yjs & Real-Time Collaboration Subsystem Audit

Collaboration is implemented using Yjs (`yjs@^13.6.32`) and `y-webrtc` in `src/collab/`.

### Strengths
- **Airgap & Offline Compliance:** `src/collab/session.ts` explicitly verifies `AIRGAP` and `isOffline()` before creating sessions, passing empty `iceServers: []` to prevent contacting external STUN/TURN servers.
- **Consent-Before-Join Flow:** `src/collab/AppBridge.tsx` gates invite joining behind an explicit user confirmation modal (`collabJoinDisclosure`) before connecting to the signaling server.
- **Camera Anchor Remapping:** `src/collab/store.ts:224-255` translates remote camera coordinates to local cluster centroid anchors, ensuring participants on different screen sizes/aspect ratios maintain consistent view framing.

### Vulnerabilities & Code Quality Issues

#### 1. Collab Store Monolith (`src/collab/store.ts`)
- **Citation:** `src/collab/store.ts:1-1025`
- **Issue:** At 1,025 lines, `collab/store.ts` is the second largest source file in the repository. It mixes:
  1. WebRTC provider creation & awareness polling (lines 67-84, 804-845)
  2. 3D Camera pose projection and anchor centroid calculations (lines 158-255, 500-575)
  3. Layout simulation settle synchronization via `onLayoutSettled` (lines 467-486, 546-557)
  4. Bidirectional annotation CRDT syncing with generation checks (lines 687-781)
  5. Local state publishing & remote view sanitization (lines 321-421, 610-681)
- **Recommendation:** Decompose `src/collab/` into dedicated modules:
  - `src/collab/collabSessionService.ts` (session management & provider lifecycle)
  - `src/collab/cameraSync.ts` (anchor math, camera pose remapping, settle listeners)
  - `src/collab/annotationSync.ts` (Y.Map annotation CRDT observation & bridge)
  - `src/collab/store.ts` (pure Zustand state for UI consumption)

#### 2. Explicit `any` Typing in Collab Session
- **Citation:** `src/collab/session.ts:38, 108`
```ts
export interface CollabSession {
  doc: Y.Doc;
  provider: WebrtcProvider | null;
  view: Y.Map<any>;
  ...
}
const view = doc.getMap<any>("view");
```
- **Issue:** Yjs shared map `view` is typed as `Y.Map<any>`, bypassing TypeScript checks when getting and setting shared view properties.
- **Recommendation:** Type the map explicitly with `Y.Map<CollabSharedView[keyof CollabSharedView]>` or a dedicated union of supported CRDT primitives.

#### 3. Unbounded Key Mapping Cache in Annotation Sync
- **Citation:** `src/collab/store.ts:701-719`
- **Issue:** `mappedKeys` (`new Map<string, string>()`) permanently caches local-to-shared annotation keys during an active session without eviction when nodes are deleted or replaced.
- **Recommendation:** Clear or re-index `mappedKeys` when corpus nodes change.

---

## 5. TypeScript Type Safety & Compiler Strictness Audit

### Compiler Configuration Evaluation (`tsconfig.json`)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitOverride": true,
    "types": ["vite/client"]
  }
}
```
**Rating: Excellent.** Strict null checks, unused parameters/locals, and implicit overrides are all enforced.

### ESLint Rules Analysis (`eslint.config.js`)
- **Citation:** `eslint.config.js:60-65`
```js
"@typescript-eslint/no-unused-vars": "off",
"@typescript-eslint/no-explicit-any": "off",
"@typescript-eslint/ban-ts-comment": "off",
"@typescript-eslint/no-floating-promises": "error",
```
- **Strengths:** `@typescript-eslint/no-floating-promises: "error"` is active and backed by `projectService: true`, preventing unhandled async rejections across worker and storage calls.
- **Weakness:** `no-explicit-any` and `ban-ts-comment` are disabled, allowing unchecked `any` or `@ts-expect-error` directives to creep into new code without compiler warnings.

### Codebase Type Quality Survey
1. **Non-Null Assertions (`!`):**
   - `src/persistence/cache.ts:100, 102` (`emb!.chunkVectors`, `emb!.docVector`)
   - `src/persistence/session.ts:216, 222` (`emb!.chunkVectors`, `emb!.docVector`)
   - `src/persistence/cache.ts:374` (`id: r.id!`)
   - `src/store/graphStore.ts:200, 201` (`adj.get(e.source)!.add(e.target)`)
   - `src/pipeline/links.ts:296` (`pattern.rx!.test(textLower)`)
   - `src/ui/passageHighlight.ts:160` (`target.parentNode!.insertBefore(mark, target)`)
   *Evaluation:* The majority are well-guarded by preceding existence checks, but replacing them with explicit type guards or optional chaining would eliminate all non-null assertions.
2. **`@ts-expect-error` Directives:**
   - `src/scene/ClusterCollapse.tsx:323, 326` (due to ThreeEvent event typing discrepancy in R3F).
   - `src/tools/serveHelpers.test.ts:3, 6` (testing plain Node scripts without .d.ts).
   *Evaluation:* Acceptable and localized to specific external typing boundaries.

---

## 6. Code Modularity, Coupling & Dependency Topology

### 1. Inverted Domain Model Dependency Cycle
- **Citation:** `src/model/types.ts:7-8`, `src/graph/clusterStats.ts:6`, `src/graph/insights.ts:12`
- **Dependency Flow:**
  `src/model/types.ts` ➔ `src/graph/clusterStats.ts` ➔ `src/graph/insights.ts` ➔ `src/model/types.ts`
- **Analysis:** Lines 3-6 of `src/model/types.ts` document this with:
  *"Type-only imports of insight result shapes (erased at compile time, so the graph-module → types → graph-module cycle never exists at runtime)"*.
  While type erasure prevents a runtime bundle crash, this is a conceptual architectural cycle. Leaf analytics functions (`clusterStats`, `insights`) define data transfer interfaces that the root core domain model (`model/types.ts`) imports.
- **Remediation:** Move `BridgeDoc`, `HubDoc`, and `ClusterStat` interface declarations into `src/model/types.ts` (or a new `src/model/insights.ts`), and have `src/graph/insights.ts` and `src/graph/clusterStats.ts` import them from the model layer.

### 2. Coordinator Orchestrator Monolith (`src/pipeline/coordinator.ts`)
- **Citation:** `src/pipeline/coordinator.ts:1-1612` (1,612 lines)
- **Analysis:** `coordinator.ts` is the largest file in the codebase. It orchestrates:
  1. File routing & text sniffing
  2. PDF / OCR fallback parsing
  3. Worker pool embedder dispatch & batching
  4. Aggregator worker communication & timeout management
  5. Ingest gesture / birth origin animations
  6. Persistence caching of documents, originals, and graph records
  7. GraphStore and RuntimeStore mutations
  8. Incremental similarity indexing & community clustering
- **Remediation:** Extract distinct pipeline sub-phases into focused orchestrator modules:
  - `src/pipeline/aggregatorClient.ts` (dedicated aggregator worker client and timeout lifecycle)
  - `src/pipeline/parseStage.ts` (parsing, sniffing, PDF/OCR coordination)
  - `src/pipeline/embedStage.ts` (embedding batching, query embedding)
  - `src/pipeline/coordinator.ts` (top-level state machine orchestrating stages)

### 3. Component Monoliths in UI Layer
- **Toolbar Monolith (`src/ui/Toolbar.tsx` - 620 lines):** Combines 5 popover menus and 29 store selectors.
- **SettingsPanel Monolith (`src/ui/SettingsPanel.tsx` - 750 lines):** Combines AI model catalogs, OCR options, storage clear actions, and diagnostic logging with 45 state/hook subscriptions.
- **Remediation:** Break into subcomponents matching existing patterns in `SidePanel` (which cleanly delegates to `SidePanelHeader`, `SidePanelAbout`, `SidePanelConnections`, `SidePanelReader`).

---

## 7. Prioritized Findings Catalog

| ID | Title | Subsystem | Severity | Effort | File & Line Citations | Expected Benefit |
|---|---|---|---|---|---|---|
| **R1-01** | Multi-Tab IndexedDB Write Concurrency Hazard | Persistence | **High** | Medium | `src/persistence/corpusRepository.ts:84-100`, `src/persistence/sessionSave.ts:46-85` | Prevents silent data overwrites when multiple tabs edit the same workspace concurrently. |
| **R1-02** | Ephemeral Mode Persistence Guard Gap | Persistence | **High** | Low | `src/persistence/sessionSave.ts:31-43`, `src/persistence/corpusRepository.ts:237-263` | Eliminates unintended corpus record creation when viewing shared/imported graphs. |
| **R1-03** | Ingest Telemetry Polluting Graph Domain Store | State Mgmt | **Medium** | Medium | `src/store/graphStore.ts:13-28` | Decouples high-frequency ingest rendering from core 3D graph/scene consumers. |
| **R1-04** | Monolithic `uiStore.ts` God Store | State Mgmt | **Medium** | Medium | `src/store/uiStore.ts:105-168` | Improves code organization, test isolation, and prevents unnecessary component re-renders. |
| **R1-05** | Monolithic `collab/store.ts` File | Collaboration | **Medium** | Medium | `src/collab/store.ts:1-1025` | Decouples networking, 3D math, layout settlement, and CRDT sync into testable modules. |
| **R1-06** | Inverted Domain Model Type Dependency Cycle | Architecture | **Low** | Low | `src/model/types.ts:7-8`, `src/graph/clusterStats.ts:6`, `src/graph/insights.ts:12` | Eliminates conceptual circular dependency between model types and graph modules. |
| **R1-07** | Pipeline Coordinator Monolith Decomposition | Pipeline | **Medium** | High | `src/pipeline/coordinator.ts:1-1612` | Improves maintainability, testability, and separation of concern across ingest stages. |
| **R1-08** | UI Component Monoliths Decomposition | UI/UX | **Low** | Medium | `src/ui/Toolbar.tsx:1-620`, `src/ui/SettingsPanel.tsx:1-750` | Reduces component re-render scope and simplifies UI test suites. |
| **R1-09** | Explicit `any` Typing in Collab Session Map | TypeScript | **Low** | Low | `src/collab/session.ts:38, 108` | Closes type safety hole in shared CRDT view synchronization. |
| **R1-10** | Synchronous LocalStorage Subscriptions | State Mgmt | **Low** | Low | `src/store/settingsStore.ts:86-109`, `src/store/uiStore.ts:278-280` | Prevents main-thread micro-stutter during rapid slider adjustments. |

---

## 8. Phased Execution & Architectural Remediation Roadmap

### Phase 1: Immediate Quick Wins & Defensive Hardening (Low Effort, High/Medium Impact)
1. **R1-02 (Defensive Mode Guard):** Add explicit `if (useCorpusStore.getState().mode !== "local") return;` guards in `sessionSave.ts` (`saveGraphRecord` and `saveSession`).
2. **R1-06 (Domain Type Inversion Fix):** Move `BridgeDoc`, `HubDoc`, and `ClusterStat` into `src/model/types.ts`, eliminating the type cycle.
3. **R1-09 (Collab Map Typing):** Replace `Y.Map<any>` with strongly-typed generic map in `src/collab/session.ts`.
4. **R1-10 (LocalStorage Debounce):** Debounce localStorage persistence in `settingsStore.ts` and `uiStore.ts`.

### Phase 2: State Management & Store Slicing Refactor (Medium Effort, High Value)
1. **R1-03 (Split Ingest Progress from Graph Store):** Create `useIngestProgressStore` for `fileStatuses`, `modelProgress`, `enrichProgress`, `ignoredFiles`, and `ingestReport`. Keep `useGraphStore` purely for graph topology.
2. **R1-04 (Slice `uiStore`):** Modularize `uiStore` into composable slices (`selectionSlice`, `viewSlice`, `modalSlice`, `searchSlice`, `pathSlice`, `toastSlice`).
3. **R1-01 (Web Locks API for Multi-Tab Concurrency):** Integrate `navigator.locks.request` around destructive IndexedDB mutations and session saves.

### Phase 3: Monolith Decomposition & Architectural Decoupling (Higher Effort, Long-Term Health)
1. **R1-05 (Decompose Collab Store):** Separate `src/collab/store.ts` into `collabSessionService.ts`, `cameraSync.ts`, `annotationSync.ts`, and `store.ts`.
2. **R1-08 (UI Component Decomposition):** Break `Toolbar.tsx` into separate menu components (`ViewMenu`, `AnalyzeMenu`, `DataMenu`, `AddMenu`, `CollabMenu`) and `SettingsPanel.tsx` into section subcomponents (`AiSettingsSection`, `StorageSettingsSection`, `OcrSettingsSection`, `DiagnosticsSection`).
3. **R1-07 (Coordinator Modularization):** Extract `aggregatorClient.ts`, `parseStage.ts`, and `embedStage.ts` from `coordinator.ts`.

---

## 9. Verification & Evidence Summary

- **TypeScript Typecheck:** `npm run typecheck` (`tsc --noEmit`) executed cleanly with 0 errors.
- **ESLint Linting:** `npm run lint` (`eslint .`) executed cleanly with 0 errors.
- **Test Suite Execution:** `npm test` (`vitest run`) ran 179 test suites containing 1,183 tests (1,182 passed, 1 skipped) with 100% pass rate in 20.66s.
