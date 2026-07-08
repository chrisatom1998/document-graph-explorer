# Document Graph Explorer — Improvement Implementation Plan (Phases B–E)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-07-06 · **Author:** Claude (research-verified against the working tree at commit `e3c8d61`, updated for `2450ec3`) · **Roadmap:** `docs/superpowers/specs/2026-07-05-consolidated-roadmap.md` items 10–25

**Goal:** Implement the four remaining improvement phases — B (run-lifecycle robustness), C (graph quality), D (reach: accessibility, bundle, quota), and E (product depth) — as sixteen independently shippable tasks, each grounded in verified code anchors.

**Architecture:** All work extends the existing client-only architecture: pipeline logic in web workers coordinated by `src/pipeline/coordinator.ts`, pure algorithm modules with colocated tests, Zustand stores for reactive state, plain module Maps for heavy runtime data, IndexedDB (`knowledge-nebula`, v3) for persistence, and the airgap/CSP gates enforced by CI. No servers, no telemetry, no new external hosts.

**Tech Stack:** React 19, TypeScript (strict, `tsc --noEmit` gates the build), Zustand 5, Vite 7, Vitest 4 (node env default; jsdom per-file via pragma), three.js 0.185.1 (pinned), graphology 0.26, idb 8, self-hosted MiniLM via `@huggingface/transformers`.

## Where the codebase stands today

Committed on branch `quickwins-phase-p` @ `2450ec3` (v1.0.0) — **not yet merged to `main`** (`main` tip is `1d0cbf3`; the branch is 8 commits ahead, 0 behind):

- **Phase A** (roadmap items 1–5): document removal UI, layout-worker respawn, emphasis/edge-weight fix (`src/scene/emphasis.ts`), high-risk pure-fn tests, `no-floating-promises` lint.
- **Phase 1–2 of the improvement program:** CI (`.github/workflows/ci.yml`: lint → typecheck → test → build → build:airgap), SECURITY.md, local extractive chat (`src/chat/extractiveAnswer.ts`), jsdom component-test harness.
- **Phase P (productionization, all 7 tasks):** XSS/escaping tests for the document viewer, toolbar **Data** menu (export/import/PNG, `src/ui/ExportImportMenu.tsx`), docs truth-sync, repo hygiene, **error containment** (`src/ui/AppErrorBoundary.tsx`, `src/util/globalErrors.ts`, `uiStore.lastError`, `pool.onWorkerCrash`), **diagnostics About panel** (`__APP_VERSION__`, `src/ui/diagnostics.ts`), **release engineering** (LICENSE, CHANGELOG.md, DEPLOYMENT.md, `release.yml`, version 1.0.0).

Remaining approved work is exactly Phases B, C, D, E — this plan.

**Task 0 — precondition (process constraint, roadmap line 7):** complete the Phase P whole-branch review and **merge `quickwins-phase-p` into `main`** before starting B1. Every phase branch below forks from that merged `main` — branching from the unmerged main would build on a tree missing every Phase-P change (including the `coordinator.ts`, `uiStore.ts`, and `pool.ts` code this plan anchors to).

> **Anchor caveat:** every `file:line` in this plan was verified on 2026-07-06 against `2450ec3` (an adversarial verification pass re-checked ~230 claims and the corrections are folded in). Note `src/pipeline/coordinator.ts` gained the `onWorkerCrash` wiring in `428f9be` — anchors below its line ~172 sit ~9–10 lines lower than in older docs (`runChain` :903, `ingestFiles` :905, `removeDocuments` :921, `runIngest` :253, `resetCorpus` :982). Anchor by the cited identifier, not the raw number. **Before starting any task, run `git log --oneline -5` — this repo has had concurrent sessions land work mid-plan before.**

## Global Constraints (bind every task)

- **Airgap gates intact:** `npm run build:airgap` (tsc → vite `--mode airgap` → `scripts/sanitize-airgap.mjs` → `scripts/verify-airgap.mjs`) must stay green. The verify gate rejects any `connect-src` token outside `{'self','none',blob:,data:}` and any `scheme://` substring anywhere in the CSP. New ML/wasm assets must be self-hosted under `public/` (the `/models/` MiniLM pattern).
- **No telemetry, ever. No new runtime dependency may add an external host.** The only permitted external host in normal builds is `https://generativelanguage.googleapis.com` (Gemini, opt-in).
- **Storage slugs are load-bearing — never rename:** localStorage `knowledge-nebula-settings` (`settingsStore.ts`) and `knowledge-nebula-toolbar-pos` (`Toolbar.tsx`); IndexedDB DB `knowledge-nebula` v3 with stores `documents`/`embeddings`/`graphs`/`settings`/`snapshots`/`originals` (`src/persistence/db.ts:18`); export marker `generator: 'knowledge-nebula'` (`src/model/types.ts:64`). Schema changes require a `DB_VERSION` bump plus an `if (oldVersion < N)` upgrade block in `getDb()`.
- **Every network/AI path gates on `isOffline()`** (`src/offline.ts:13` = `AIRGAP || settingsStore.offlineMode`); refusal copy follows `AIRGAP ? AIRGAP_MESSAGE : OFFLINE_MESSAGE`. The runtime fetch guard rejects cross-origin fetches with a `TypeError` while offline — an ungated call becomes an unhandled rejection.
- **Test conventions:** Vitest default env is **node** (`vite.config.ts` `test:` block); DOM tests need `// @vitest-environment jsdom` as line 1, manual `cleanup()` in `afterEach` (no global setup file), and hoisted `vi.mock('../pipeline/coordinator', () => ({ <exactExports>: vi.fn() }))` before the component import. Airgap behavior is forced via `vi.mock('../airgap', () => ({ AIRGAP: true, ... }))`, never by mutating the constant. No-network tests assert `vi.spyOn(globalThis, 'fetch')` uncalled.
- **Lint/type gates:** `@typescript-eslint/no-floating-promises` is an *error* (use `void expr` deliberately); `noUnusedLocals`/`noUnusedParameters` fail the **build** (tsc runs inside `npm run build`).
- **Tunables live in `src/config.ts`** with a section comment; new thresholds go there.
- **Style:** one global stylesheet `src/styles.css`, className-based; inline stroke SVG icons only (no icon library); console diagnostics prefixed `[knowledge-nebula]`.
- **Per-task exit protocol:** `npm run lint && npm run typecheck && npm test && npm run build && npm run build:airgap` all green → commit `type(scope): lowercase imperative subject` with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. One branch per phase (`feat/phase-b-lifecycle`, etc.), merged to `main` after a whole-branch review.

---

## Phase B — Run-lifecycle robustness (roadmap items 10–13)

The pipeline serializes ingest and removal through a module-level promise chain, but enrichment bypasses it; the coordinator has grown to 990 lines; a running ingest cannot be cancelled; and per-file failures die with the tab. Order is mandated: **B2 (split) must land before B3 (cancellation)** — the roadmap says so, and the split isolates the state cancellation must touch.

### Task B1: Serialize enrichment through the run chain (item 10)

**Files:**
- Modify: `src/pipeline/coordinator.ts` (run-chain section, lines 893–934)
- Modify: `src/enrich/gemini.ts` (`runEnrichment`, line 496)
- Modify: `src/ui/SettingsPanel.tsx` (`onEnrichNow`, ~line 132)
- Test: `src/pipeline/runQueue.test.ts` (new)

**Current behavior (verified):** `runChain: Promise<void>` at `coordinator.ts:903` serializes `ingestFiles` (line 905) and `removeDocuments` (line 921): each chains `runChain.then(() => work())`, swallows the rejection inside the chain link so the chain never wedges, and returns the un-swallowed promise to the caller. `runEnrichment` (`gemini.ts:496`) is **not** on the chain — its only guards are `isOffline()`, key/enable checks, `phase !== 'ready'` (line 510), and a module-level `running` flag (line 494). While enrichment is in flight the chain is free, so a file drop starts `runIngest` **concurrently**: both sides mutate `phase` and `patchNodes`, and enrichment's `finally` unconditionally does `setPhase('ready')` (line 591) — which mid-ingest hides the ProgressStrip and (via the `session.ts:118-141` phase subscriber) schedules a debounced `saveSession` of a half-built graph. The reverse direction is *mostly* blocked by enrichment's phase guard — a window remains during ingest steps (a)–(c) before `setPhase('parsing')` fires (and for all-cache-hit drops, which never leave `'ready'`); routing enrichment through the chain closes it completely.

**Interfaces:**
- Produces: `export function enqueueExclusive(label: string, work: () => Promise<void>): Promise<void>` from `src/pipeline/coordinator.ts` — B3 and any future corpus-mutating entry point must use it.
- Import direction is safe: `gemini.ts` may statically import from `coordinator.ts` (coordinator imports nothing from gemini — verified; keep it that way).

**Steps:**

- [ ] **Step 1 — Extract the chain into a named helper (no behavior change).** In `coordinator.ts`, replace the duplicated chaining code in `ingestFiles`/`removeDocuments` with:

```ts
/** Queue corpus-exclusive work behind any in-flight run. The chain link
 *  swallows rejections (so it never wedges); callers still see them. */
export function enqueueExclusive(label: string, work: () => Promise<void>): Promise<void> {
  const run = runChain.then(() => work());
  runChain = run.then(
    () => undefined,
    (err) => { console.error(`[knowledge-nebula] ${label} run failed`, err); },
  );
  return run;
}
```

`ingestFiles` becomes `return enqueueExclusive('ingest', () => runIngest(files));`. `removeDocuments` keeps its pre-resolved label + failure toast (lines 915–931) around the same call.

- [ ] **Step 2 — Write the failing ordering test** (`runQueue.test.ts`, node env): two deferred works enqueued back-to-back run strictly sequentially; a rejecting first work does not prevent the second from running; the caller of the first receives the rejection. Use manually-resolved promises, no timers.

- [ ] **Step 3 — Route `runEnrichment` through the chain.** In `gemini.ts`, wrap the body: the exported `runEnrichment` becomes a thin shell that keeps the cheap pre-checks that give instant UX feedback (offline / no key / enrichment disabled), then returns `enqueueExclusive('enrichment', () => runEnrichmentInner())`. **Critical:** the `docs` snapshot (line 506), the `docs.length === 0` check, the `phase !== 'ready'` guard (line 510), and the `running` flag must all be evaluated *inside* the queued task — at dequeue time the ingest that was ahead in the queue has finished and `phase` is `'ready'`, so the guard now passes instead of racing.

- [ ] **Step 4 — Queued-state UX.** `SettingsPanel.onEnrichNow` sets `enrichBusy` immediately (line 134) even though the work may wait behind a long ingest. Add a transient note using the panel's existing `clearNote`-style pattern: when the button is clicked while `phase !== 'ready'`, show "Queued — starts when current processing finishes."

- [ ] **Step 5 — Verify & commit.** Full gate suite; manually confirm in `npm run dev`: start a large drop, click *Enrich now* mid-ingest → enrichment starts only after the graph reaches ready, ProgressStrip never disappears early. Commit: `fix(enrich): serialize enrichment through the run chain`.

### Task B2: Split coordinator.ts (item 11 — must precede B3)

**Files:**
- Create: `src/pipeline/aggregatorClient.ts`, `src/pipeline/runShared.ts`, `src/pipeline/removal.ts`, `src/pipeline/topicSynthesis.ts`
- Modify: `src/pipeline/coordinator.ts` (becomes the ingest flow + public façade)

**Current behavior (verified):** `coordinator.ts` is ~1,000 lines with clean section boundaries already marked by header comments: aggregator RPC client 92–148, per-run bookkeeping ~150–190 (now includes the Phase-P `onWorkerCrash` wiring at 180–188), helpers, ingest flow (`runIngest` at 253), corpus-wide passes (`runLexicalPass` 533, `runSemanticPass` 601), topic synthesis (`synthesizeTopicNodes` 680), removal (`runRemove` 777–862, `backfillLexMeta` 870), public API from ~900 (`runChain` 903, `resetCorpus` 982). Hidden shared state that both ingest and removal use: `lexMeta` / `fileIdOfDoc` / `nameOfDoc` maps (lines 161–170), `runChain`, and the shared passes plus `computeCorpusHash`. **Cycle trap:** `runRemove` calls `resetCorpus()` on last-doc removal (`coordinator.ts:819`) — if `runRemove` moves out while `resetCorpus` stays, that is a `coordinator → removal → coordinator` cycle. Seven test files mock `'../pipeline/coordinator'` **by exact export name** (`removeDocuments`, `embedQuery`, `resetCorpus`) — `vi.mock` replaces the whole module, so a moved export breaks them only at runtime.

**Interfaces:**
- Produces (module map — targets, not new behavior):
  - `aggregatorClient.ts`: `ensureAggregator(): Worker`, `aggRequest<T extends AggResponse>(msg: AggRequest, transfer?: Transferable[]): Promise<T>`, `terminateAggregator(): void` (new — for `resetCorpus`), owning `aggWorker`/`aggNextRequestId`/`aggPending`.
  - `runShared.ts`: the three bookkeeping Maps + `LexMeta`, `clearRunState(): void` (new — called by `resetCorpus` instead of clearing the maps inline), **`resetCorpusState(): void`** (new — the teardown body of today's `resetCorpus`; both `coordinator.resetCorpus` and `removal.runRemove` call it, breaking the `runRemove → resetCorpus` cycle at `coordinator.ts:819` while coordinator keeps the exported wrapper the test mocks pin), `documentNodes()`, `contentId()`, `makeSummary()`, `basename()`/`parentDir()` (called by `runLexicalPass` and `backfillLexMeta`), `randomSpawn()` (bring `SPAWN_RADIUS`/`SPAWN_JITTER` along, coordinator.ts:89-90), `toLinkInput()`, `runLexicalPass()`, `runSemanticPass()`, `computeCorpusHash()`, `backfillLexMeta()`.
  - `topicSynthesis.ts`: `synthesizeTopicNodes(): void`, `TOPIC_EDGE_WEIGHT`.
  - `removal.ts`: `runRemove(ids: string[]): Promise<void>`.
- Consumes/preserves: **`coordinator.ts` continues to export** `ingestFiles`, `removeDocuments`, `loadDemoCorpus`, `embedQuery`, `resetCorpus`, `enqueueExclusive` (from B1) — `removeDocuments` stays defined in coordinator (it owns the chain + toast) and delegates to `removal.runRemove`. **No test file changes needed** — assert this by running the suite untouched.

**Steps:**

- [ ] **Step 1 — Move the aggregator client** (lines 92–148) to `aggregatorClient.ts` verbatim; add `terminateAggregator()` that rejects pending, terminates, and nulls the worker (mirror of the existing `onerror` path at 116–127). Point `runLexicalPass`/`runSemanticPass` imports at it.
- [ ] **Step 2 — Move shared state + passes** to `runShared.ts`. `resetCorpus` (972–990) switches from clearing `lexMeta`/`fileIdOfDoc`/`nameOfDoc` inline (976–978) to `clearRunState()` + `terminateAggregator()`.
- [ ] **Step 3 — Move topic synthesis and removal** into their modules. Import direction must stay acyclic: `coordinator → {removal, topicSynthesis} → runShared → aggregatorClient`; the existing dynamic imports (`session`, `ragChat`) stay dynamic.
- [ ] **Step 4 — Prove zero behavior change.** `npm test` with **no test edits**; `npm run build` and compare `dist/assets/index-*.js` size to the pre-split build (should match within noise). Line count sanity: coordinator.ts should land near ~450 lines.
- [ ] **Step 5 — Commit:** `refactor(pipeline): split coordinator into aggregatorClient/runShared/removal/topicSynthesis`.

### Task B3: Ingest cancellation (item 12)

**Files:**
- Create: `src/util/abort.ts` (shared `isAbortLike` — it is currently a private function at `ragChat.ts:46-52`)
- Modify: `src/pipeline/coordinator.ts` (runIngest + new `cancelIngest`), `src/chat/ragChat.ts` (import `isAbortLike` from util/abort), `src/ingest/DropZone.tsx`, `src/ui/ProgressStrip.tsx`, `src/pipeline/runShared.ts`
- Test: `src/ui/ProgressStrip.cancel.test.tsx` (jsdom), `src/pipeline/cancellation.test.ts` (node)

**Current behavior (verified):** No cancel affordance exists anywhere — ProgressStrip's only button is the ignored-tray toggle (`ProgressStrip.tsx:35-173`). `runIngest` (coordinator.ts:253–526) runs 8 lettered steps; parse and embed fan out per-file tasks via `.map` + `Promise.allSettled` (322/403, 434/460) — there is no loop to break. Neither `WorkerPool.request` (`pool.ts:113`) nor the aggregator client accepts an `AbortSignal`; in-flight worker jobs compute to completion regardless (parse ≤30 s, embed ≤180 s timeouts). The chat module owns the only cancellation precedent: module-level `activeAbort` + `cancelChat()` + `isAbortLike(err)` (`ragChat.ts:39-51`). Two hazards to design around: `setPhase('ready')` triggers the debounced session auto-save (session.ts:118–141), and `resetCorpus()` can already run *during* an ingest (SettingsPanel "Clear all" calls it directly, `SettingsPanel.tsx:148`) — cancellation should close that hole too. `modelProgress` is only nulled on the success path (477).

**Design decision (make it explicit in code comments):** cancellation is **checked between steps and after each awaited worker result** — worker jobs already in flight are allowed to finish and their results are discarded. Terminating workers mid-job would require respawn orchestration for marginal benefit. The corpus-wide passes (lexical/semantic/topics) are **not** interruptible: if any documents were placed before the abort, the passes run to completion so the graph is never half-linked (this mirrors how failures already degrade). `runIngest` **resolves** on cancellation — it never rejects with `AbortError` — so `DropZone`'s generic error toast (DropZone.tsx:151–154) and the chain-link `console.error` never fire for a user-initiated stop.

**Interfaces:**
- Produces: `export function cancelIngest(): void` from `coordinator.ts`; ProgressStrip consumes it.

**Steps:**

- [ ] **Step 1 — Abort plumbing.** In `coordinator.ts`:

```ts
let activeIngestAbort: AbortController | null = null;

/** Request cancellation of the in-flight ingest run (no-op when idle). */
export function cancelIngest(): void {
  activeIngestAbort?.abort(new DOMException('Ingest cancelled', 'AbortError'));
}
```

`runIngest` creates the controller first thing, clears it in a `finally`. Add a tiny helper in `runShared.ts`: `export function aborted(signal: AbortSignal): boolean { return signal.aborted; }` — trivially testable and greppable at every gate site.

- [ ] **Step 2 — Gate the steps.** Insert `if (signal.aborted) throw signal.reason;` (a) before the parse step, (b) **inside each per-file parse task: before `pool.request` and again after the `await`, before any store mutation**, (c) before the embed step and the same double-gate inside each embed task, (d) before `runLexicalPass`. From `runLexicalPass` onward do **not** gate — run the passes if any doc was placed.

- [ ] **Step 3 — Terminal state on abort (TDD the decision logic).** Extract the terminal-state decision into a pure, tested helper in `runShared.ts`:

```ts
export function finishAborted(
  statuses: FileStatus[], placedThisRun: number, nodesInStore: number,
): { statusPatches: FileStatus[]; terminalPhase: 'ready' | 'idle'; runPasses: boolean }
```

Rules: every still-`queued`/`parsing`/`embedding` status becomes `{ stage: 'error', error: 'Cancelled' }`; `runPasses = placedThisRun > 0` (passes then run to completion before `'ready'` — the partial corpus persists deliberately, it is a valid corpus); otherwise `terminalPhase = nodesInStore > 0 ? 'ready' : 'idle'`. In `runIngest`, wrap the gated region in try/catch for `AbortError` (`isAbortLike` from the new `src/util/abort.ts`), apply the helper's output, `setModelProgress(null)`, and push an info toast: `Stopped — ${placed} of ${total} files added.` Add an integration-style node test (`cancellation.test.ts`): with an injected fake pool whose `request` promise is manually controlled, `ingestFiles(...)` **resolves** (never rejects) when `cancelIngest()` fires mid-run — this pins the no-error-toast guarantee that Step 4's UI relies on.

- [ ] **Step 4 — Stop button.** In ProgressStrip, render a `Stop` button while `phase` is one of `parsing|linking|embedding|connecting` (not `enriching`), using the two-step inline confirm idiom from SidePanel's Remove (arm → "Stop?" confirm/cancel); confirming calls `cancelIngest()`. jsdom test: with `phase: 'parsing'` in the store and a mocked `cancelIngest` (mock seam `'../pipeline/coordinator'`), click Stop → confirm → mock called once.

- [ ] **Step 5 — Close the reset hazard.** `resetCorpus()` calls `cancelIngest()` first (comment why: a reset mid-ingest previously let the run keep writing into cleared stores).

- [ ] **Step 6 — Verify & commit.** Full gates. Manual: drop 100+ files, hit Stop mid-parse → strip shows cancelled chips, graph consistent, no error toast; drop again afterwards works. Commit: `feat(pipeline): cancellable ingest with Stop control`.

### Task B4: Persistent ingest failure report (item 13)

**Files:**
- Create: `src/pipeline/ingestReport.ts` + `src/pipeline/ingestReport.test.ts`
- Modify: `src/pipeline/coordinator.ts`, `src/ingest/DropZone.tsx`, `src/ui/ProgressStrip.tsx`, `src/store/uiStore.ts` (**new** `ingestReportOpen: boolean` + `setIngestReportOpen`, mirroring `insightsOpen` — the toast action runs from ToastHost, outside ProgressStrip, so the open state must live in the shared store), `src/persistence/cache.ts` (no schema change — uses the `settings` store)
- Test: `src/ui/ProgressStrip.report.test.tsx` (jsdom)

**Current behavior (verified):** Per-file outcomes live in `graphStore.fileStatuses: Record<string, FileStatus>` (stage `'queued'|'parsing'|'embedding'|'placed'|'cached'|'error'`) and `ignoredFiles: {name, reason}[]`; failures surface only as transient chips (last 7) in ProgressStrip. Nothing persists — reports die with the tab. Two latent bugs to fix here: `clearIngestTray` (`graphStore.ts:129`) has **zero callers**, so statuses accumulate across drops forever, and ProgressStrip's progress denominator counts that whole accumulation (`ProgressStrip.tsx:82`). Retry raw material: `PendingFile.original` (a `Blob`, coordinator.ts:266) is persisted via `putOriginalIfMissing` **only on success paths** (269/314/400) — a parse-failed file has no persisted original, so cross-reload retry of failed files is impossible by construction; session-scoped retry is possible if the Blob is captured before parse.

**Interfaces:**
- Produces (in `ingestReport.ts`):

```ts
export interface IngestReport {
  at: number;                                   // epoch ms, stamped by caller
  placed: number;
  cached: number;
  cancelled: boolean;
  failed: { name: string; reason: string }[];
  ignored: { name: string; reason: string }[];
}
export function buildIngestReport(
  statuses: FileStatus[], ignored: { name: string; reason: string }[],
  opts: { at: number; cancelled: boolean },
): IngestReport
```

- Consumes: `setSetting`/`getSetting` (`cache.ts:189-206`, IndexedDB `settings` store — no `DB_VERSION` bump needed) under key `'lastIngestReport'`.

**Steps:**

- [ ] **Step 1 — TDD the pure builder:** fixtures covering placed/cached/error mixes, empty run, cancelled run. RED → implement → GREEN.
- [ ] **Step 2 — Reset the tray per drop (not per dequeue).** `clearIngestTray` wipes `ignoredFiles` too, and DropZone records the size-cap entries **before** `ingestFiles()` is even called (`DropZone.tsx:110, 116-118`) — clearing inside `runIngest` would erase the current drop's capped entries moments after they appear. So: call `store().clearIngestTray()` in `DropZone.ingestNamedFiles` *before* `toIngestFiles` (and in the file-picker change handler), making the tray per-drop. This fixes the ProgressStrip denominator bug and stale chips while preserving the cap entries the report needs. Note in the commit body that the tray is now per-drop by design.
- [ ] **Step 3 — Record + persist.** In `runIngest`'s completion path (and the B3 abort path), build the report and `void setSetting('lastIngestReport', report)`. Keep a module-level `let retryBlobs = new Map<string, { name: string; blob: Blob }>()` populated per failed file before parse (from `PendingFile.original`); clear it at the start of the next run.
- [ ] **Step 4 — Surface it.** When a run ends with `failed.length > 0`, push a warning toast with a persistent action (`ToastAction` toasts never auto-dismiss — `ToastHost.tsx:24`): `{ label: 'View report', run: () => setIngestReportOpen(true) }`. Extend ProgressStrip's ignored-tray area into a report view listing failed (with per-file **Retry** buttons calling `ingestFiles` with bytes from `retryBlobs`; disabled with hint "re-drop the file to retry" when the Blob is gone, i.e. after reload) and ignored/capped entries. On app start, if `getSetting('lastIngestReport')` has failures from the previous session, show it read-only in the same view (retry disabled).
- [ ] **Step 5 — jsdom test:** seed store with a failed status, render the report view → failed row + Retry present; click Retry → mocked `ingestFiles` called with a file whose name matches.
- [ ] **Step 6 — Verify & commit:** `feat(ingest): per-run failure report with session retry and persisted summary`.

---

## Phase C — Graph quality (roadmap items 14–16)

All three items are independent and airgap-safe by construction (pure computation over data that already exists client-side). They may be parallelized across worktrees.

### Task C1: Local extractive summaries (item 14)

**Files:**
- Create: `src/pipeline/summarize.ts` + `src/pipeline/summarize.test.ts`
- Modify: `src/workers/pipeline.worker.ts` (parse/analyze handlers), `src/model/types.ts` (parse/analyze response payloads), `src/pipeline/coordinator.ts` (~line 387), `src/config.ts`

**Current behavior (verified):** The improvement-program premise ("docs show *No summary available yet*") is stale — the coordinator **always** writes `summary: makeSummary(doc.text)` at node creation (coordinator.ts:396), where `makeSummary` (207–210) is a flattened 200-char head + ellipsis. The real gap: the head is a poor summary. Gemini enrichment overwrites `summary` via `patchNodes` (`gemini.ts:557-562`) — that path must stay. Chunks are **not** sentences (paragraph/word packing, `chunker.ts:25-93`; intra-chunk newlines lost), and no sentence segmenter exists in the codebase, so "TextRank over chunk embeddings" at chunk granularity would emit 300-word "summaries."

**Design decision:** sentence-level TextRank with **lexical** similarity (cosine over term-frequency maps, using the existing `tokenize()`), computed **inside the pipeline worker** as part of the existing `parse`/`analyze` responses. Rationale: no new embed traffic (embedding every sentence would multiply MiniLM load), no new pool message type (so no `requestTimeoutMs` entry — that table returns 0 = *no timeout* for unknown types, `pool.ts:109-113`), deterministic and pure-testable, and summaries exist *before* `setPhase('ready')` so `saveSession` persists them.

**Interfaces:**
- Produces (pure, in `summarize.ts`):

```ts
export function splitSentences(text: string): string[]
export function summarize(text: string, maxSentences?: number): string  // '' when nothing usable
```

- New config constants: `SUMMARY_SENTENCES = 4`, `SUMMARY_MAX_CHARS = 600`, `SUMMARY_MAX_INPUT_SENTENCES = 300` (bounds the O(n²) similarity matrix).
- Worker payload change: **`ParsedDoc` (`types.ts:121-135`) gains `summary: string`** — there is no `analyze:done` variant; both the `parse` and `analyze` request handlers respond with `parse:done` carrying `doc: ParsedDoc` (`pipeline.worker.ts:254, :262`), so one field covers both paths (including `backfillLexMeta`'s analyze round-trip). Coordinator uses it at node creation, falling back to the existing `makeSummary(doc.text)` when empty.

**Steps:**

- [ ] **Step 1 — TDD `splitSentences`:** splits on `.`/`!`/`?` + closing quotes/parens and hard newlines; merges fragments shorter than ~25 chars into their neighbor; caps a sentence at 400 chars; returns `[]` for empty/whitespace input. Write the failing tests first (include an abbreviation case like "e.g." — assert the *chosen* behavior, don't aspire to perfect NLP).
- [ ] **Step 2 — TDD `summarize`:** TextRank: tokenize each sentence with the existing `tokenize()` (`tokenize.ts:35-44`); similarity = TF cosine; damping 0.85, ≤30 power iterations or Δ<1e-4; take top `SUMMARY_SENTENCES` re-sorted into document order; join with a space, truncate at `SUMMARY_MAX_CHARS` on a word boundary. Tests: deterministic output; document-order preservation; ≤N sentences; degenerate inputs (1 sentence → itself; all-identical sentences → no crash); input capped at `SUMMARY_MAX_INPUT_SENTENCES` (feed 1 000 sentences, assert it completes fast and uses the first 300).
- [ ] **Step 3 — Wire the worker.** In `pipeline.worker.ts`, `analyzeText` computes `summary = summarize(text)` and includes it in the `ParsedDoc` it returns (both handlers ship it via `parse:done`). Update `ParsedDoc` in `src/model/types.ts`.
- [ ] **Step 4 — Wire the coordinator.** At node creation (coordinator.ts:396): `summary: parsed.summary || makeSummary(doc.text)`. Cache-restored docs keep their persisted summary (older caches keep the 200-char head until a re-ingest — accepted; note it in the commit body). Gemini overwrite path untouched.
- [ ] **Step 5 — Verify & commit.** Full gates. Manual acceptance (program spec 1.2): fresh `build:airgap` preview, drop the demo corpus → every document node shows a multi-sentence summary, zero network requests. Commit: `feat(pipeline): local TextRank summaries at parse time`.

### Task C2: Multiword keyphrases (item 15)

**Files:**
- Create: `src/pipeline/phrases.ts` + `src/pipeline/phrases.test.ts`
- Modify: `src/workers/pipeline.worker.ts` (`analyzeText`), `src/model/types.ts` (`LexicalDocInput`, `ParsedDoc`, `DocNode.topicsSource`), `src/workers/aggregator.worker.ts` (`handleLexical`), `src/pipeline/coordinator.ts` (lexical input build 539-552, topics guard 578-584, `LexMeta`), `src/enrich/gemini.ts` (stamp `topicsSource`), `src/config.ts`
- Test: extend `src/pipeline/pipeline.test.ts` (the existing computeIdf/topKeywords/keywordEdges suites live there, ~lines 205-226 — `tfidf.test.ts` does not exist)

**Current behavior (verified, including the roadmap's warning at code level):** keywords are stopword-stripped unigrams (`tokenize.ts:35-52`); `topKeywords` scores `(tf/total)·idf` (`tfidf.ts:43-63`); `keywordEdges` scores doc pairs by `Σ idf(shared keyword)` with `idf.get(keyword) ?? 0` at `tfidf.ts:113`. **Feeding phrases without phrase-level IDF makes every pair score 0, and the min-max normalization then flattens every keyword edge to weight 0.85** (span 0 → ratio 1, `tfidf.ts:149-158`). Phrase candidates cannot come from the shipped `tf` maps (order + stopwords already stripped); the corpus text available off-main-thread is `LexicalDocInput.textLower` (lowercased, 200 KB-capped) — but the cleaner source is the pipeline worker's `analyzeText`, which holds the full text. Stale-topics trap: coordinator.ts:578-584 sets `topics` from keywords **only when currently empty** ("never clobber canonical enriched topics"), so docs keep their old unigram fallback topics forever unless the guard learns provenance.

**Interfaces:**
- Produces (pure, in `phrases.ts`):

```ts
/** Stopword-delimited 2..PHRASE_MAX_WORDS n-gram counts (RAKE-style candidates). */
export function extractPhraseTf(text: string): Record<string, number>
```

- Type changes: `LexicalDocInput` gains `phraseTf: Record<string, number>`; `LexMeta` (coordinator) caches it; **`ParsedDoc` carries it** (shipped in the `parse:done` payload for both the parse and analyze request types); `DocNode` gains `topicsSource?: 'tfidf' | 'gemini'`.
- New config: `PHRASE_MAX_WORDS = 3`, `PHRASE_MIN_TF = 2`, `PHRASE_TOP_PER_DOC = 100` (payload bound).

**Steps:**

- [ ] **Step 1 — TDD `extractPhraseTf`:** lowercase; split into segments at sentence punctuation and at any `STOPWORDS` token (exported at `tokenize.ts:7-25`); within a segment, every run of 2–3 consecutive tokens that individually pass `tokenize`'s length rules is a candidate; count occurrences; drop counts < `PHRASE_MIN_TF`; keep top `PHRASE_TOP_PER_DOC` by count. Tests: `"rate limiting"` extracted from repeated usage; stopwords split candidates (`"state of the art"` → no 3-gram spanning "of the"); caps enforced; empty text → `{}`.
- [ ] **Step 2 — Ship it.** `analyzeText` (pipeline.worker.ts) computes `phraseTf` for both the parse and analyze paths (so `backfillLexMeta`'s analyze round-trip produces it for cache-restored docs too); coordinator caches it in `lexMeta` and ships it in `LexicalDocInput` (~line 539).
- [ ] **Step 3 — Phrase-aware aggregation.** In `handleLexical` (aggregator.worker.ts:37-87): build per-doc combined term maps `combined = { ...tf, ...phraseTf }` (phrase keys contain spaces — no collision with unigrams); `computeIdf` over the **combined** maps so phrases get real document frequencies; `topKeywords(combined, totalTerms, idf, tfidfTopN)` now ranks phrases against unigrams on equal footing; `keywordEdges` needs **no change** — its idf map now covers phrases (this is the trap fix).
- [ ] **Step 4 — Regression tests in `pipeline.test.ts`:** (a) phrase keys sharing across docs produce **non-flat** edge weights (assert at least two distinct weights across three pairs); (b) the old failure reproduced: phrases + unigram-only idf → all weights 0.85 (documents the trap for posterity).
- [ ] **Step 5 — Topics provenance.** Fallback write (coordinator.ts:578-584) becomes: overwrite `topics` when `existing.topics.length === 0` **or** `existing.topicsSource === 'tfidf'`, stamping `topicsSource: 'tfidf'`; Gemini's patch (`gemini.ts:557-562`) stamps `topicsSource: 'gemini'`. Docs with `topicsSource === undefined` and non-empty topics (legacy caches — provenance unknowable) keep today's never-clobber behavior. Add a pin test for the enrichment-overwrite guarantee (program 1.2 acceptance "enrichment overwrite path unchanged"): a doc holding a TextRank summary + tfidf topics receives a Gemini patch → `summary` is the Gemini text and `topicsSource === 'gemini'`.
- [ ] **Step 6 — Verify & commit.** Full gates. Manual acceptance (program spec 1.4): demo corpus shows multiword topic chips/hub labels; keyword-edge evidence strings contain phrases; edge weights are not uniform. Note ripple surfaces checked: `computeLocalClusterNames`, SidePanel chips, `groupTopics` plural fold (operates on phrases harmlessly). Commit: `feat(pipeline): RAKE-style multiword keyphrases with phrase-level IDF`.

### Task C3: Insights — hub ranking, cluster stats, betweenness off-thread (item 16)

**Files:**
- Create: `src/workers/insights.worker.ts`, `src/pipeline/insightsClient.ts`, `src/graph/clusterStats.ts` + `src/graph/clusterStats.test.ts`
- Modify: `src/graph/insights.ts` (+`computeHubs`), `src/ui/InsightsPanel.tsx`, `src/model/types.ts` (messages), `src/config.ts` (`HUB_TOP_N = 8`)

**Current behavior (verified):** `InsightsPanel` computes orphans/duplicates/bridges/stale **synchronously on the main thread** in a `useMemo` gated by `open` (`InsightsPanel.tsx:54-66`); `computeBridges` is already a pure Brandes betweenness with pivot sampling (`insights.ts:58-132`) — worker-portable as-is. `patchNodes`/`setEdges` always produce new arrays, so store churn re-triggers the memo while open. `node.degree` **includes topic edges** (`graphStore.ts:104-116`) — a hub ranking must recount over `isDocEdge` (`insights.ts:35-37`) or docs carrying popular topics get inflated. `graphology-metrics` is **not** installed; keep the hand-rolled Brandes (no new dependency). The aggregator worker is a poor host — it is a single serialized instance shared with ingest; a slow betweenness job would block the next drop's lexical/semantic passes. Async arrival needs a stale-response guard; the codebase precedent is SearchOverlay's `requestSeq` counter.

**Interfaces:**
- Produces:
  - `insights.ts`: `export function computeHubs(nodes: DocNode[], edges: Edge[], topN: number): { id: string; docDegree: number }[]` (doc-edge degree only).
  - `clusterStats.ts`: `export interface ClusterStat { cluster: number; docCount: number; topKeywords: string[]; internalEdges: number; avgWeight: number }` + `export function computeClusterStats(nodes: DocNode[], edges: Edge[]): ClusterStat[]` (top keywords by within-cluster frequency — reuse the counting approach in `clusterNaming.ts:37-129`).
  - `insightsClient.ts`: `export function requestInsights(nodes: DocNode[], edges: Edge[]): Promise<InsightsResult>` — RPC client cloned from the aggregator pattern (`coordinator.ts:103-148`): lazy spawn, requestId correlation, reject-all + respawn on `onerror`.
  - Messages in `types.ts`: `InsightsRequest { requestId; type: 'insights'; nodes: {id; kind: 'document' | 'topic'; cluster; keywords}[]; edges: {source; target; weight; kind}[] }`, `InsightsResponse 'insights:done' { requestId; bridges; hubs; clusterStats }`. **`kind` must ship** — `computeBridges` filters `n.kind === 'document'` (`insights.ts:58-63`); without it the slimmed nodes yield zero documents and empty bridges. Retype the pure functions over `Pick<DocNode, 'id' | 'kind' | 'cluster' | 'keywords'>` so the wire shape typechecks. No `lastModified` in the request — stale-doc computation stays synchronous on the main thread.

**Steps:**

- [ ] **Step 1 — TDD the pure functions:** `computeHubs` (a doc wired only via topic edges ranks below a doc with real doc-edges; topN respected) and `computeClusterStats` (counts, keyword ranking, avgWeight on a 2-cluster fixture).
- [ ] **Step 2 — Worker + client.** `insights.worker.ts` imports the pure functions and answers `insights` requests (bridges via existing `computeBridges` with the `config.ts` opts). Dedicated worker, spawn idiom `new Worker(new URL('../workers/insights.worker.ts', import.meta.url), { type: 'module' })` — remember to add it to `optimizeDeps.entries` in `vite.config.ts` (the three existing workers are listed there; missing entries cause dev-mode re-optimization reloads).
- [ ] **Step 3 — Async panel.** Replace the heavy parts of the `useMemo`: orphans/duplicates/stale stay synchronous (cheap); bridges/hubs/clusterStats come from `requestInsights` in a `useEffect` keyed `[open, nodes, edges]` with a `requestSeq` stale-guard and an "Analyzing…" pending row. New sections reuse the existing `section(key, label, count, ids, body)` helper (`InsightsPanel.tsx:95-120`): **Hubs** (rows: title + doc-degree, click = `setSelected` + `sendCamera('frameNode')`, Highlight = `setSearchResults(ids, 'insights')`) and **Clusters** (rows: cluster color dot via `hexFor`, name via the existing `clusterNames ?? localClusterNames ?? 'Cluster N'` chain, doc count, top keywords; Highlight = member ids).
- [ ] **Step 4 — Verify & commit.** Full gates. Manual: 1k-node corpus → panel opens instantly, sections fill in async, main thread stays responsive (no long task in the Performance panel while opening). Commit: `feat(insights): hub ranking + cluster stats, betweenness moved off the main thread`.

---

## Phase D — Reach (roadmap items 17–19)

### Task D1: Accessibility & keyboard navigation (item 17)

**Files:**
- Create: `src/ui/NodeListNav.tsx` + `src/ui/NodeListNav.test.tsx` (jsdom)
- Modify: `src/ui/ToastHost.tsx`, `src/ui/ProgressStrip.tsx`, `src/ui/SidePanel.tsx`, `src/ui/ChatPanel.tsx`, `src/ui/SearchOverlay.tsx`, `src/ui/InsightsPanel.tsx`, `src/ui/PathPanel.tsx`, `src/ui/Toolbar.tsx`, `src/App.tsx`, `src/styles.css`
- Test: `src/ui/ToastHost.test.tsx` (jsdom)

**Current behavior (verified):** Global keyboard is owned solely by `App.tsx:104-184` ("owned HERE and nowhere else"): ⌘/Ctrl+K (before the typing guard), arrow-key camera pan via `panInput` (with `preventDefault`), an ordered Escape cascade (search → showMe → path → settings → snapshots → chat → insights → selection → fitAll), Home = fitAll. `useFocusTrap(ref, active)` exists (`useFocusTrap.ts:23`) with 3 consumers (Settings, SnapshotDrawer, ExportImportMenu). Gaps: SidePanel has **no** role/focus management; ChatPanel has **no** aria-live and its textarea is disabled during streaming (which silently drops keyboard focus, `ChatPanel.tsx:263`); ToastHost's `aria-live` container is conditionally rendered — it mounts together with the first toast, so screen readers can miss it (`ToastHost.tsx:59-62`); ProgressStrip has zero ARIA; SearchOverlay is correct (combobox + `aria-activedescendant`) but focus can Tab out; toolbar icon buttons have `title` only. Reduced-motion and the scene effects are **already handled** (`prefersReducedMotion()` honored across Nodes/CameraRig/EdgePulses/SelectionHalo/AiCore + a global CSS kill) — not in scope.

**Steps:**

- [ ] **Step 1 — Live regions (TDD).** ToastHost: always render the `.toast-host[aria-live="polite"]` container; only the rows are conditional. jsdom test: container exists with zero toasts; pushing a toast renders `role="alert"` inside the pre-existing region. ProgressStrip: wrap in `role="status"` `aria-live="polite"`; the bar gets `role="progressbar"` + `aria-valuemin/max/now` + `aria-label` from the phase label.
- [ ] **Step 2 — Panel semantics + focus.** SidePanel: `role="dialog"` `aria-label={node.title}`; on mount, focus the close button (there is no meaningful restore target — it opens from a WebGL canvas click; document that in a comment); on close via Escape the cascade already handles state. ChatPanel: add a **permanently mounted** visually-hidden status line (`aria-live="polite"`) that announces "Thinking…" / "Answer ready" on `isStreaming` transitions (do *not* put aria-live on the streaming message list — per-delta re-announcement); after streaming ends, re-focus the textarea. InsightsPanel/PathPanel: `role="dialog"` + `aria-label`. Toolbar: add `aria-label` mirroring each `title` (Search/Show me/Fit/Path/Insights/Snapshots/Settings/Add files, lines 392–542).
- [ ] **Step 3 — SearchOverlay containment.** Keep the combobox pattern (focus stays on the input; do **not** apply `useFocusTrap` — moving DOM focus into rows would break the ArrowUp/Down handling). The overlay currently has **no focusable close affordance** — the "Esc" hint is a decorative `<span className="kbd">` (`SearchOverlay.tsx:139`) — so first add a real close button (`aria-label="Close search"`), then add a Tab/Shift+Tab keydown on the overlay root that wraps focus between the input and that button.
- [ ] **Step 4 — NodeListNav (TDD).** A visually-hidden (`.sr-only`-style, in `styles.css`) but focusable listbox mirroring `graphStore.nodes` (documents first, sorted by title — **source from `nodes`, never positionBuffer slots**, which contain freed `''` entries). Reached via Tab order (mounted after Toolbar in App). Keys, registered on the list element in the **capture phase** with `stopPropagation()` (the Toolbar Escape precedent, `Toolbar.tsx:324-336`) so App's arrow-pan (`App.tsx:129-134`) never sees them while the list has focus: ArrowUp/Down move `aria-activedescendant`; Enter = `setSelected(id)` + `sendCamera('frameNode', [id])`; Escape blurs back to the app. jsdom tests: arrow moves active option; Enter fires the two store actions (real uiStore, spied); arrow keydowns from the focused list don't reach a window listener.
- [ ] **Step 5 — Verify & commit.** Full gates + manual keyboard-only pass: Tab to node list → arrows → Enter opens SidePanel → read → Escape closes → focus lands back on the list. Commit: `feat(a11y): live regions, dialog semantics, and keyboard node navigation`.

*Descoped from item 17 (recorded so it doesn't silently vanish):* the colorblind-safe cluster palette option from program spec 2.3's approach list — it is not part of 2.3's acceptance criteria ("open-doc→read→close without a mouse; prefers-reduced-motion respected") and is deferred.

### Task D2: Bundle diet + CI size gate (item 18)

**Files:**
- Create: `scripts/check-bundle.mjs`
- Modify: `src/pipeline/coordinator.ts` (pdf import seam), `vite.config.ts` (manualChunks), `src/App.tsx` (lazy panels), `package.json`, `.github/workflows/ci.yml`

**Current behavior (verified/measured):** `dist/assets/index-*.js` is **2,134,825 bytes** (airgap: 2,119,541 — measured 2026-07-06 after the Phase-P commits; re-measure before starting); no `manualChunks`, no size gate, and `npm run build` emits Vite's chunk-size warning. pdfjs-dist sits in the main chunk via a static chain: `coordinator.ts:79` (`import { parsePdf } from './parsers/pdf'`) → `pdf.ts:12` (`import * as pdfjs from 'pdfjs-dist'`), and coordinator is statically imported by seven main-bundle modules — making `PdfPreview` React.lazy (the app's only lazy component, `SidePanel.tsx:38`) did *not* evict pdfjs. `parsePdf` has exactly one call site (`coordinator.ts:329`). All 18 UI/scene components are statically imported in `App.tsx:1-27`. `vite.config.ts` documents why `optimizeDeps` is finely tuned (worker chunk bugs produced `document is not defined`); the CSP is injected into `index.html` at build and regex-parsed by `verify-airgap.mjs` — chunk changes must not disturb it. The 23.5 MB ORT wasm and 1.26 MB pdf.worker are demand-loaded assets, **not** part of the entry-chunk budget.

**Steps:**

- [ ] **Step 1 — Lazy pdf.js.** Delete the static import at `coordinator.ts:79`; at the call site:

```ts
// Loaded on demand: pdfjs (~350 KB + its own worker) must not ride in the entry chunk.
let pdfModule: Promise<typeof import('./parsers/pdf')> | null = null;
const loadPdf = () => (pdfModule ??= import('./parsers/pdf'));
// in the per-file parse task:
const { parsePdf } = await loadPdf();
```

`pdf.ts`'s module-level polyfills (lines 28–35) run at dynamic-import time, before any pdfjs use — safe. `PdfPreview.tsx` keeps its own static `pdfjs` import inside the already-lazy chunk. Run the suite: SidePanel/ChatPanel jsdom tests must stay green (they rely on pdfjs never evaluating; it now evaluates strictly later).

- [ ] **Step 2 — manualChunks for the three.js family.** In `vite.config.ts` `build`:

```ts
rollupOptions: {
  output: {
    manualChunks(id: string) {
      if (/node_modules\/(three|@react-three|postprocessing|maath|meshline|its-fine)\//.test(id)) return 'three';
    },
  },
},
```

Scope it to exactly this family (workers build separately with `worker.format: 'es'`; don't split worker-shared code). Build both targets; open the app and the airgap preview — a white screen or `document is not defined` in a worker means a chunk boundary crossed into worker code (revert and narrow the regex).

- [ ] **Step 3 — Lazy panels (conditional mounting is the actual work).** Today `App.tsx:195-205` mounts all five panels **unconditionally** and each self-gates with `return null` inside (`SettingsPanel.tsx:138`, `SnapshotDrawer.tsx:122`, `InsightsPanel.tsx:68`, `SearchOverlay.tsx:81`, `ChatPanel.tsx:184/187`) — `React.lazy` alone would trigger every dynamic import at startup and defer nothing. So: convert to `React.lazy` **and** gate mounting in App on the store flags (`{settingsOpen && <SettingsPanel/>}`, `{snapshotsOpen && <SnapshotDrawer/>}`, `{insightsOpen && <InsightsPanel/>}`, `{searchOpen && <SearchOverlay/>}`), wrapped in `<Suspense fallback={null}>` — safe because the Escape cascade and Toolbar read the store flags, not the components. **ChatPanel is special:** its closed state *is* the floating chat-bubble launcher (`ChatPanel.tsx:187-199`) — hoist the bubble into a tiny always-mounted launcher component in App and lazy-load only the expanded panel body behind `isOpen`, or chat becomes unreachable. Keep hot-path components static (SidePanel, Toolbar, ProgressStrip, ToastHost, scene).
- [ ] **Step 4 — CI gate.** `scripts/check-bundle.mjs` modeled on `verify-airgap.mjs` (plain Node ESM, zero deps, `process.exit(1)`): find `assets/index-*.js` under a dist dir given as argv, fail if bytes exceed the budget constant. Set the budget to **min(1,000,000, measured post-change size + 5%)** — the program acceptance (spec 2.2) is < 1 MB pre-gzip; **if steps 1–3 don't reach ≤ 1,000,000, the task ships with the acceptance explicitly deferred — record that in CHANGELOG.md, not just the commit body.** Add `"check:bundle": "node scripts/check-bundle.mjs dist && node scripts/check-bundle.mjs dist-airgap"` and a ci.yml step after `build:airgap`.
- [ ] **Step 5 — Verify & commit.** Full gates + `check:bundle` green; **confirm `npm run build` output contains no chunk-size warning** (part 2 of the 2.2 acceptance — Vite's default `chunkSizeWarningLimit` is 500 kB; if entry chunks legitimately exceed it, set `build.chunkSizeWarningLimit` to the check-bundle budget with a comment tying the two constants together). Manual: dev-tools Network on a text-only session shows no `pdf.worker` fetch; drop a PDF → it appears. Record before/after sizes and the load-time budget in README (program 2.2(e)); note that evaluating the smaller ORT wasm variant (2.2(c)) is deferred — the 23.5 MB wasm is a demand-loaded asset outside the entry-chunk budget. Commit: `perf(build): lazy pdf.js, three.js vendor chunk, lazy panels, CI bundle budget`.

### Task D3: IndexedDB quota resilience + scoped hover recolor (item 19)

**Files:**
- Create: `src/persistence/quota.ts` + `src/persistence/quota.test.ts`
- Modify: `src/persistence/cache.ts`, `src/persistence/originals.ts`, `src/persistence/session.ts`, `src/store/settingsStore.ts`, `src/ui/SettingsPanel.tsx`, `src/pipeline/coordinator.ts`, `src/scene/Nodes.tsx`, `src/scene/Edges.tsx`

**Current behavior (verified):** `navigator.storage.estimate()` is used **nowhere**; the only storage API call is best-effort `persist()` (`session.ts:112-114`). Quota failure UX: `cacheUnavailable()` warns **once per session** then goes silent (`cache.ts:31-47`), and `originals.ts` swallows errors **completely silently** (lines 33–35). Quota pressure sources: every `saveSession` re-persists full text + all chunk vectors for every doc (`session.ts:152-174`), plus original Blobs ≤50 MB each. The `embeddings` schema already treats zero-length `chunkVectors` as absent (`db.ts:32-39`) — a selective mode needs no migration. Hover perf: each pointer-move hover change sets **both** `colorsDirty` and `matricesDirty` (`Nodes.tsx:289-301`), so one hover = full recolor **plus** a full 4096-slot matrix pass; `Edges.recomputeColors` additionally rebuilds a `clusterOf` Map over all nodes on every call (`Edges.tsx:171-243`). Note: hover transitions legitimately touch every instance's *color* (dim-all-but-neighbors); the win is dropping the redundant matrix pass and the Map rebuild.

**Steps:**

- [ ] **Step 1 — TDD `quota.ts`:**

```ts
export async function estimateStorage(): Promise<{ usage: number; quota: number } | null>  // null when API absent
export function storagePressure(e: { usage: number; quota: number }): 'ok' | 'warn' | 'critical'  // warn ≥ 0.7, critical ≥ 0.9
export function formatBytes(n: number): string
```

- [ ] **Step 2 — Warn at ingest start.** In `runIngest`, `void` a check: at `warn`/`critical`, push a warning toast once per session ("Storage is {n}% full — new documents may not be cached for instant reload") with a `ToastAction` opening Settings. Show live usage in the Settings **Data** section via `estimateStorage()`.
- [ ] **Step 3 — Selective caching mode.** Extend `PersistedSettings` (+ `DEFAULTS` + `loadPersisted` type-checked parsing + the `subscribe` writer — the established idiom in `settingsStore.ts:42-107`) with `cacheEmbeddings: boolean` (default `true`). When false: `saveDocsToCache` and `saveSession` write `new Float32Array(0)` for `chunkVectors` (schema-supported "absent"); restore paths already degrade (semantic search falls back to doc vectors / keyword match). Settings checkbox under Data: "Cache embeddings for instant reload (uses more storage)". Trade-off line in help text: with it off, a reload re-embeds on next ingest interaction.
- [ ] **Step 4 — Kill the silent failures.** Export `cacheUnavailable` from `cache.ts` first (it is module-private today, `cache.ts:32`; no cycle — cache.ts does not import originals.ts), then route `originals.ts`'s catch through it (keeps the once-per-session throttle, no longer *zero* signal); `cacheUnavailable` additionally records to the diagnostics surface shipped in Phase P (`uiStore.lastError` via `setLastError`) so *Copy diagnostics* captures storage failures.
- [ ] **Step 5 — Scoped hover recolor (TDD the flag decision — this edits the dirty-flag machinery on the roadmap's strengths-to-preserve list).** Extract the store-change→dirty-flags decision from the `Nodes.tsx` subscription into a pure function, `flagsForChange(prev, next): { colors: boolean; matrices: boolean }`, and unit-test it: hover-only change → colors only; selection/search/filter changes → current behavior preserved (both flags where they set both today). Then wire the subscription through it. `Edges.tsx`: hoist the `clusterOf` Map into a ref rebuilt only when `nodes` identity changes. Guard the **two** `computeEmphasis` consumers (`Nodes.tsx` colors, `Edges.tsx` `recomputeColors`) stay in agreement — run the existing `emphasis.test.ts` and eyeball node/edge dimming after hover, plus EdgePulses' hover pulses (EdgePulses reads `hoveredId` directly, not `computeEmphasis` — it does no dimming).
- [ ] **Step 6 — Verify & commit.** Full gates; manual: 4k-node demo, hover sweep across the graph → Performance panel shows no long tasks; toggling the setting round-trips through localStorage. Commit: `feat(persistence): quota estimate + selective embedding cache; perf(scene): scoped hover recolor`.

---

## Phase E — Product depth (roadmap items 20–25)

### Task E1: Chat — per-corpus persistence, history-aware retrieval, transparency (item 20)

**Files:**
- Modify: `src/persistence/db.ts` (**DB_VERSION 3 → 4**, new `chats` store), `src/persistence/cache.ts`, `src/persistence/session.ts`, `src/store/chatStore.ts`, `src/chat/ragChat.ts`, `src/chat/extractiveAnswer.ts`, `src/ui/ChatPanel.tsx`, `src/config.ts`
- Test: `src/chat/retrievalQuery.test.ts` (new), extend `src/persistence/roundTrip.test.ts`

**Current behavior (verified):** Chat is ephemeral by design (`chatStore.ts:3`); `resetCorpus` clears it. Message ids are `chat-${++nextId}` from a module counter **that resets on reload** — restored messages would collide with new ones (`chatStore.ts:37`). History is Gemini-only: `buildHistoryTurns` (`ragChat.ts:211-240`) is called at line 318 on the Gemini path; the local extractive path ignores history entirely. `sendChatMessage` snapshots `priorMessages` **before** adding the user turn (line 252) — persistence hooks must not reorder this. `ChatSource` lacks `chunkIndex` even though `RetrievedChunk` carries it — dropped in `bestChunkSources` (`ragChat.ts:160-173`) and `extractiveAnswer`'s mapping (55–59). `corpusHash` (`graphStore.ts:21`) is the natural per-corpus key. GC semantics to state accurately: `graphs` records for a superseded hash are deleted on the **remove** path (`coordinator.ts:858-861`, `:822`) and for demo sessions (`session.ts:284-288`), but accumulate on the **add** path — chats keyed by corpusHash will accumulate on both unless `runRemove` also deletes the old chat record next to `deleteGraphFromCache` (do that; add-path accumulation is accepted).

**Steps:**

- [ ] **Step 1 — Schema.** `db.ts`: `DB_VERSION = 4`; `if (oldVersion < 4) db.createObjectStore('chats', { keyPath: 'corpusHash' })`; record type `ChatRecord { corpusHash: string; messages: ChatMessage[]; savedAt: number }`. `cache.ts`: `saveChat(corpusHash, messages)`, `loadChat(corpusHash): Promise<ChatMessage[] | undefined>`, both try/catch → `cacheUnavailable`. New config: `CHAT_PERSIST_MAX = 200` (trim oldest before save).
- [ ] **Step 2 — Collision-proof ids.** `addMessage` switches to `id: crypto.randomUUID()`. Grep for assumptions about the `chat-` prefix first (none known; verify).
- [ ] **Step 3 — Wire persistence.** `chatStore.subscribe` on `messages`: debounce 1 s, save when `phase === 'ready'` and `corpusHash` non-null. Restore inside `hydrateFromRecord` (`session.ts:185`) after stores hydrate: `loadChat(corpusHash)` → `useChatStore.setState({ messages })`. `resetCorpus` keeps clearing the in-memory store only (records survive for when that corpus returns). Test in a **new** `src/persistence/chatPersist.test.ts` mocking `../persistence/cache`'s `saveChat`/`loadChat` with `vi.mock` (a new seam — no idb-mock pattern exists in the repo; `roundTrip.test.ts` mocks only the coordinator and its subject is export→sanitize fidelity): save → clear → hydrate restores messages.
- [ ] **Step 4 — History-aware extractive retrieval (TDD).** Pure function in `ragChat.ts` (exported for tests):

```ts
/** Local mode only: widen a terse follow-up with salient terms from recent user turns. */
export function buildRetrievalQuery(question: string, prior: ChatMessage[]): string
```

Tokenize the last 2 user turns with the existing `tokenize()`; append up to 6 terms not already present in the question. Local path calls `retrieveChunks(buildRetrievalQuery(q, priorMessages))`; Gemini path unchanged. Tests: follow-up "what about its limits?" after a "rate limiting" question includes `rate`/`limiting`; standalone question passes through unchanged; empty history no-op.
- [ ] **Step 5 — Retrieval transparency.** Add `chunkIndex?: number` to `ChatSource`; thread it through `bestChunkSources` and `extractiveAnswer`'s source mapping. ChatPanel chip `title` gains "passage N · {pct}% match"; extractive answers get a trailing muted line "Matched {k} passages across {m} documents."
- [ ] **Step 6 — Verify & commit.** Full gates (the DB upgrade runs under the existing HMR-blocked-upgrade mitigations, `db.ts:116-134` — reload the dev tab once). Manual: chat in airgap preview, reload → history restored; ask a follow-up → sources reflect the prior topic. Commit: `feat(chat): per-corpus history persistence, history-aware local retrieval, passage-level citations`.

### Task E2: Snapshot diff/compare + non-destructive load (item 21)

**Files:**
- Create: `src/persistence/snapshotDiff.ts` + `src/persistence/snapshotDiff.test.ts`
- Modify: `src/ui/SnapshotDrawer.tsx`, `src/persistence/session.ts` (`restoreSnapshotById`, line 350)
- Test: `src/ui/SnapshotDrawer.compare.test.tsx` (jsdom)

**Current behavior (verified):** Snapshot load is destructive by design: `restoreSnapshotById` → `resetCorpus()` (wipes chat/selection/runtime stores/layout) → `hydrateFromRecord` (`session.ts:350-358`). Snapshots store graph shape + positions + `docHashes` pointing into the shared `documents`/`embeddings` stores — `removeDocuments` can orphan those references (it deletes documents/embeddings records a snapshot still points at), while *Clear cached session* deletes the snapshots store itself outright (`cache.ts:221`), and `hydrateFromRecord` silently tolerates missing docs (`if (doc)` guard, `session.ts:215-227`). `listSnapshots()` uses `getAll` and deserializes every full `exportData` just to count nodes (`cache.ts:263-279`) — a diff UI must load only the two records via `loadSnapshot(id)`.

**Steps:**

- [ ] **Step 1 — TDD the pure diff:**

```ts
export interface SnapshotDiff {
  addedDocs: { id: string; title: string }[];
  removedDocs: { id: string; title: string }[];
  changedDocs: { id: string; title: string; fields: ('title'|'summary'|'topics'|'keywords')[] }[];
  edgeDelta: { added: number; removed: number };
}
export function diffSnapshots(from: GraphExport, to: GraphExport): SnapshotDiff
```

Compare document nodes by id (**exclude `kind === 'topic'`** — synthesized); `changedDocs` by shallow field comparison; edges by id sets. Tests: add/remove/change fixtures, topic nodes ignored, identical exports → empty diff.
- [ ] **Step 2 — Compare UI.** SnapshotDrawer rows gain a *Compare* checkbox (max 2 selected); a *Compare* button loads exactly the two records via `loadSnapshot(id)` and opens a diff modal (standard dialog pattern + `useFocusTrap`): three lists + edge delta; rows for docs present in the current graph get the `setSelected` + `sendCamera('frameNode')` jump. jsdom test with mocked `../persistence/cache`: select two, diff renders the fixture's added/removed rows.
- [ ] **Step 3 — Safety-net load.** In `restoreSnapshotById`, before `resetCorpus()`: if `phase === 'ready'` and nodes exist, `await saveCurrentSnapshot(\`Before "${name}" — ${new Date().toLocaleString()}\`)` — loading is now always reversible (this is the pragmatic "non-destructive" per the drawer's existing UX). After hydration, count docHashes that resolved to no record and, if > 0, toast a warning: "N documents in this snapshot are no longer cached — their nodes load without text."
- [ ] **Step 4 — Verify & commit.** Full gates; manual: save two snapshots differing by a few docs → compare shows the delta; load one → an automatic "Before …" snapshot appears at the top of the list. Commit: `feat(snapshots): diff/compare view and reversible load`.

### Task E3: Search↔filter unification + edge-kind and date facets (item 22)

**Files:**
- Modify: `src/store/uiStore.ts` (`GraphFilter`), `src/scene/emphasis.ts`, `src/scene/Edges.tsx` (`isEdgeHidden`, line 163), `src/scene/EdgePulses.tsx` (line 83), `src/ui/Minimap.tsx` (line 139 — the fourth filter site, see Step 3), `src/ui/FilterBar.tsx`
- Test: extend `src/scene/emphasis.test.ts`

**Current behavior (verified):** `GraphFilter` is `{ fileTypes, clusters, minDegree, minEdgeWeight }` (`uiStore.ts:35-40`). Two disjoint mechanisms: the single-owner `searchResults` highlight channel (owners `search|insights|path|showMe` clobber each other deliberately) and the filter; `computeEmphasis` applies strict precedence hover > selection > search > filter (`emphasis.ts:39-46`) — **search and filter do not compose today**. An edge-kind facet must land in **four places in lockstep** or the scene desyncs: `computeEmphasis` (consumed by `Nodes.tsx` and `Edges.tsx`), `Edges.isEdgeHidden`, `EdgePulses`, **and `Minimap.tsx:139`, which independently re-implements the minEdgeWeight predicate when drawing minimap edges** — `emphasis.test.ts` exists precisely because the minEdgeWeight facet once missed a site. Date signal: `DocNode.lastModified?: number` only (file mtime); demo docs **must keep `lastModified === undefined`** — `session.ts:95` uses that for demo-session detection — so "Unknown date" must be a first-class bucket, never backfilled.

**Steps:**

- [ ] **Step 1 — Extend the filter type.**

```ts
export interface GraphFilter {
  fileTypes: FileType[] | null;
  clusters: number[] | null;
  minDegree: number;
  minEdgeWeight: number;
  edgeKinds: EdgeKind[] | null;                       // null = all kinds
  datePreset: 'all' | '30d' | '90d' | '1y' | 'unknown';
}
```

Update the default object and `hasActiveFilter` in FilterBar.
- [ ] **Step 2 — TDD emphasis composition** (extend `emphasis.test.ts` **before** touching the implementation): (a) `edgeKinds` active → emphasized nodes are those incident to ≥1 edge of an allowed kind (mirror the minEdgeWeight semantics exactly); (b) `datePreset: '90d'` keeps docs with `lastModified` within 90 days of `now` (pass `now` in — `computeEmphasis` gains an optional `nowMs` parameter defaulting to `Date.now()` at the call site, keeping the function pure in tests); `'unknown'` keeps only `lastModified === undefined`; (c) **composition change:** when both search results and filter are active, emphasis = intersection (search ∧ filter) instead of search-wins. Hover/selection precedence unchanged.
- [ ] **Step 3 — Implement in lockstep.** Extract a shared `edgePassesFilter(e: Edge, filter: GraphFilter): boolean` helper into `emphasis.ts` and route all four sites through it: `computeEmphasis` per the tests; `Edges.isEdgeHidden` (adds the kind check); `EdgePulses` (line 83); and **`Minimap.tsx:139`** (migrate its duplicated `e.weight < filter.minEdgeWeight` predicate — it is the fourth site, and leaving it draws hidden-kind edges on the minimap). Labels applies no emphasis dimming (nothing to update there).
- [ ] **Step 4 — FilterBar UI.** Edge-kind chip row using `EDGE_KIND_LABEL` + `EDGE_KIND_HEX` from `palette.ts:83-106` (single color source); date `<select>` with the five presets (label the last "No date"). Clear resets both.
- [ ] **Step 5 — Verify & commit.** Full gates; manual: kind chips hide edge classes and dim now-isolated nodes; search while a cluster filter is active highlights only in-cluster hits. Commit: `feat(filter): edge-kind + date facets; search composes with filters`.

### Task E4: Legend + shortcut cheatsheet popover (item 23)

**Files:**
- Create: `src/ui/HelpPopover.tsx` + `src/ui/HelpPopover.test.tsx` (jsdom)
- Modify: `src/store/uiStore.ts` (`helpOpen`/`setHelpOpen`), `src/ui/Toolbar.tsx`, `src/App.tsx` (mount + Escape cascade), `src/styles.css`

**Current behavior (verified):** No legend or help UI exists — only anticipatory comments (`palette.ts:70`, `Edges.tsx:53`). Shortcut discoverability is `title` attributes. The Escape contract is a three-layer arrangement (Toolbar capture-phase → App cascade → fitAll) any new panel must join, and popovers are force-closed when a modal opens (`Toolbar.tsx:341-343`).

**Steps:**

- [ ] **Step 1 — Store + trigger.** Add `helpOpen: boolean` + `setHelpOpen` to the flat `UiState`; Toolbar gets a `?` icon button (inline SVG, `aria-label="Help & legend"`), placed after Settings.
- [ ] **Step 2 — Popover.** Clone the SnapshotDrawer dialog wiring (backdrop + `role="dialog"` + `useFocusTrap`). Content, all from single sources of truth: **Edges** — one row per `EdgeKind` with a color swatch from `EDGE_KIND_HEX` and label from `EDGE_KIND_LABEL` (iterate the record, don't hardcode); **Nodes** — sphere = document, octahedron = topic hub, size ≈ connections, color = cluster; **Dimming** — one sentence on hover/selection/search/filter emphasis; **Shortcuts table** — ⌘/Ctrl+K search · Arrow keys pan · Home fit all · Esc close/back · Enter open (search/list) · Shift+Enter newline (chat), using the existing `.kbd` styling (`SearchOverlay.tsx:139`).
- [ ] **Step 3 — Global wiring.** Insert `helpOpen` into App's Escape cascade (before `selectedId`); add a `?` key handler **after** the `isTypingTarget` guard (deliberately inert while typing — same reasoning as the existing guard placement, `App.tsx:117-127`).
- [ ] **Step 4 — jsdom test:** button opens the dialog; every `EdgeKind` value appears; Escape-path close via the store action.
- [ ] **Step 5 — Verify & commit:** `feat(ui): legend + keyboard cheatsheet popover`.

### Task E5: `noUncheckedIndexedAccess` migration (item 24)

**Files:**
- Modify: `tsconfig.json` (final commit) + fallout across ~147 `src/**` files, in module-group commits
- Create: `nodeById` helper in `src/store/graphStore.ts`

**Current behavior (verified):** the flag is absent; `strict` is on. Known hot spots: the pervasive `nodes[nodeIndex[id]]` idiom — **all in `src/ui` plus the coordinator, none in `src/scene`** (ChatPanel.tsx:57, SearchOverlay.tsx:149, InsightsPanel.tsx:70, PathPanel.tsx:53, SidePanel.tsx ×4, Tooltip.tsx:23, ShowMePanel.tsx:102, openDocument.ts:66, coordinator.ts ×3; scene code goes through `slotOfId`/positionBuffer instead) — `nodeIndex` is `Record<string, number>` so both hops yield `| undefined`; flat typed-array loops (`vectors[off + d] * qVec[d]`, `semanticSearch.ts:132`, `ragChat.ts:92`); positionBuffer/instancing loops in `src/scene/`. The compiler flag is global — "module-by-module" means fix order and commit grouping, not gating.

**Steps:**

- [ ] **Step 1 — Add the safe-lookup helper (TDD):** `export function nodeById(state: { nodes: DocNode[]; nodeIndex: Record<string, number> }, id: string): DocNode | undefined` in graphStore (typed structurally — `GraphState` is a non-exported interface at `graphStore.ts:10`; exporting it also works); unit-test hit/miss.
- [ ] **Step 2 — Flip the flag locally** (do not commit yet); record the diagnostic count as the burn-down number.
- [ ] **Step 3 — Fix in waves, one commit each, suite green after each** (flag still off in committed `tsconfig.json`, so intermediate commits stay buildable): ① `util` + `model` + pure `pipeline`/`graph` modules (migrate the coordinator's three `nodes[nodeIndex[id]]` sites to `nodeById` here); ② `persistence`; ③ `store` + `chat` + `search`; ④ `ui` (the bulk of the `nodeById` migrations — ~9 sites); ⑤ `scene` + workers (typed-array/positionBuffer loops). Rules: prefer narrowing (`const i = idx[id]; if (i === undefined) return;`) and `??` defaults; a non-null assertion is allowed **only** in perf-critical inner loops where the index is bounds-guaranteed by construction, with a one-line invariant comment; never weaken a test to pass.
- [ ] **Step 4 — Final commit flips `tsconfig.json`** with zero remaining diagnostics: `npm run typecheck` clean proves it; CI enforces it thereafter (tsc runs inside `npm run build`).
- [ ] **Step 5 — Commit series:** `refactor(types): noUncheckedIndexedAccess — <area>` ×5 + `chore(types): enable noUncheckedIndexedAccess`.

### Task E6: OCR for scanned PDFs (item 25 — stretch; largest task, do last)

**Files:**
- Create: `src/pipeline/parsers/ocr.ts`, `public/ocr/` (self-hosted tesseract worker JS + core wasm + `eng.traineddata.gz`)
- Modify: `src/pipeline/parsers/pdf.ts` (hook at the `'unreadable'` return, line 232), `src/ui/ProgressStrip.tsx` (render `modelProgress.note` — see Step 3), `src/config.ts` (`OCR_MAX_PAGES = 20`), `package.json` (add `tesseract.js`), `scripts/sanitize-airgap.mjs` (HOSTS list, if the bundle embeds new vendor hostnames)

**Current behavior (verified):** `parsePdf` (`pdf.ts:164`) returns `status: 'unreadable'` with warning "No extractable text (scanned images?)" when extracted text < `MIN_TEXT_CHARS = 40` (line 232–240). **Hard constraint:** pdf.js *transfers* the `ArrayBuffer` to its worker — `bytes` is detached after parsing starts, so OCR cannot re-read the input; it must rasterize pages via the **still-open `PDFDocumentProxy` inside `parsePdf`, before `task.destroy()` in the `finally`** (lines 270–274), or re-fetch the Blob from the `originals` store. `parsePdf` is main-thread-only by design (pdf.js spawns its own worker; never import from `pipeline.worker.ts`). tesseract.js is not currently a dependency and **its defaults point at CDNs** — the CSP (`connect-src 'self' blob:`), the runtime fetch guard, and the airgap verify gate all hard-fail remote fetches, so every asset must be self-hosted under `public/ocr/` mirroring the `/models/` MiniLM pattern (those model files are committed; commit the OCR assets too, noting the ~15 MB repo weight in the commit body).

**Steps:**

- [ ] **Step 1 — Vendor the assets.** Add `tesseract.js`; copy its worker JS + core wasm (pick the SIMD build) + `eng.traineddata.gz` into `public/ocr/`. **Verify the exact createWorker option names against the installed version's types before writing code** (`workerPath`/`corePath`/`langPath` in v5 — do not guess; the API moved between v4/v5).
- [ ] **Step 2 — `ocr.ts`.** `export async function ocrPdfPages(doc: PDFDocumentProxy, maxPages: number, onPage?: (done: number, total: number) => void): Promise<string>` — lazy `await import('tesseract.js')` (memoized, retry-after-failure like `getExtractor`, `pipeline.worker.ts:170-179`); create the worker with the self-hosted paths; for each of the first `maxPages` pages: render to an offscreen canvas at ~2× scale, `recognize`, append text, report progress, `await new Promise(r => setTimeout(r))` between pages to yield the main thread; terminate the worker in `finally`.
- [ ] **Step 3 — Hook.** In `parsePdf`, when the text-length check fails, instead of returning immediately: call `ocrPdfPages(doc, OCR_MAX_PAGES, onPage)` (the `PDFDocumentProxy` is still open); if OCR yields ≥ `MIN_TEXT_CHARS`, return `status: 'partial'` with `warning: 'Text recognized via OCR (scanned document)'`; else the original `'unreadable'`. Progress: reuse the model-progress channel (`setModelProgress({ loaded: page, total, note: 'OCR: page x/y' })`) **and extend ProgressStrip's model-progress block (`ProgressStrip.tsx:128-147`) to render `modelProgress.note` when present** — today it renders hardcoded "Loading embedding model — N MB" copy and pipes `loaded/total` through `bytesToMB`, which would display garbage for page counts. Null the progress in `finally`.
- [ ] **Step 4 — Airgap gates.** Build `build:airgap`; if `sanitize-airgap.mjs`'s re-scan or the DLP goal flags new vendor hostnames embedded in the tesseract bundle, add them to the `HOSTS` list (`sanitize-airgap.mjs:28-33`). Manual acceptance (program spec 1.5): a scanned PDF produces a readable node in normal **and** airgap builds with the Network panel showing zero external requests.
- [ ] **Step 5 — Tests + commit.** Unit-test the pure text-threshold/decision helper (extract `shouldAttemptOcr(textLength): boolean` trivially or fold into existing pdf tests if any); OCR itself is verified manually (no worker harness — same policy as layoutBridge in Phase A). Commit: `feat(ingest): self-hosted OCR fallback for scanned PDFs`.

---

## Sequencing, verification, and risk

### Recommended order

| # | Task | Branch | Why this order |
|---|------|--------|----------------|
| 0 | Merge `quickwins-phase-p` → `main` | — | Process precondition (roadmap line 7); all branches fork from the merged main |
| 1 | B1 enrichment serialization | `feat/phase-b-lifecycle` | Smallest, kills the worst race first |
| 2 | B2 coordinator split | 〃 | Mandated before B3; shrinks every later diff |
| 3 | B3 ingest cancellation | 〃 | Needs B2's seams |
| 4 | B4 failure report | 〃 | Builds on B3's abort path |
| 5–7 | C1 / C2 / C3 | `feat/phase-c-quality` (parallelizable worktrees) | Mutually independent |
| 8 | D2 bundle diet | `feat/phase-d-reach` | Land before D1 so lazy-panel chunks settle first |
| 9 | D1 accessibility | 〃 | Touches many panels — after the lazy conversion |
| 10 | D3 quota + hover perf | 〃 | Independent |
| 11–14 | E1–E4 | `feat/phase-e-depth` | Independent of each other |
| 15 | E5 index-access flag | own branch | Wide mechanical diff — rebase pain; do when quiet |
| 16 | E6 OCR | own branch | Largest; stretch |

### Verification protocol (every task)

```sh
npm run lint && npm run typecheck && npm test
npm run build && npm run build:airgap    # airgap gates must stay green
```

plus each task's listed manual smoke in `npm run dev`, and — for anything touching ingest, chat, or persistence — a repeat of the key flow in the airgap preview with the Network panel open (**zero external requests**). Per program success criteria: after Phase C the airgap build is fully useful offline; after D2 the entry chunk is under budget and CI enforces it; after D1 the open-doc→read→close loop works without a mouse.

### Risk register

- **Concurrent sessions on this repo are real** (Phase P landed mid-research of this very plan). Re-run `git log --oneline -5` and re-verify a task's "current behavior" section before starting it.
- **`vi.mock` seams pin the coordinator's module path** — B2 must keep `'../pipeline/coordinator'` exporting the exact names seven test files enumerate.
- **Four lockstep filter sites** (emphasis / isEdgeHidden / EdgePulses / Minimap:139) — E3 touches them; `emphasis.test.ts` is the tripwire, extend it first, and route all four through the shared `edgePassesFilter`.
- **Dirty-flag rendering is on the roadmap's strengths-to-preserve list** — D3's scoped-recolor change edits that machinery directly; the `flagsForChange` unit test is the guard, and the manual 4k-node sweep must confirm selection/search still update matrices.
- **DB_VERSION bumps (E1)** orphan nothing but must ship the upgrade block; never rename existing stores/keys.
- **Bundle work (D2) can silently break workers** — the repo has prior scars (`optimizeDeps` comments); test dev + build + airgap after every vite.config change.
- **tesseract/tesseract.js API drift (E6)** — verify option names against installed types; never trust remembered signatures.
