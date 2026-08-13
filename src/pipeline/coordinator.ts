/**
 * THE ORCHESTRATOR (main thread). Drives the full ingest flow:
 *
 *   route → hash/dedupe → cache lookup → parse (worker pool / pdf.js)
 *   → lexical aggregation (corpus-wide) → embeddings → semantic edges
 *   + Louvain clustering → ready.
 *
 * Also owns document REMOVAL (removeDocuments), which re-runs the two
 * corpus-wide aggregation passes — idf, title mentions, mutual-top-k and
 * Louvain all shift when corpus membership changes.
 *
 * Plain module — reads stores via getState(), never hooks. A second drop
 * (or a removal) while a run is in flight queues behind it (promise chain).
 */

import {
  DUP_SIM_THRESHOLD,
  EMBED_DIMS,
  ENTITY_EDGE_MIN_SHARED,
  ENTITY_EDGES_PER_DOC,
  KEYWORD_EDGE_MIN_SHARED,
  KEYWORD_EDGES_PER_DOC,
  MAX_EMBED_TEXT_BYTES,
  MAX_NODES,
  MIN_MENTION_TITLE_LEN,
  SIM_THRESHOLD,
  SIM_TOP_K,
  TFIDF_TOP_N,
  TOPIC_MAX_DOC_FRACTION,
  TOPIC_MIN_DOCS,
} from '../config';
import { embeddingQueryText } from '../ai/embeddingPolicy';
import type {
  AggRequest,
  AggResponse,
  DocNode,
  DuplicatePair,
  Edge,
  FileStatus,
  FileType,
  IngestFile,
  LexicalDocInput,
  LinkRef,
  PoolResponse,
} from '../model/types';
import { routeFile } from '../ingest/fileRouter';
import {
  layoutAddNodes,
  layoutReheat,
  layoutRemoveNodes,
  layoutReset,
  layoutSetClusters,
  layoutSetLinks,
} from '../layout/layoutBridge';
import {
  deleteDocsFromCache,
  deleteGraphFromCache,
  lookupDocCache,
  reportPersistenceUnavailable,
  saveDocsToCache,
} from '../persistence/cache';
import { deleteOriginals, putOriginalIfMissing } from '../persistence/originals';
import { saveSession } from '../persistence/sessionSave';
import {
  markActiveCorpusEmpty,
  unreferencedDocumentIds,
} from '../persistence/corpusRepository';
import { mimeForFilename } from '../util/fileMime';
import { computeLocalClusterNames } from '../graph/clusterNaming';
import { truncateToBytes } from '../util/bytes';
import { getNodePosition } from '../scene/positionBuffer';
import { useGraphStore } from '../store/graphStore';
import {
  chunkStore,
  clearRuntimeStores,
  dirtyDocIds,
  docLinksStore,
  docVectorStore,
  markDocsDirty,
  mdLinkTargetsStore,
  textStore,
} from '../store/runtimeStores';
import { useChatStore } from '../store/chatStore';
import { cancelChat } from '../chat/chatCancellation';
import { useUiStore } from '../store/uiStore';
import { getPool, type WorkerPool } from '../workers/pool';
import { stripBoilerplate } from './boilerplate';
import { documentContentId } from './documentId';
import { chunkText } from './chunker';
import { sha256Hex } from './hash';
import { parsePdf } from './parsers/pdf';
import { clearIngestAbort, registerIngestAbort } from './ingestCancellation';
import { enqueueRun } from './runQueue';
import { randomSpherePoint } from './spawnPosition';
import { addToSemanticIndex, edgesFromIndex, type SemanticIndex } from './similarity';
import { groupTopics } from './topics';
import { createGeneratedDemoDocuments } from '../demo/generatedDocuments';
import { fetchDemoManifest } from '../demo/manifest';

export { enqueueRun };

type ParseDone = Extract<PoolResponse, { type: 'parse:done' }>;
type EmbedBatchDone = Extract<PoolResponse, { type: 'embedBatch:done' }>;
type EmbedQueryDone = Extract<PoolResponse, { type: 'embedQuery:done' }>;
type LexicalDone = Extract<AggResponse, { type: 'lexical:done' }>;
type SemanticDone = Extract<AggResponse, { type: 'semantic:done' }>;
type ClusterDone = Extract<AggResponse, { type: 'cluster:done' }>;

// fly-in spawn shell (contract: random point on a ~140 radius shell, ±25 jitter)
const SPAWN_RADIUS = 140;
const SPAWN_JITTER = 25;

// ---------------------------------------------------------------------------
// aggregator worker client (single dedicated worker)
// ---------------------------------------------------------------------------

// Corpus-wide lexical/semantic passes are CPU-bound and bounded by MAX_NODES
// (no model-load step, unlike the embed pool) — generous relative to any
// realistic corpus size, but finite so a wedged worker can't hang the
// serialized run queue forever. Sits between pool.ts's PARSE_REQUEST_TIMEOUT_MS
// (30s, comparably cheap per-file work) and EMBED_REQUEST_TIMEOUT_MS (180s,
// which pays for model load) for a similar-order-of-magnitude, corpus-wide pass.
// Scaled by corpus size: the corpus-wide passes grow with document count, so a
// flat budget that is generous at 200 docs is a false alarm at 2000. The base
// covers fixed costs; the per-doc term tracks the work itself; the ceiling
// keeps a genuinely wedged worker from hanging the run queue indefinitely.
const AGG_BASE_TIMEOUT_MS = 60_000;
const AGG_PER_DOC_TIMEOUT_MS = 30;
const AGG_MAX_TIMEOUT_MS = 300_000;

function aggTimeoutFor(msg: AggRequest): number {
  const count =
    msg.type === 'lexical' ? msg.docs.length : 'ids' in msg ? msg.ids.length : 0;
  return Math.min(AGG_MAX_TIMEOUT_MS, AGG_BASE_TIMEOUT_MS + AGG_PER_DOC_TIMEOUT_MS * count);
}

let aggWorker: Worker | null = null;
let aggNextRequestId = 1;
const aggPending = new Map<
  number,
  {
    resolve: (response: AggResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

function failAllPending(error: Error): void {
  for (const [id, entry] of [...aggPending]) {
    aggPending.delete(id);
    clearTimeout(entry.timer);
    entry.reject(error);
  }
}

/**
 * Reject everything in flight and drop the worker so the next request respawns
 * a clean one. Used for crashes, undecodable messages, and timeouts alike —
 * in every case the worker's state can no longer be trusted.
 */
function discardAggregator(error: Error): void {
  failAllPending(error);
  aggWorker?.terminate();
  aggWorker = null;
}

function ensureAggregator(): Worker {
  if (aggWorker) return aggWorker;
  aggWorker = new Worker(new URL('../workers/aggregator.worker.ts', import.meta.url), {
    type: 'module',
  });
  aggWorker.onmessage = (ev: MessageEvent<AggResponse>) => {
    const msg = ev.data;
    const entry = aggPending.get(msg.requestId);
    if (!entry) return;
    aggPending.delete(msg.requestId);
    clearTimeout(entry.timer);
    if (msg.type === 'error') entry.reject(new Error(msg.message));
    else entry.resolve(msg);
  };
  aggWorker.onerror = (ev: ErrorEvent) => {
    discardAggregator(new Error(ev.message || 'aggregator worker crashed'));
  };
  aggWorker.onmessageerror = () => {
    // A message that couldn't be structured-cloned/decoded leaves whatever
    // request it was replying to (and every OTHER pending request on this
    // worker — we can no longer trust its state) hanging forever without
    // this: reject everything in flight and respawn, same as a crash.
    discardAggregator(new Error('aggregator worker message could not be decoded'));
  };
  return aggWorker;
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error
    ? reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function aggRequest<T extends AggResponse>(
  msg: AggRequest,
  transfer?: Transferable[],
  options?: { signal?: AbortSignal },
): Promise<T> {
  const signal = options?.signal;
  if (signal?.aborted) return Promise.reject(abortError(signal));
  const worker = ensureAggregator();
  const requestId = aggNextRequestId;
  aggNextRequestId += 1;
  const payload = { ...msg, requestId } as AggRequest;
  const timeoutMs = aggTimeoutFor(msg);
  return new Promise<T>((resolve, reject) => {
    // A timeout means this worker is wedged, so tear it down rather than just
    // rejecting the request. The worker is single-threaded: leaving it running
    // starves every later lexical/semantic/cluster pass behind the stuck one,
    // so a single timeout used to cascade into permanent failure that only a
    // reload cleared. Runs are serialized by the queue, so there is at most one
    // request in flight and effectively nothing else to take down with it.
    const timer = setTimeout(() => {
      if (!aggPending.has(requestId)) return;
      discardAggregator(
        new Error(`aggregator worker request timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);
    const onAbort = signal
      ? () => {
          if (!aggPending.has(requestId)) return;
          // A cancelled corpus-wide pass is pure CPU burn with no model state
          // to protect (unlike the embed pool) — discard the worker outright
          // rather than letting it run to completion under the next ingest.
          discardAggregator(abortError(signal));
        }
      : null;
    // Detach the abort listener however the request settles, so a shared
    // per-run signal doesn't accumulate dead listeners.
    const settled =
      <A,>(fn: (arg: A) => void) =>
      (arg: A): void => {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
        fn(arg);
      };
    if (signal && onAbort) signal.addEventListener('abort', onAbort);
    aggPending.set(requestId, {
      // correlated by requestId at runtime; caller asserts the subtype
      resolve: settled(resolve) as unknown as (response: AggResponse) => void,
      reject: settled(reject),
      timer,
    });
    if (transfer && transfer.length > 0) worker.postMessage(payload, transfer);
    else worker.postMessage(payload);
  });
}

// ---------------------------------------------------------------------------
// per-run bookkeeping
// ---------------------------------------------------------------------------

/**
 * Lexical metadata (term frequencies, original filename) lives outside
 * DocNode; kept per docId for corpus-wide lexical reruns. Docs hydrated
 * from cache are backfilled via a worker 'analyze' pass. Md link targets
 * live in mdLinkTargetsStore instead (they're not recoverable from
 * extracted text, so they're persisted directly rather than backfilled).
 */
interface LexMeta {
  tf: Record<string, number>;
  totalTerms: number;
  fileName: string;
}
const lexMeta = new Map<string, LexMeta>();

/** docId -> ephemeral ingest fileId/name of the CURRENT run (status chips). */
const fileIdOfDoc = new Map<string, string>();
const nameOfDoc = new Map<string, string>();

let modelProgressWired = false;
function wireModelProgress(): void {
  if (modelProgressWired) return;
  modelProgressWired = true;
  const pool = getPool();
  pool.onModelProgress((p) => {
    useGraphStore.getState().setModelProgress({
      kind: 'embedding-model',
      loaded: p.loaded,
      total: p.total,
      note: p.note,
    });
  });
  pool.onWorkerCrash(() => {
    useUiStore
      .getState()
      .pushToast(
        'A background worker crashed and was restarted - processing continues.',
        'warning',
      );
  });
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function parentDir(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const normalized = path.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return slash > 0 ? normalized.slice(0, slash) : undefined;
}

function makeSummary(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 200).trimEnd()}…` : flat;
}

function randomSpawn(): [number, number, number] {
  return randomSpherePoint(SPAWN_RADIUS, SPAWN_JITTER);
}

function documentNodes(): DocNode[] {
  return useGraphStore.getState().nodes.filter((n) => n.kind === 'document');
}

function toLinkInput(edges: Edge[]): { source: string; target: string; weight: number }[] {
  return edges.map((e) => ({ source: e.source, target: e.target, weight: e.weight }));
}

// ---------------------------------------------------------------------------
// ingest flow
// ---------------------------------------------------------------------------

interface PendingFile {
  file: IngestFile;
  fileType: FileType;
  id: string; // content hash = DocNode id
  relPath: string; // folder-relative path, or the bare filename
  /**
   * Exact ingested bytes, snapshotted BEFORE the parse step transfers (and
   * detaches) file.bytes — this is what "Open original file" hands back.
   */
  original: Blob;
}

async function runIngest(files: IngestFile[], signal?: AbortSignal): Promise<void> {
  wireModelProgress();
  throwIfAborted(signal);
  const store = useGraphStore.getState; // fresh state per call; actions are stable

  // (a) route by extension; unsupported → ignored tray
  const routed: { file: IngestFile; fileType: FileType }[] = [];
  for (const file of files) {
    const fileType = routeFile(file.name);
    if (!fileType) {
      store().addIgnored(file.name, 'unsupported type');
      continue;
    }
    store().setFileStatus({ fileId: file.fileId, name: file.name, stage: 'queued' });
    routed.push({ file, fileType });
  }

  // (b) content ids; duplicates (within the drop or vs the store) → cached
  const seenIds = new Set<string>();
  const pending: PendingFile[] = [];
  for (const { file, fileType } of routed) {
    // hashing a large drop takes real time — bail between files, not after
    throwIfAborted(signal);
    const relPath = file.path ?? file.name;
    const id = await documentContentId(relPath, file.bytes);
    // Reconstructable sources (generated demo docs) skip original retention:
    // their bytes rebuild on demand, so an empty Blob stands in and the
    // thousands of redundant IndexedDB original-writes never happen.
    const original = file.reconstructable
      ? new Blob([])
      : new Blob([file.bytes], { type: mimeForFilename(file.name) });
    if (seenIds.has(id) || store().nodeIndex[id] !== undefined) {
      // known doc — backfill the original if it predates original retention
      if (!file.reconstructable) void putOriginalIfMissing(id, file.name, original);
      store().setFileStatus({ fileId: file.fileId, name: file.name, stage: 'cached' });
      continue;
    }
    seenIds.add(id);
    pending.push({ file, fileType, id, relPath, original });
  }
  if (pending.length === 0) return; // nothing new — leave the corpus untouched

  // (c) IndexedDB cache lookup (persistence subsystem)
  const lookups = await Promise.all(
    pending.map(async (p) => ({
      p,
      cached: await lookupDocCache(p.id).catch(() => undefined),
    })),
  );
  throwIfAborted(signal);
  const misses: PendingFile[] = [];
  for (const { p, cached } of lookups) {
    fileIdOfDoc.set(p.id, p.file.fileId);
    nameOfDoc.set(p.id, p.file.name);
    if (!cached) {
      misses.push(p);
      continue;
    }
    const dropped = layoutAddNodes([{ id: p.id, cluster: cached.node.cluster, spawn: randomSpawn() }]);
    if (dropped.length > 0) {
      store().addIgnored(p.file.name, `node limit reached (${MAX_NODES} max)`);
      store().setFileStatus({
        fileId: p.file.fileId,
        name: p.file.name,
        stage: 'error',
        error: `Node limit reached (${MAX_NODES} max)`,
      });
      continue;
    }
    store().addNodes([cached.node]);
    textStore.set(p.id, cached.text);
    chunkStore.set(p.id, {
      texts: cached.chunkTexts,
      vectors: cached.chunkVectors,
      dims: EMBED_DIMS,
    });
    if (cached.docVector) docVectorStore.set(p.id, cached.docVector);
    mdLinkTargetsStore.set(p.id, cached.mdLinkTargets);
    docLinksStore.set(p.id, cached.docLinks);
    if (!p.file.reconstructable) void putOriginalIfMissing(p.id, p.file.name, p.original);
    store().setFileStatus({ fileId: p.file.fileId, name: p.file.name, stage: 'cached' });
  }

  // (d) parse misses — pdf on the main thread, everything else in the pool
  const pool = getPool();
  if (misses.length > 0) {
    store().setPhase('parsing');
    // A parsed doc waiting to be committed to the graph/layout/runtime stores.
    // Parsing runs concurrently across the pool, but commits are flushed in
    // fixed-size groups so a large drop makes ~tens of store/layout updates
    // instead of one per file (each store action clones growing arrays/maps,
    // so per-file commits are quadratic on a 2,500-doc corpus).
    interface ParsedResult {
      p: PendingFile;
      doc: ParseDone['doc'];
      pdfLinks: LinkRef[];
    }
    store().setFileStatuses(
      misses.map((p) => ({ fileId: p.file.fileId, name: p.file.name, stage: 'parsing' as const })),
    );
    const parseTasks = misses.map(async (p): Promise<ParsedResult> => {
      let done: ParseDone;
      // pdf.js extracts labelled links from the annotation layer; the worker's
      // 'analyze' path can't (it only sees text), so carry them across here.
      let pdfLinks: LinkRef[] = [];
      if (p.fileType === 'pdf') {
        const pdf = await parsePdf(p.file.bytes, p.file.name, {
          onOcrProgress: (completed, total) => {
            store().setModelProgress({
              kind: 'ocr',
              loaded: completed,
              total,
              note:
                completed === 0
                  ? `Preparing OCR for ${p.file.name}`
                  : `OCR ${p.file.name} — page ${completed} of ${total}`,
            });
          },
        });
        pdfLinks = pdf.links;
        done = await pool.request<ParseDone>(
          {
            requestId: 0,
            type: 'analyze',
            fileId: p.file.fileId,
            name: p.file.name,
            path: p.file.path,
            fileType: p.fileType,
            docId: p.id,
            title: pdf.title,
            text: pdf.text,
            status: pdf.status,
            warning: pdf.warning,
          },
          undefined,
          { signal },
        );
      } else {
        done = await pool.request<ParseDone>(
          {
            requestId: 0,
            type: 'parse',
            fileId: p.file.fileId,
            name: p.file.name,
            path: p.file.path,
            fileType: p.fileType,
            bytes: p.file.bytes,
          },
          [p.file.bytes],
          { signal },
        );
      }
      return { p, doc: done.doc, pdfLinks };
    });

    // Commit one parsed result into the runtime stores + layout. Returns the
    // node to add and the placed status, or null when the node-cap was hit.
    const commitParsed = ({ p, doc, pdfLinks }: ParsedResult): { node: DocNode } | null => {
      const dropped = layoutAddNodes([{ id: p.id, cluster: -1, spawn: randomSpawn() }]);
      if (dropped.length > 0) {
        store().addIgnored(p.file.name, `node limit reached (${MAX_NODES} max)`);
        store().setFileStatus({
          fileId: p.file.fileId,
          name: p.file.name,
          stage: 'error',
          error: `Node limit reached (${MAX_NODES} max)`,
        });
        return null;
      }
      lexMeta.set(p.id, { tf: doc.tf, totalTerms: doc.totalTerms, fileName: p.file.name });
      mdLinkTargetsStore.set(
        p.id,
        p.fileType === 'pdf' ? pdfLinks.map((l) => l.url) : doc.mdLinkTargets,
      );
      docLinksStore.set(p.id, p.fileType === 'pdf' ? pdfLinks : doc.docLinks);
      textStore.set(p.id, doc.text);
      if (!p.file.reconstructable) void putOriginalIfMissing(p.id, p.file.name, p.original);
      const node: DocNode = {
        id: p.id,
        kind: 'document',
        title: doc.title,
        fileType: p.fileType,
        path: p.relPath,
        folderKey: parentDir(p.file.path),
        summary: makeSummary(doc.text),
        topics: [],
        entities: doc.entities,
        keywords: [],
        wordCount: doc.wordCount,
        cluster: -1,
        degree: 0,
        status: doc.status,
        warning: doc.warning,
        lastModified: p.file.lastModified,
      };
      return { node };
    };

    // Flush a group of parsed results as a single batch of store updates.
    const flushBatch = (results: ParsedResult[]): void => {
      const nodes: DocNode[] = [];
      const dirtyIds: string[] = [];
      const placed: FileStatus[] = [];
      for (const result of results) {
        const committed = commitParsed(result);
        if (!committed) continue;
        nodes.push(committed.node);
        dirtyIds.push(result.p.id);
        placed.push({
          fileId: result.p.file.fileId,
          name: result.p.file.name,
          stage: 'placed',
        });
      }
      if (nodes.length > 0) {
        store().addNodes(nodes);
        markDocsDirty(dirtyIds);
        store().setFileStatuses(placed);
      }
    };

    // Flush as workers finish rather than retaining every ParseDone until the
    // slowest parser/OCR job settles. Promise callbacks run serially on the
    // main thread, so this shared buffer needs no lock.
    const completed: ParsedResult[] = [];
    let completedFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushCompleted = (): void => {
      if (completedFlushTimer !== null) {
        clearTimeout(completedFlushTimer);
        completedFlushTimer = null;
      }
      if (completed.length > 0) flushBatch(completed.splice(0));
    };
    const trackedTasks = parseTasks.map((task) =>
      task.then((result) => {
        completed.push(result);
        if (completed.length >= PARSE_COMMIT_BATCH) {
          flushCompleted();
        } else if (completedFlushTimer === null) {
          // Drain a partial batch promptly so a 40–60-file ingest (or the
          // tail of a larger one) is not held behind one slow OCR/parser.
          completedFlushTimer = setTimeout(() => {
            completedFlushTimer = null;
            if (completed.length > 0) flushBatch(completed.splice(0));
          }, 50);
        }
      }),
    );
    const settled = await Promise.allSettled(trackedTasks);
    flushCompleted();
    // Docs parsed before the abort landed stay committed (finished work is
    // kept); bail before painting the cancellation rejections as error chips.
    throwIfAborted(signal);
    // OCR calls are serialized but parse tasks are concurrent. Clear only
    // after every parse task settles so one PDF cannot erase the next queued
    // PDF's freshly-published progress update.
    if (store().modelProgress?.kind === 'ocr') store().setModelProgress(null);
    settled.forEach((result, i) => {
      if (result.status !== 'rejected') return;
      const p = misses[i];
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      // failed files keep an error chip; no ghosted node is added
      store().setFileStatus({
        fileId: p.file.fileId,
        name: p.file.name,
        stage: 'error',
        error: message,
      });
    });
  }

  if (documentNodes().length === 0) {
    store().setPhase('idle');
    return;
  }

  // (e) lexical aggregation over the WHOLE corpus (idf + title mentions
  // are corpus-wide, so every drop rebuilds them)
  const { lexEdges, boilerplate } = await runLexicalPass(pool, signal);

  // (f) embeddings for docs that still need a vector
  const embedTargets = documentNodes().filter(
    (n) => n.status !== 'unreadable' && !docVectorStore.has(n.id) && textStore.has(n.id),
  );
  if (embedTargets.length > 0) {
    store().setPhase('embedding');
    await runEmbeddingPass(pool, embedTargets, boilerplate, signal);
    store().setModelProgress(null);
  }
  throwIfAborted(signal);

  // (f2) eager KB flush: the parse + embed work of THIS drop reaches
  // IndexedDB now, not 1.5s after 'ready' — a tab closed mid-run re-drops as
  // cache hits instead of re-parsing. Node snapshots here predate clustering
  // (cluster -1) and enrichment; that's fine: these records are only consumed
  // by lookupDocCache on a future drop, which re-runs the corpus-wide passes,
  // and the post-ready session save overwrites them with final nodes.
  if (misses.length > 0) {
    const flushDocs = misses
      .map((p) => store().nodes[store().nodeIndex[p.id]])
      // parse failures / node-limit drops never entered the store
      .filter((n): n is DocNode => n !== undefined)
      .map((node) => ({
        node,
        text: textStore.get(node.id) ?? '',
        chunkTexts: chunkStore.get(node.id)?.texts ?? [],
        chunkVectors: chunkStore.get(node.id)?.vectors ?? null,
        docVector: docVectorStore.get(node.id) ?? null,
        mdLinkTargets: mdLinkTargetsStore.get(node.id) ?? [],
        docLinks: docLinksStore.get(node.id) ?? [],
      }));
    // fire-and-forget; quota failures degrade via the cache's one-time warning
    void saveDocsToCache(flushDocs);
  }

  // (g) semantic edges + Louvain clustering over the full edge set
  await runSemanticPass(lexEdges, signal);

  // (h) synthesize topic concept nodes (spec §5.4)
  synthesizeTopicNodes();

  store().setCorpusHash(await computeCorpusHash());
  store().setPhase('ready');

  // Persist the completed uploaded corpus immediately, so quitting right after
  // ingest still restores these files on the next launch.
  await saveSession();
}

// ---------------------------------------------------------------------------
// corpus-wide aggregation passes (shared by ingest and removal)
// ---------------------------------------------------------------------------

// How many documents' chunks to pack into one worker embed request. The worker
// still batches chunks through the model internally; this bounds how many docs
// share a single round trip (and one status/commit flush) so a 2,500-doc
// corpus makes ~tens of requests instead of one per document.
const EMBED_DOCS_PER_REQUEST = 32;

// How many parsed documents to commit to the graph/layout/runtime stores in
// one flush. Bounds how often the growing node array / status map are cloned
// during a large ingest without holding all results back to a single commit.
const PARSE_COMMIT_BATCH = 64;

interface EmbedTarget {
  id: string;
  title: string;
  chunks: string[];
}

/**
 * Prepare a document for embedding: strip corpus boilerplate, chunk, surface a
 * truncation warning, and stage its chunk texts. Returns null when nothing is
 * embeddable (e.g. a boilerplate-only doc).
 */
function prepareEmbedTarget(n: DocNode, boilerplate: Set<string>): EmbedTarget | null {
  const text = textStore.get(n.id) ?? '';
  const { chunks, truncated } = chunkText(stripBoilerplate(text, boilerplate));
  if (chunks.length === 0) return null;
  if (truncated && n.status !== 'unreadable' && !n.warning) {
    // Large document: search/embeddings cover only the leading portion.
    // Surface it instead of silently indexing part of the doc.
    const kb = Math.round(MAX_EMBED_TEXT_BYTES / 1024);
    useGraphStore
      .getState()
      .patchNodes(
        new Map([[n.id, { status: 'partial', warning: `Only the first ~${kb} KB indexed for search` }]]),
      );
  }
  chunkStore.set(n.id, { texts: chunks, vectors: null, dims: EMBED_DIMS });
  return { id: n.id, title: n.title, chunks };
}

/**
 * Ingest step (f): embed every target document. Chunks are packed across
 * document boundaries into batched worker requests (EMBED_DOCS_PER_REQUEST
 * docs each), so a single-chunk document no longer costs a full inference
 * round trip. Status chips and the dirty-doc flush are committed per batch.
 * One failed batch is isolated: its docs get an error chip and the rest of
 * the corpus still embeds.
 */
async function runEmbeddingPass(
  pool: WorkerPool,
  nodes: DocNode[],
  boilerplate: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  const store = useGraphStore.getState;
  const targets: EmbedTarget[] = [];
  for (const n of nodes) {
    const target = prepareEmbedTarget(n, boilerplate);
    if (target) targets.push(target);
  }
  if (targets.length === 0) return;

  // None of these documents is complete yet. Publishing this once up front
  // keeps the progress counter honest while batches run sequentially.
  store().setFileStatuses(
    targets.flatMap((target): FileStatus[] => {
      const fileId = fileIdOfDoc.get(target.id);
      return fileId
        ? [{ fileId, name: nameOfDoc.get(target.id) ?? target.title, stage: 'embedding' }]
        : [];
    }),
  );

  for (let start = 0; start < targets.length; start += EMBED_DOCS_PER_REQUEST) {
    throwIfAborted(signal);
    const batch = targets.slice(start, start + EMBED_DOCS_PER_REQUEST);
    try {
      const done = await pool.request<EmbedBatchDone>(
        {
          requestId: 0,
          type: 'embedBatch',
          docs: batch.map((t) => ({ docId: t.id, chunks: t.chunks })),
        },
        undefined,
        { signal },
      );
      const chunksById = new Map(batch.map((t) => [t.id, t.chunks]));
      const embeddedIds: string[] = [];
      const placedStatuses: FileStatus[] = [];
      for (const result of done.docs) {
        const chunks = chunksById.get(result.docId) ?? [];
        docVectorStore.set(result.docId, result.docVector);
        chunkStore.set(result.docId, { texts: chunks, vectors: result.chunkVectors, dims: EMBED_DIMS });
        embeddedIds.push(result.docId);
        const fileId = fileIdOfDoc.get(result.docId);
        if (fileId) {
          placedStatuses.push({
            fileId,
            name: nameOfDoc.get(result.docId) ?? result.docId,
            stage: 'placed',
          });
        }
      }
      store().setFileStatuses(placedStatuses);
      markDocsDirty(embeddedIds);
    } catch (err) {
      // cancellation is not an embedding failure — no error chips
      if (signal?.aborted) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const errorStatuses: FileStatus[] = [];
      for (const t of batch) {
        console.error(`embedding failed for ${t.title}:`, message);
        const fileId = fileIdOfDoc.get(t.id);
        if (fileId) {
          errorStatuses.push({
            fileId,
            name: nameOfDoc.get(t.id) ?? t.title,
            stage: 'error',
            error: message,
          });
        }
      }
      store().setFileStatuses(errorStatuses);
    }
  }
}

/** Ingest step (e): lexical edges, keywords, boilerplate — whole corpus. */
async function runLexicalPass(
  pool: WorkerPool,
  signal?: AbortSignal,
): Promise<{ lexEdges: Edge[]; boilerplate: Set<string> }> {
  const store = useGraphStore.getState;
  throwIfAborted(signal);
  store().setPhase('linking');
  await backfillLexMeta(pool);
  const lexicalDocs: LexicalDocInput[] = documentNodes().map((n) => {
    const meta = lexMeta.get(n.id);
    const text = textStore.get(n.id) ?? '';
    return {
      id: n.id,
      title: n.title,
      fileName: meta?.fileName ?? basename(n.path ?? n.title),
      tf: meta?.tf ?? {},
      totalTerms: meta?.totalTerms ?? 0,
      textLower: truncateToBytes(text, MAX_EMBED_TEXT_BYTES).toLowerCase(),
      mdLinkTargets: mdLinkTargetsStore.get(n.id) ?? [],
      entities: n.entities, // shared-entity edges (persisted on the node)
    };
  });

  let lexEdges: Edge[] = [];
  let boilerplate = new Set<string>();
  try {
    const lexical = await aggRequest<LexicalDone>(
      {
        requestId: 0,
        type: 'lexical',
        docs: lexicalDocs,
        params: {
          tfidfTopN: TFIDF_TOP_N,
          minShared: KEYWORD_EDGE_MIN_SHARED,
          edgesPerDoc: KEYWORD_EDGES_PER_DOC,
          minTitleLen: MIN_MENTION_TITLE_LEN,
          entityMinShared: ENTITY_EDGE_MIN_SHARED,
          entityEdgesPerDoc: ENTITY_EDGES_PER_DOC,
        },
      },
      undefined,
      { signal },
    );
    lexEdges = lexical.edges;
    boilerplate = new Set(lexical.boilerplateLines);

    const nodesById = new Map(documentNodes().map((n) => [n.id, n]));
    const patches = new Map<string, Partial<DocNode>>();
    for (const [docId, keywords] of Object.entries(lexical.keywordsByDoc)) {
      const existing = nodesById.get(docId);
      if (!existing) continue;
      // topics = TF-IDF fallback; never clobber canonical (enriched) topics
      patches.set(
        docId,
        existing.topics.length > 0
          ? { keywords }
          : { keywords, topics: keywords.slice(0, 5) },
      );
    }
    store().patchNodes(patches);
    store().setEdges(lexEdges);
    layoutSetLinks(toLinkInput(lexEdges));
    layoutReheat(0.8);
  } catch (err) {
    // cancellation must propagate, not degrade into a "linking failed" toast
    if (signal?.aborted) throw err;
    console.error('lexical aggregation failed', err);
    lexEdges = store().edges;
    useUiStore
      .getState()
      .pushToast('Keyword linking failed — connections may be incomplete.', 'warning');
  }
  return { lexEdges, boilerplate };
}

// ---------------------------------------------------------------------------
// incremental semantic similarity (see similarity.ts's SemanticIndex)
// ---------------------------------------------------------------------------

const SIM_PARAMS = { threshold: SIM_THRESHOLD, topK: SIM_TOP_K, dupThreshold: DUP_SIM_THRESHOLD };

/**
 * Full O(n²) rebuilds are still exact and cheap in absolute terms, but
 * happen every REBUILD_INTERVAL additions anyway (rather than never) as a
 * defensive floor: it bounds the incremental cache's lifetime so a subtle
 * bug in the incremental path (or an id churn pattern this module didn't
 * anticipate) can only drift for a bounded number of ingests before
 * self-healing, and it re-derives `semanticIndex.vectors` fresh from
 * docVectorStore so that store can never silently diverge from the graph.
 */
const SEMANTIC_REBUILD_INTERVAL = 25;

/** Cached across ingest runs; cleared on removal/reset to force a rebuild. */
let semanticIndex: SemanticIndex | null = null;
let additionsSinceRebuild = 0;

function resetSemanticIndex(): void {
  semanticIndex = null;
  additionsSinceRebuild = 0;
}

function vectorsFor(ids: string[]): Float32Array {
  const vectors = new Float32Array(ids.length * EMBED_DIMS);
  ids.forEach((id, i) => {
    const vector = docVectorStore.get(id);
    if (vector) vectors.set(vector.subarray(0, EMBED_DIMS), i * EMBED_DIMS);
  });
  return vectors;
}

/** Ingest step (g): semantic edges + Louvain clustering over the full edge set. */
async function runSemanticPass(lexEdges: Edge[], signal?: AbortSignal): Promise<void> {
  const store = useGraphStore.getState;
  throwIfAborted(signal);
  store().setPhase('connecting');
  const embedded = documentNodes().filter((n) => docVectorStore.has(n.id));
  if (embedded.length === 0) return;
  const ids = embedded.map((n) => n.id);

  const cachedIds = semanticIndex?.ids ?? [];
  const cachedIdSet = new Set(cachedIds);
  const idSet = new Set(ids);
  // A doc leaving the corpus (removal) invalidates the cache outright —
  // runRemove() already calls resetSemanticIndex(), but guard here too in
  // case a future caller reaches this without going through it.
  const cacheIsStale = cachedIds.some((id) => !idSet.has(id));
  const newIds = cacheIsStale ? [] : ids.filter((id) => !cachedIdSet.has(id));
  const needsFullRebuild =
    !semanticIndex ||
    cacheIsStale ||
    additionsSinceRebuild + newIds.length > SEMANTIC_REBUILD_INTERVAL;

  try {
    let edges: Edge[];
    let duplicates: DuplicatePair[];
    let clusters: Record<string, number>;

    if (needsFullRebuild) {
      // Full O(n²) pass, offloaded to the aggregator worker — periodic
      // (see SEMANTIC_REBUILD_INTERVAL) rather than on every ingest.
      const vectors = vectorsFor(ids);
      const semantic = await aggRequest<SemanticDone>(
        {
          requestId: 0,
          type: 'semantic',
          ids,
          vectors,
          dims: EMBED_DIMS,
          existingEdges: toLinkInput(lexEdges),
          params: SIM_PARAMS,
        },
        [vectors.buffer], // `vectors` is a copy; the doc vectors stay in the store
        { signal },
      );
      edges = semantic.edges;
      duplicates = semantic.duplicates;
      clusters = semantic.clusters;
      // Cache the rebuilt index for the next incremental pass. `vectors` was
      // transferred (detached) above, so re-derive a fresh copy here — an
      // O(n) memory copy, not the O(n²) similarity pass the worker just did.
      semanticIndex = {
        ids: [...ids],
        vectors: vectorsFor(ids),
        dims: EMBED_DIMS,
        top: semantic.top,
        duplicates,
      };
      additionsSinceRebuild = 0;
    } else {
      // Incremental fast path: only new-doc × existing-corpus (and new×new)
      // pairs are computed — see similarity.ts's addToSemanticIndex — so
      // cost scales with the SIZE OF THE NEW BATCH, not the corpus. Cheap
      // enough to run on the main thread without a worker round trip.
      const newVectors = vectorsFor(newIds);
      semanticIndex = addToSemanticIndex(semanticIndex!, newIds, newVectors, SIM_PARAMS);
      additionsSinceRebuild += newIds.length;
      edges = edgesFromIndex(semanticIndex, SIM_THRESHOLD);
      duplicates = semanticIndex.duplicates;

      // Clustering still needs a corpus-wide pass over the FULL edge set
      // whenever membership shifts — offload the Louvain pass (which is
      // comparatively cheap next to a full similarity rescan) to the
      // worker without repaying the O(n²) similarity cost above.
      const mergedForCluster = new Map<string, Edge>();
      for (const edge of [...lexEdges, ...edges]) {
        if (!mergedForCluster.has(edge.id)) mergedForCluster.set(edge.id, edge);
      }
      const clusterResp = await aggRequest<ClusterDone>(
        {
          requestId: 0,
          type: 'cluster',
          ids,
          edges: toLinkInput([...mergedForCluster.values()]),
        },
        undefined,
        { signal },
      );
      clusters = clusterResp.clusters;
    }

    store().setDuplicatePairs(duplicates);
    const merged = new Map<string, Edge>();
    for (const edge of [...lexEdges, ...edges]) {
      if (!merged.has(edge.id)) merged.set(edge.id, edge);
    }
    const allEdges = [...merged.values()];
    store().setEdges(allEdges);

    const patches = new Map<string, Partial<DocNode>>();
    for (const [docId, cluster] of Object.entries(clusters)) {
      patches.set(docId, { cluster });
    }
    store().patchNodes(patches);

    // Keyword-derived cluster names, refreshed whenever membership shifts.
    // AI-enriched names (clusterNames) still win in the UI fallback chain.
    store().setLocalClusterNames(computeLocalClusterNames(store().nodes));

    layoutSetLinks(toLinkInput(allEdges));
    layoutSetClusters(clusters);
    layoutReheat(0.5);
  } catch (err) {
    // Whatever's cached may not match what actually landed in the store —
    // force a full rebuild next time rather than compounding a bad state.
    resetSemanticIndex();
    // cancellation must propagate, not degrade into a "similarity failed" toast
    if (signal?.aborted) throw err;
    console.error('semantic aggregation failed', err);
    useUiStore
      .getState()
      .pushToast(
        'Similarity analysis failed — semantic connections and clusters may be stale.',
        'warning',
      );
  }
}

/** Corpus identity = SHA-256 over the sorted doc ids (spec §8.4). */
async function computeCorpusHash(): Promise<string> {
  const sortedIds = documentNodes()
    .map((n) => n.id)
    .sort();
  return sha256Hex(sortedIds.join(''));
}

// ---------------------------------------------------------------------------
// topic node synthesis (spec §5.4)
// ---------------------------------------------------------------------------

const TOPIC_EDGE_WEIGHT = 0.5;

/**
 * Create synthetic topic-concept nodes for topics shared by ≥TOPIC_MIN_DOCS
 * documents. groupTopics folds label variants (case / separators, and safe
 * singular/plural pairs) into one hub and drops corpus-ubiquitous topics that
 * would only tangle unrelated clusters. Each hub connects via topic edges to
 * every document that carries it. Must run AFTER clustering (so hubs inherit
 * the majority cluster). Existing topic nodes from a previous run are removed
 * first (idempotent).
 */
function synthesizeTopicNodes(): void {
  const store = useGraphStore.getState;

  // Remove any previously synthesized topic nodes + edges before rebuilding
  const existingTopics = store().nodes.filter((n) => n.kind === 'topic').map((n) => n.id);
  if (existingTopics.length > 0) store().removeNodes(existingTopics);

  const groups = groupTopics(
    documentNodes().map((n) => ({ id: n.id, topics: n.topics })),
    { minDocs: TOPIC_MIN_DOCS, maxDocFraction: TOPIC_MAX_DOC_FRACTION },
  );

  const newNodes: DocNode[] = [];
  const newEdges: Edge[] = [];

  for (const { key, label, docIds } of groups) {
    const topicId = `topic:${key}`;

    // Inherit the majority cluster from connected documents
    const clusterVotes = new Map<number, number>();
    for (const docId of docIds) {
      const idx = store().nodeIndex[docId];
      if (idx === undefined) continue;
      const c = store().nodes[idx].cluster;
      if (c >= 0) clusterVotes.set(c, (clusterVotes.get(c) ?? 0) + 1);
    }
    let bestCluster = -1;
    let bestCount = 0;
    for (const [c, count] of clusterVotes) {
      if (count > bestCount) { bestCluster = c; bestCount = count; }
    }

    const topicNode: DocNode = {
      id: topicId,
      kind: 'topic',
      title: label,
      fileType: 'other',
      topics: [label],
      entities: [],
      keywords: [],
      wordCount: 0,
      cluster: bestCluster,
      degree: docIds.length,
      status: 'ok',
    };
    newNodes.push(topicNode);

    // Create topic edges from each doc to the topic node
    for (const docId of docIds) {
      newEdges.push({
        id: `${docId}->${topicId}:topic`,
        source: docId,
        target: topicId,
        kind: 'topic',
        weight: TOPIC_EDGE_WEIGHT,
        evidence: [`Shared topic: "${label}"`],
      });
    }
  }

  // Free the layout slots of topic hubs that no longer exist — without this,
  // per-ingest topic churn leaks slots toward MAX_NODES and leaves ghost
  // geometry at the stale positions. Surviving hubs keep their slot (and
  // position): layoutAddNodes skips ids that already have one.
  const newIds = new Set(newNodes.map((n) => n.id));
  const staleTopicIds = existingTopics.filter((id) => !newIds.has(id));
  if (staleTopicIds.length > 0) layoutRemoveNodes(staleTopicIds);

  if (newNodes.length === 0) return;

  // Place in layout FIRST: hubs dropped at node capacity must not enter the
  // store (invisible phantoms) or keep edges (dangling endpoints crash the
  // layout worker — same hazard validateImport guards imports against).
  const layoutInputs = newNodes.map((n) => ({
    id: n.id,
    cluster: n.cluster,
    spawn: randomSpawn() as [number, number, number],
  }));
  const droppedIds = new Set(layoutAddNodes(layoutInputs));
  const placedNodes = newNodes.filter((n) => !droppedIds.has(n.id));
  const placedEdges = newEdges.filter(
    (e) => !droppedIds.has(e.source) && !droppedIds.has(e.target),
  );
  if (placedNodes.length === 0) return;
  store().addNodes(placedNodes);

  // Merge new topic edges with existing edges
  const currentEdges = store().edges;
  store().setEdges([...currentEdges, ...placedEdges]);
  layoutSetLinks(toLinkInput([...currentEdges, ...placedEdges]));
  layoutReheat(0.3);
}

// ---------------------------------------------------------------------------
// document removal
// ---------------------------------------------------------------------------

async function runRemove(ids: string[]): Promise<void> {
  const store = useGraphStore.getState;
  const present = new Set(documentNodes().map((n) => n.id));
  const removing = [...new Set(ids)].filter((id) => present.has(id));
  if (removing.length === 0) return;
  const gone = new Set(removing);
  const oldCorpusHash = store().corpusHash;
  // Removed ids invalidate the cached incremental similarity index outright
  // (see runSemanticPass) — force its next pass to do a full rebuild.
  resetSemanticIndex();

  // Drop UI references to whatever is about to disappear.
  const ui = useUiStore.getState();
  if (ui.selectedId && gone.has(ui.selectedId)) ui.setSelected(null);
  if (ui.hoveredId && gone.has(ui.hoveredId)) ui.setHovered(null);
  if (ui.searchResults) {
    const kept = ui.searchResults.filter((id) => !gone.has(id));
    if (kept.length !== ui.searchResults.length) {
      // Keep the same owner so the highlighting panel stays in sync.
      ui.setSearchResults(kept.length > 0 ? kept : null, ui.highlightOwner ?? undefined);
    }
  }
  if (ui.pathEndpoints.some((id) => gone.has(id))) {
    // A picked endpoint is disappearing — the route is void. Exiting path
    // mode (which clears the endpoints) stops PathPanel from re-publishing
    // the dead ids into searchResults after the cleanup above.
    ui.setPathMode(false);
  }

  // In-memory removal: graph store, runtime stores, per-run bookkeeping.
  store().removeNodes(removing);
  for (const id of removing) {
    textStore.delete(id);
    chunkStore.delete(id);
    docVectorStore.delete(id);
    mdLinkTargetsStore.delete(id);
    docLinksStore.delete(id);
    // Nothing left to persist for a removed doc — a stale dirty entry would
    // make the next save look it up and find nothing.
    dirtyDocIds.delete(id);
    lexMeta.delete(id);
    fileIdOfDoc.delete(id);
    nameOfDoc.delete(id);
  }

  const remaining = documentNodes();
  if (remaining.length === 0) {
    // last doc removed — tear down like a fresh start and forget the session
    resetCorpus();
    await markActiveCorpusEmpty().catch(reportPersistenceUnavailable);
    const purge = await unreferencedDocumentIds(removing).catch((error: unknown) => {
      reportPersistenceUnavailable(error);
      return [];
    });
    await deleteDocsFromCache(purge);
    await deleteOriginals(purge);
    if (oldCorpusHash) await deleteGraphFromCache(oldCorpusHash);
    return;
  }

  // Rebuild the layout with survivors held at their current positions.
  // Slots are append-only, so removal = reset + re-add (the restore pattern);
  // capture positions BEFORE layoutReset clears the position buffer.
  const positions = new Map<string, [number, number, number]>();
  for (const n of remaining) {
    const p = getNodePosition(n.id);
    if (p) positions.set(n.id, p);
  }
  layoutReset();
  layoutAddNodes(
    remaining.map((n) => ({ id: n.id, cluster: n.cluster, initial: positions.get(n.id) })),
  );

  // Corpus-wide re-link over the survivors.
  const { lexEdges } = await runLexicalPass(getPool());
  await runSemanticPass(lexEdges);
  synthesizeTopicNodes();

  store().setPhase('ready');
  store().setCorpusHash(await computeCorpusHash());

  // Persist in a crash-safe order: write the new session first, THEN purge
  // the removed doc's text/vectors and the stale graph snapshot. If the tab
  // closes mid-way the cache is still a consistent, restorable state (worst
  // case: the removal simply didn't stick).
  // sessionSave is deliberately coordinator-free, so persistence stays
  // acyclic while this mutation pipeline remains a lazy application chunk.
  await saveSession();
  const purge = await unreferencedDocumentIds(removing).catch((error: unknown) => {
    reportPersistenceUnavailable(error);
    return [];
  });
  await deleteDocsFromCache(purge);
  await deleteOriginals(purge);
  const newCorpusHash = store().corpusHash;
  if (oldCorpusHash && oldCorpusHash !== newCorpusHash) {
    await deleteGraphFromCache(oldCorpusHash);
  }
}

/**
 * Docs in the store without lexical metadata (hydrated from cache or
 * restored by the persistence subsystem) get tf/totalTerms recomputed off
 * the main thread via 'analyze'. Their mdLinkTargets are already in
 * mdLinkTargetsStore (populated at hydration time), so they're untouched here.
 */
async function backfillLexMeta(pool: WorkerPool): Promise<void> {
  const missing = documentNodes().filter((n) => !lexMeta.has(n.id) && textStore.has(n.id));
  if (missing.length === 0) return;
  await Promise.allSettled(
    missing.map(async (n) => {
      const fileName = basename(n.path ?? n.title);
      const done = await pool.request<ParseDone>({
        requestId: 0,
        type: 'analyze',
        fileId: n.id,
        name: fileName,
        path: n.path,
        fileType: n.fileType,
        docId: n.id,
        title: n.title,
        text: textStore.get(n.id) ?? '',
        status: n.status,
        warning: n.warning,
      });
      lexMeta.set(n.id, {
        tf: done.doc.tf,
        totalTerms: done.doc.totalTerms,
        fileName,
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Settle the UI after a cancelled ingest run: whatever chips/progress the run
 * left behind are cleared, and docs committed before the abort landed stay in
 * the graph (the next drop re-runs the corpus-wide passes over them anyway).
 */
function settleCancelledIngest(): void {
  const store = useGraphStore.getState;
  store().setModelProgress(null); // an OCR/model banner must not outlive the run
  store().clearIngestTray();
  const { phase } = store();
  // A run cancelled before it changed phase — or after an earlier cancelled
  // run in the same batch already settled the strip — has nothing to announce.
  if (phase === 'idle' || phase === 'ready') return;
  store().setPhase(documentNodes().length > 0 ? 'ready' : 'idle');
  useUiStore.getState().pushToast('Ingest cancelled.', 'info');
}

/**
 * Serializes runs via the shared FIFO run-queue (runQueue.ts): a drop during
 * an active run — or an in-flight import/snapshot-restore (exportImport.ts,
 * session.ts route through the same `enqueueRun`) — queues after it, so
 * these mutations of shared graph/runtime-store/layout state can never
 * interleave.
 *
 * Cancellable via the ProgressStrip's Cancel button (ingestCancellation.ts).
 * The controller is registered at enqueue time, not run start, so cancelling
 * also flushes drops still queued behind the running run — enqueueRun skips
 * them before they start.
 */
export function ingestFiles(files: IngestFile[]): Promise<void> {
  const controller = new AbortController();
  registerIngestAbort(controller);
  const run = enqueueRun(() => runIngest(files, controller.signal), {
    signal: controller.signal,
  })
    .catch((err) => {
      // Cancellation is a user action, not a failure — settle the returned
      // promise cleanly so fire-and-forget drops and loadDemoCorpus don't
      // surface it as an error.
      if (controller.signal.aborted) {
        settleCancelledIngest();
        return;
      }
      throw err;
    })
    .finally(() => clearIngestAbort(controller));
  // Attached separately from the returned promise so a caller that doesn't
  // itself .catch() the result (e.g. a fire-and-forget drop) doesn't produce
  // an unhandled rejection warning; it doesn't change what `run` resolves to.
  run.catch((err) => console.error('ingest run failed', err));
  return run;
}

/**
 * Removes documents from the knowledge bank: graph, layout, runtime stores,
 * AND the IndexedDB cache (text + embeddings are deleted from this browser).
 * Queues behind any in-flight ingest/import/restore run.
 */
export function removeDocuments(ids: string[]): Promise<void> {
  // Resolve the display label NOW: the SidePanel closes optimistically, and
  // by the time a failure surfaces the node may be half-gone from the store.
  const g = useGraphStore.getState();
  const label =
    ids.length === 1
      ? `'${g.nodes[g.nodeIndex[ids[0]]]?.title ?? nameOfDoc.get(ids[0]) ?? ids[0]}'`
      : `${ids.length} documents`;
  const run = enqueueRun(() => runRemove(ids));
  run.catch((err) => {
    console.error('document removal failed', err);
    useUiStore
      .getState()
      .pushToast(
        `Couldn't remove ${label} — the graph may be out of sync. Reload to recover.`,
        'warning',
      );
  });
  return run;
}

/**
 * Apply one watched-folder diff as a single queued mutation. New revisions are
 * ingested before their superseded/removed node ids are dropped, so a changed
 * one-file corpus never flashes through an empty reset state.
 */
export interface WatchedReplacement {
  oldId: string;
  newId: string;
}

export function reconcileWatchedFiles(
  files: IngestFile[],
  removeIds: string[],
  replacements: WatchedReplacement[] = [],
  expectedIds: string[] = [],
): Promise<string[]> {
  const run = enqueueRun(async () => {
    if (files.length > 0) await runIngest(files);
    const present = new Set(documentNodes().map((node) => node.id));
    const acceptedIds = expectedIds.filter((id) => present.has(id));
    const supersededIds = replacements
      .filter(({ newId }) => present.has(newId))
      .map(({ oldId }) => oldId);
    const removing = [...new Set([...removeIds, ...supersededIds])];
    if (removing.length > 0) await runRemove(removing);
    return acceptedIds;
  });
  run.catch((error) => console.error('watched-folder reconciliation failed', error));
  return run;
}

/**
 * Rebuilds all local vectors after an embedding profile change. Source text is
 * already persisted locally, so this never needs to re-read the original files.
 */
async function runEmbeddingRebuild(): Promise<void> {
  wireModelProgress();
  const docs = documentNodes().filter((n) => n.status !== 'unreadable' && textStore.has(n.id));
  if (docs.length === 0) return;

  const pool = getPool();
  const graph = useGraphStore.getState;
  try {
    const { lexEdges, boilerplate } = await runLexicalPass(pool);
    graph().setPhase('embedding');

    // Build replacement vectors off to the side. A single failed request
    // must not destroy the last usable index for documents already rebuilt.
    const rebuilt = new Map<
      string,
      { chunks: string[]; docVector: Float32Array | null; chunkVectors: Float32Array | null }
    >();
    const patches = new Map<string, Partial<DocNode>>();
    // Chunk every doc first (recording truncation + empty results), then embed
    // the non-empty ones in batched worker requests — the same cross-document
    // packing the ingest path uses, so a rebuild over a large corpus makes
    // ~tens of round trips instead of one per document.
    const toEmbed: { id: string; chunks: string[] }[] = [];
    for (const doc of docs) {
      const { chunks, truncated } = chunkText(
        stripBoilerplate(textStore.get(doc.id) ?? '', boilerplate),
      );
      if (chunks.length === 0) {
        rebuilt.set(doc.id, { chunks: [], docVector: null, chunkVectors: null });
        continue;
      }
      if (truncated && !doc.warning) {
        patches.set(doc.id, {
          status: 'partial',
          warning: 'Only the first ~200 KB indexed for search',
        });
      }
      toEmbed.push({ id: doc.id, chunks });
    }
    for (let start = 0; start < toEmbed.length; start += EMBED_DOCS_PER_REQUEST) {
      const batch = toEmbed.slice(start, start + EMBED_DOCS_PER_REQUEST);
      const done = await pool.request<EmbedBatchDone>({
        requestId: 0,
        type: 'embedBatch',
        docs: batch.map((d) => ({ docId: d.id, chunks: d.chunks })),
      });
      const chunksById = new Map(batch.map((d) => [d.id, d.chunks]));
      for (const result of done.docs) {
        rebuilt.set(result.docId, {
          chunks: chunksById.get(result.docId) ?? [],
          docVector: result.docVector,
          chunkVectors: result.chunkVectors,
        });
      }
    }

    for (const [docId, result] of rebuilt) {
      docVectorStore.delete(docId);
      if (result.docVector) docVectorStore.set(docId, result.docVector);
      if (result.chunks.length === 0) chunkStore.delete(docId);
      else {
        chunkStore.set(docId, {
          texts: result.chunks,
          vectors: result.chunkVectors,
          dims: EMBED_DIMS,
        });
      }
    }
    markDocsDirty(rebuilt.keys()); // every vector here differs from the cache
    graph().patchNodes(patches);
    // Every vector above was replaced, but the doc ids did not change — so
    // runSemanticPass's staleness check (which only detects departures) would
    // take the incremental path and serve edges computed in the OLD vector
    // space. Drop the cache so the next pass rebuilds against the new one.
    resetSemanticIndex();
    await runSemanticPass(lexEdges);
    synthesizeTopicNodes();
    graph().setCorpusHash(await computeCorpusHash());
    graph().setPhase('ready');
    await saveSession();
  } finally {
    graph().setModelProgress(null);
    // A failed worker/model request must not leave the application locked in
    // an in-progress phase. The previous index remains intact until commit.
    if (graph().phase !== 'ready') graph().setPhase('ready');
  }
}

export function rebuildEmbeddings(): Promise<void> {
  return enqueueRun(runEmbeddingRebuild).catch((err: unknown) => {
      console.error('embedding rebuild failed', err);
      useUiStore.getState().pushToast('Embedding rebuild failed — re-add affected documents to retry.', 'warning');
    throw err;
  });
}

/** Fetches /demo/manifest.json + files (bundled by the UI) and ingests them. */
export async function loadDemoCorpus(): Promise<void> {
  const res = await fetchDemoManifest();
  if (!res.ok) throw new Error(`demo manifest failed: HTTP ${res.status}`);
  const manifest = (await res.json()) as { files: string[]; generated?: { count?: unknown } };
  const fetched = await Promise.all(
    manifest.files.map(async (name): Promise<IngestFile | null> => {
      const fileRes = await fetch(`/demo/${encodeURIComponent(name)}`);
      if (!fileRes.ok) return null;
      // arrayBuffer, NOT text(): the demo corpus includes binary formats
      // (pdf/docx/pptx) that a text decode round-trip would corrupt.
      const bytes = await fileRes.arrayBuffer();
      return {
        fileId: crypto.randomUUID(),
        name,
        path: `demo/${name}`,
        fileType: routeFile(name) ?? 'other',
        bytes,
      };
    }),
  );
  const generatedCount = manifest.generated?.count;
  const generated =
    typeof generatedCount === 'number' && Number.isInteger(generatedCount) && generatedCount > 0
      ? createGeneratedDemoDocuments(generatedCount)
      : [];
  const files = [...fetched.filter((f): f is IngestFile => f !== null), ...generated];
  if (files.length > 0) await ingestFiles(files);
}

/** Embeds a search query to a unit vector (used by the search subsystem). */
export async function embedQuery(text: string): Promise<Float32Array> {
  wireModelProgress();
  const done = await getPool().request<EmbedQueryDone>({
    requestId: 0,
    type: 'embedQuery',
    text: embeddingQueryText(text),
  });
  return done.vector;
}

/** Full teardown: layout, graph store, runtime stores, UI selections, chat. */
export function resetCorpus(): void {
  layoutReset();
  useGraphStore.getState().reset();
  clearRuntimeStores();
  lexMeta.clear();
  fileIdOfDoc.clear();
  nameOfDoc.clear();
  resetSemanticIndex();
  const ui = useUiStore.getState();
  ui.setSelected(null);
  ui.setHovered(null);
  ui.setSearchResults(null);
  ui.setPathMode(false); // also clears pathEndpoints — they reference the old corpus
  // Chat answers cite the outgoing corpus — stale context for the next one.
  // Cancel any in-flight stream FIRST: it would otherwise keep running
  // against the wiped stores with isStreaming stuck true for up to 120s.
  cancelChat();
  useChatStore.getState().clearMessages();
}
