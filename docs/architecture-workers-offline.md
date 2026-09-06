# Worker & offline-mode architecture

This app runs its whole ingest pipeline client-side: parsing, embedding,
linking, layout, and analytics all happen in web workers, with the main
thread limited to orchestration, state, and rendering. This note describes
how those pieces fit together and how the offline/airgap guarantees are
enforced.

## Coordinator and workers

`src/pipeline/coordinator.ts` is the main-thread orchestrator. It drives the
full ingest flow:

```
route → hash/dedupe → cache lookup → parse (worker pool / pdf worker)
  → lexical aggregation (corpus-wide) → embeddings → semantic edges
  + Louvain clustering → ready
```

It talks to five dedicated worker types, each with a distinct lifecycle:

- **Pipeline workers** (`src/workers/pipeline.worker.ts`) parse `txt`/`md`/`html`
  and run `bge-small-en-v1.5` embeddings via `@huggingface/transformers`.
  Multiple instances are pooled — see below. PDFs never route through the
  pool: their 60s parse deadline + 5min OCR budget doesn't fit the pool's
  30s parse timeout, and a pool worker's module scope would break the
  one-Tesseract-heap-at-a-time guarantee.
- **PDF worker** (`src/workers/pdf.worker.ts`) is a single dedicated instance
  that runs pdf.js text extraction and the Tesseract OCR fallback for scanned
  documents (pages rasterize into an `OffscreenCanvas` there; pdf.js and
  tesseract.js each spawn their own nested worker inside it). `parsePdf`
  (`src/pipeline/parsers/pdf.ts`) routes each document to it when the runtime
  has `Worker` + `OffscreenCanvas` and otherwise runs the same engine
  (`src/pipeline/parsers/pdfEngine.ts`) on the main thread — also the retry
  path when the worker crashes or wedges: one worker infrastructure failure
  retries that document on the main thread and pins main-thread mode for the
  rest of the session. The main-thread client
  (`src/pipeline/parsers/pdfWorkerClient.ts`) streams OCR progress back to
  the coordinator, wraps every request in a generous outer watchdog, and
  discards + respawns the worker on crash, timeout, or cancellation (in-flight
  pdf.js/Tesseract jobs can't be interrupted any other way). OCR settings are
  resolved on the main thread and travel with each request — worker code
  can't read the zustand settings store.
- **Aggregator worker** (`src/workers/aggregator.worker.ts`) is a single
  long-lived instance owned by the coordinator. It performs the corpus-wide
  passes that need every document at once: TF-IDF keywords, keyword/reference
  edges, boilerplate detection, mutual-top-k semantic similarity, and Louvain
  community clustering.
- **Layout worker** (`src/workers/layout.worker.ts`) runs the `d3-force-3d`
  simulation and streams node positions back as transferable `Float32Array`
  buffers, addressed by slot. `src/layout/layoutBridge.ts` owns slot
  assignment and buffer recycling on the main-thread side.
- **Insights worker** (`src/workers/insights.worker.ts`) computes the side
  panel's heavier analytics (betweenness-centrality bridges, hub ranking,
  per-cluster stats) as a separate stateless worker, so a slow betweenness
  pass never blocks the aggregator's ingest-critical work.

### Worker pool

`src/workers/pool.ts` (`WorkerPool`) manages the pipeline workers: up to
`POOL_SIZE` instances, created lazily, one in-flight job per worker with the
backlog queued inside the pool (not in each worker's own message queue, so a
job's timeout measures processing time rather than queueing time). Embedding
requests are pinned to a single warm worker — every pipeline worker has its
own module scope, so running embeddings concurrently across workers would
mean loading and compiling the model multiple times. The pool's dispatch loop
(`pump()`) skips over currently-blocked resource classes (embed vs. general)
so one busy embedding worker cannot stall unrelated parse jobs.

Worker failures are handled by retiring the failed worker and rejecting only
its in-flight request; the queued backlog continues against a freshly spawned
replacement. This trades a warm embedding model for bounded recovery when a
worker wedges.

### Dev-server dependency gotcha

`vite.config.ts` lists the worker entry points in `optimizeDeps.entries` so
their dependencies (remark, graphology, d3-force-3d, transformers.js's ORT
backends) are discovered and pre-bundled at dev-server start rather than
mid-session. Discovering a new dependency mid-ingest triggers Vite's
"optimized dependencies changed, reloading" and can silently abort an
in-flight parse. If you add a worker-only dependency, add its worker to that
list (or otherwise ensure the dependency is pre-bundled) or ingestion can
break in dev only.

## Offline mode and the airgap build

There are two related but distinct guarantees against network access:

- **`build:airgap`** (`src/airgap.ts`, `AIRGAP` constant) is a *build-time*
  guarantee: `AIRGAP` is true only in a build produced with
  `vite --mode airgap`, and every AI/network code path checks it. This is the
  guarantee backed by the production CSP.
- **Offline mode** (`src/offline.ts`, `isOffline()`) is a *runtime*,
  user-flippable counterpart: it is always true in airgap builds, and in
  normal builds it reflects the Settings toggle. This is JS-level enforcement
  only, not a security boundary — the airgap build is the actual guarantee for
  untrusted environments.

`installOfflineFetchGuard()` (called once at startup from `main.tsx`) wraps
`fetch`, `navigator.sendBeacon`, and the `WebSocket` constructor so that, while
offline, any cross-origin call fails before reaching the network. This is
defense in depth for code paths that forget to check `isOffline()` directly,
not the primary enforcement mechanism.

## Where to look next

- `src/pipeline/coordinator.ts` — full ingest/removal orchestration
- `src/workers/pool.ts` — worker pool scheduling and failure handling
- `src/layout/layoutBridge.ts` — layout worker's main-thread contract
- `src/offline.ts` / `src/airgap.ts` — offline/airgap enforcement
- `vite.config.ts` — dev-server `optimizeDeps` configuration for workers
