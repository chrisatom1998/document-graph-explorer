/**
 * Coordinator ingest/remove integration — mocked workers, layout, and
 * persistence. Exercises the real runIngest / runRemove spine without
 * spinning Workers or loading the ONNX embedder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMBED_DIMS } from '../config';
import type {
  AggRequest,
  AggResponse,
  IngestFile,
  ParsedDoc,
  PoolRequest,
  PoolResponse,
} from '../model/types';
import { documentContentId } from './documentId';
import { cancelIngest } from './ingestCancellation';
import { enqueueRun } from './runQueue';
import { chunkStore, clearRuntimeStores, docVectorStore, textStore } from '../store/runtimeStores';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import {
  ingestFiles,
  reconcileWatchedFiles,
  removeDocuments,
  resetCorpus,
} from './coordinator';

const layout = vi.hoisted(() => ({
  layoutAddNodes: vi.fn(() => [] as string[]),
  layoutReheat: vi.fn(),
  layoutReset: vi.fn(),
  layoutSetClusters: vi.fn(),
  layoutSetLinks: vi.fn(),
  layoutRemoveNodes: vi.fn(),
}));

const persistence = vi.hoisted(() => ({
  lookupDocCache: vi.fn().mockResolvedValue(undefined),
  saveDocsToCache: vi.fn().mockResolvedValue(undefined),
  deleteDocsFromCache: vi.fn().mockResolvedValue(undefined),
  deleteGraphFromCache: vi.fn().mockResolvedValue(undefined),
  reportPersistenceUnavailable: vi.fn(),
  saveSession: vi.fn().mockResolvedValue(undefined),
  deleteOriginals: vi.fn().mockResolvedValue(undefined),
  putOriginalIfMissing: vi.fn().mockResolvedValue(undefined),
  markActiveCorpusEmpty: vi.fn().mockResolvedValue(undefined),
  unreferencedDocumentIds: vi.fn(async (ids: string[]) => ids),
  estimateStorage: vi.fn().mockResolvedValue(null),
  formatStorageSummary: vi.fn(),
  storagePressure: vi.fn(),
}));

type PoolHandler = (
  msg: PoolRequest,
  options?: { signal?: AbortSignal },
) => Promise<PoolResponse>;

const poolState = vi.hoisted(() => {
  const state = {
    failParseNames: new Set<string>(),
    failEmbed: false,
    hangParse: false,
    requestImpl: undefined as PoolHandler | undefined,
  };
  return state;
});

vi.mock('../layout/layoutBridge', () => layout);
vi.mock('../persistence/cache', () => ({
  lookupDocCache: persistence.lookupDocCache,
  saveDocsToCache: persistence.saveDocsToCache,
  deleteDocsFromCache: persistence.deleteDocsFromCache,
  deleteGraphFromCache: persistence.deleteGraphFromCache,
  reportPersistenceUnavailable: persistence.reportPersistenceUnavailable,
}));
vi.mock('../persistence/sessionSave', () => ({ saveSession: persistence.saveSession }));
vi.mock('../persistence/originals', () => ({
  deleteOriginals: persistence.deleteOriginals,
  putOriginalIfMissing: persistence.putOriginalIfMissing,
}));
vi.mock('../persistence/corpusRepository', () => ({
  markActiveCorpusEmpty: persistence.markActiveCorpusEmpty,
  unreferencedDocumentIds: persistence.unreferencedDocumentIds,
}));
vi.mock('../persistence/quota', () => ({
  estimateStorage: persistence.estimateStorage,
  formatStorageSummary: persistence.formatStorageSummary,
  storagePressure: persistence.storagePressure,
}));
vi.mock('./parsers/pdf', () => ({ parsePdf: vi.fn() }));
vi.mock('../workers/pool', () => ({
  getPool: () => ({
    request: (msg: PoolRequest, _transfer?: Transferable[], options?: { signal?: AbortSignal }) =>
      poolState.requestImpl
        ? poolState.requestImpl(msg, options)
        : defaultPoolRequest(msg, options),
    onModelProgress: () => () => undefined,
    onWorkerCrash: () => () => undefined,
  }),
}));

class FakeAggWorker {
  onmessage: ((ev: MessageEvent<AggResponse>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  terminated = false;

  postMessage(message: unknown): void {
    const req = message as AggRequest;
    queueMicrotask(() => {
      if (this.terminated || !this.onmessage) return;
      this.onmessage({ data: fakeAggResponse(req) } as MessageEvent<AggResponse>);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error
    ? reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

function makeParsedDoc(name: string, text: string): ParsedDoc {
  const title = name.replace(/\.[^.]+$/, '');
  return {
    contentHash: 'h',
    title,
    text,
    wordCount: text.split(/\s+/).length,
    headings: [],
    mdLinkTargets: [],
    docLinks: [],
    entities: ['Kafka'],
    tf: { kafka: 3, consumer: 2, retry: 1 },
    phraseTf: {},
    totalTerms: 6,
    chunks: [text],
    summary: text.slice(0, 80),
    status: 'ok',
  };
}

function unitVector(seed: number): Float32Array {
  const v = new Float32Array(EMBED_DIMS);
  v[0] = 1;
  v[1] = seed * 0.02;
  let norm = 0;
  for (let i = 0; i < v.length; i += 1) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < v.length; i += 1) v[i] /= norm;
  return v;
}

async function defaultPoolRequest(
  msg: PoolRequest,
  options?: { signal?: AbortSignal },
): Promise<PoolResponse> {
  const signal = options?.signal;
  if (signal?.aborted) throw abortReason(signal);

  if (msg.type === 'parse' || msg.type === 'analyze') {
    if (poolState.hangParse) {
      await new Promise<never>((_resolve, reject) => {
        const onAbort = (): void => reject(abortReason(signal!));
        if (!signal) return;
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }
    const name = msg.name;
    if (poolState.failParseNames.has(name)) {
      throw new Error(`parse failed: ${name}`);
    }
    const text =
      msg.type === 'analyze'
        ? msg.text
        : `Kafka consumer retry policy for ${name}. Circuit breaker and rate limiting.`;
    return {
      requestId: msg.requestId,
      type: 'parse:done',
      fileId: msg.type === 'parse' || msg.type === 'analyze' ? msg.fileId : name,
      doc: makeParsedDoc(name, text),
    };
  }

  if (msg.type === 'embedBatch') {
    if (poolState.failEmbed) throw new Error('embed batch failed');
    return {
      requestId: msg.requestId,
      type: 'embedBatch:done',
      docs: msg.docs.map((d, i) => ({
        docId: d.docId,
        docVector: unitVector(i + 1),
        chunkVectors: unitVector(i + 1),
        nChunks: 1,
      })),
    };
  }

  if (msg.type === 'embedQuery') {
    return { requestId: msg.requestId, type: 'embedQuery:done', vector: unitVector(0) };
  }

  throw new Error(`unexpected pool request ${msg.type}`);
}

function fakeAggResponse(req: AggRequest): AggResponse {
  if (req.type === 'lexical') {
    const keywordsByDoc: Record<string, string[]> = {};
    for (const doc of req.docs) {
      keywordsByDoc[doc.id] = Object.keys(doc.tf).slice(0, 5);
    }
    const edges =
      req.docs.length >= 2
        ? [
            {
              id: `${req.docs[0].id}->${req.docs[1].id}:keyword`,
              source: req.docs[0].id,
              target: req.docs[1].id,
              kind: 'keyword' as const,
              weight: 0.7,
              evidence: ['kafka'],
            },
          ]
        : [];
    return {
      requestId: req.requestId,
      type: 'lexical:done',
      keywordsByDoc,
      edges,
      boilerplateLines: [],
    };
  }
  if (req.type === 'semantic') {
    const clusters: Record<string, number> = {};
    for (const id of req.ids) clusters[id] = 0;
    const nearest = req.ids.map((_, i) =>
      req.ids.length > 1 ? { j: (i + 1) % req.ids.length, sim: 0.8 } : null,
    );
    const top = req.ids.map((_, i) =>
      req.ids.length > 1 ? [{ j: (i + 1) % req.ids.length, sim: 0.8 }] : [],
    );
    const edges =
      req.ids.length >= 2
        ? [
            {
              id: `${req.ids[0]}->${req.ids[1]}:semantic`,
              source: req.ids[0],
              target: req.ids[1],
              kind: 'semantic' as const,
              weight: 0.8,
              evidence: ['cosine'],
            },
          ]
        : [];
    return {
      requestId: req.requestId,
      type: 'semantic:done',
      edges,
      clusters,
      duplicates: [],
      nearest,
      top,
    };
  }
  const clusters: Record<string, number> = {};
  for (const id of req.ids) clusters[id] = 0;
  return { requestId: req.requestId, type: 'cluster:done', clusters };
}

function textFile(name: string, body: string): IngestFile {
  return {
    fileId: `file-${name}`,
    name,
    path: name,
    fileType: 'txt',
    bytes: new TextEncoder().encode(body).buffer,
  };
}

function documentIds(): string[] {
  return useGraphStore
    .getState()
    .nodes.filter((n) => n.kind === 'document')
    .map((n) => n.id);
}

function fileStatus(fileId: string) {
  return useGraphStore.getState().fileStatuses[fileId];
}

vi.stubGlobal('Worker', FakeAggWorker);

beforeEach(() => {
  poolState.failParseNames.clear();
  poolState.failEmbed = false;
  poolState.hangParse = false;
  poolState.requestImpl = undefined;
  layout.layoutAddNodes.mockClear().mockReturnValue([]);
  layout.layoutReheat.mockClear();
  layout.layoutReset.mockClear();
  layout.layoutSetClusters.mockClear();
  layout.layoutSetLinks.mockClear();
  layout.layoutRemoveNodes.mockClear();
  for (const value of Object.values(persistence)) {
    if (typeof value === 'function' && 'mockClear' in value) value.mockClear();
  }
  persistence.lookupDocCache.mockResolvedValue(undefined);
  persistence.unreferencedDocumentIds.mockImplementation(async (ids: string[]) => ids);
  persistence.estimateStorage.mockResolvedValue(null);
  useUiStore.setState({ toasts: [], selectedId: null, pendingFocus: null, lastError: null });
  resetCorpus();
});

afterEach(async () => {
  cancelIngest();
  await enqueueRun(async () => undefined);
  resetCorpus();
  clearRuntimeStores();
});

describe('coordinator ingest', () => {
  it('ingests tiny text fixtures through to ready with layout updates', async () => {
    await ingestFiles([
      textFile('alpha.txt', 'Kafka consumer retry policy and circuit breaker.'),
      textFile('beta.txt', 'Kafka consumer lag runbook and rate limiting.'),
      textFile('gamma.txt', 'Deploy guide mentions the kafka consumer runbook.'),
    ]);

    expect(useGraphStore.getState().phase).toBe('ready');
    expect(documentIds()).toHaveLength(3);
    expect(layout.layoutAddNodes).toHaveBeenCalled();
    expect(layout.layoutSetLinks).toHaveBeenCalled();
    expect(layout.layoutSetClusters).toHaveBeenCalled();
    expect(persistence.saveSession).toHaveBeenCalled();
    const kinds = new Set(useGraphStore.getState().edges.map((e) => e.kind));
    expect(kinds.has('keyword') || kinds.has('semantic')).toBe(true);
    for (const id of documentIds()) {
      expect(textStore.has(id)).toBe(true);
      expect(docVectorStore.has(id)).toBe(true);
    }
  });

  it('isolates a per-file parse failure and still settles the rest', async () => {
    poolState.failParseNames.add('bad.txt');
    await ingestFiles([
      textFile('good.txt', 'Healthy kafka consumer documentation.'),
      textFile('bad.txt', 'This parse will be rejected by the fake pool.'),
    ]);

    expect(useGraphStore.getState().phase).toBe('ready');
    expect(documentIds()).toHaveLength(1);
    expect(useGraphStore.getState().nodes[0]?.title).toBe('good');
    expect(fileStatus('file-bad.txt')?.stage).toBe('error');
    expect(fileStatus('file-bad.txt')?.error).toMatch(/parse failed/);
    expect(fileStatus('file-good.txt')?.stage).not.toBe('error');
  });

  it('chips an embed-batch failure and still leaves the corpus ready', async () => {
    poolState.failEmbed = true;
    await ingestFiles([
      textFile('one.txt', 'First kafka consumer note.'),
      textFile('two.txt', 'Second kafka consumer note.'),
    ]);

    expect(useGraphStore.getState().phase).toBe('ready');
    expect(documentIds()).toHaveLength(2);
    expect(fileStatus('file-one.txt')?.stage).toBe('error');
    expect(fileStatus('file-two.txt')?.stage).toBe('error');
    expect(fileStatus('file-one.txt')?.error).toMatch(/embed batch failed/);
    expect(docVectorStore.size).toBe(0);
  });

  it('settles a mid-parse cancel without rejecting', async () => {
    poolState.hangParse = true;
    const run = ingestFiles([textFile('slow.txt', 'Will hang in parse until cancelled.')]);
    await vi.waitFor(() => {
      expect(useGraphStore.getState().phase).toBe('parsing');
    });
    cancelIngest();
    await expect(run).resolves.toBeUndefined();
    expect(['idle', 'ready']).toContain(useGraphStore.getState().phase);
    expect(useUiStore.getState().toasts.some((t) => /cancelled/i.test(t.message))).toBe(true);
  });
});

describe('coordinator remove and watch reconcile', () => {
  it('removeDocuments clears graph, runtime stores, layout, and cache', async () => {
    await ingestFiles([
      textFile('keep.txt', 'Document that should survive removal.'),
      textFile('drop.txt', 'Document that will be removed.'),
    ]);
    const drop = useGraphStore.getState().nodes.find((n) => n.title === 'drop');
    const keep = useGraphStore.getState().nodes.find((n) => n.title === 'keep');
    expect(drop && keep).toBeTruthy();
    if (!drop || !keep) throw new Error('expected both nodes');

    await removeDocuments([drop.id]);

    expect(documentIds()).toEqual([keep.id]);
    expect(textStore.has(drop.id)).toBe(false);
    expect(chunkStore.has(drop.id)).toBe(false);
    expect(docVectorStore.has(drop.id)).toBe(false);
    expect(textStore.has(keep.id)).toBe(true);
    expect(layout.layoutReset).toHaveBeenCalled();
    expect(persistence.deleteDocsFromCache).toHaveBeenCalledWith([drop.id]);
    expect(persistence.deleteOriginals).toHaveBeenCalledWith([drop.id]);
    expect(useGraphStore.getState().phase).toBe('ready');
  });

  it('reconcileWatchedFiles ingests the new revision before dropping the old id', async () => {
    const oldFile = textFile('notes.md', 'Original kafka consumer notes.');
    await ingestFiles([oldFile]);
    const oldId = documentIds()[0];
    expect(oldId).toBeTruthy();

    const newFile = textFile('notes.md', 'Revised kafka consumer notes with retry policy.');
    const newId = await documentContentId(newFile.path ?? newFile.name, newFile.bytes);

    layout.layoutAddNodes.mockClear();
    layout.layoutReset.mockClear();

    const counts: number[] = [];
    const unsub = useGraphStore.subscribe((state) => {
      counts.push(state.nodes.filter((n) => n.kind === 'document').length);
    });

    const accepted = await reconcileWatchedFiles([newFile], [], [{ oldId, newId }], [newId]);
    unsub();

    expect(accepted).toEqual([newId]);
    expect(documentIds()).toEqual([newId]);
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.every((n) => n >= 1)).toBe(true);
    expect(layout.layoutAddNodes).toHaveBeenCalled();
    expect(layout.layoutReset).toHaveBeenCalled();
    expect(layout.layoutAddNodes.mock.invocationCallOrder[0]).toBeLessThan(
      layout.layoutReset.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });
});
