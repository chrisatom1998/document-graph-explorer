import { handleMusic } from '../workers/aggregatorHandlers';
import { cancelMusicJob, cancelAllMusicJobs, useMusicJobs } from '../store/musicJobs';
import { INSTRUMENT_ANALYSIS_REVISION, KEY_ANALYSIS_REVISION, TEMPO_ANALYSIS_REVISION, sanitizeMusicAnalysis } from '../audio/musicTypes';
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
import { cancelIngest, hasCancellableIngest } from './ingestCancellation';
import { enqueueRun } from './runQueue';
import { chunkStore, clearRuntimeStores, docVectorStore, textStore } from '../store/runtimeStores';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import { useUiStore } from '../store/uiStore';
import * as textHydration from '../store/textHydration';
import { useCorpusStore } from '../store/corpusStore';
import {
  ingestFiles,
  setAudioInstruments,
  setAudioDjTags,
  reconcileWatchedFiles,
  removeDocuments,
  resetCorpus,
  analyzeAudioCorpus,
  outdatedAudioIds,
  setAudioReview,
} from './coordinator';
import { rememberWorldOrigin } from '../scene/ingestBirth';
import { createRecognition, recognitionConfiguration } from '../audio/recognition';
import { supportsFusionInput, fusionConfiguration } from '../audio/fusionRelease';
import { resolvedNonSourceLabels, latestSoundReview } from '../audio/soundReviewPolicy';

const music = vi.hoisted(() => ({ analyzeMusic: vi.fn(), preloadMusicModels: vi.fn(async () => {}) }));
vi.mock('../audio/analyzeMusic', () => music);

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
  isPersistenceHealthy: vi.fn(() => true),
  saveDocsToCache: vi.fn().mockResolvedValue(undefined),
  deleteDocsFromCache: vi.fn().mockResolvedValue(undefined),
  deleteGraphFromCache: vi.fn().mockResolvedValue(undefined),
  reportPersistenceUnavailable: vi.fn(),
  saveSession: vi.fn().mockResolvedValue(undefined),
  saveActiveCorpusPositions: vi.fn().mockResolvedValue(undefined),
  deleteOriginals: vi.fn().mockResolvedValue(undefined),
  getOriginal: vi.fn().mockResolvedValue(undefined),
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
  isPersistenceHealthy: persistence.isPersistenceHealthy,
}));
vi.mock('../persistence/sessionSave', () => ({ saveSession: persistence.saveSession, collectPositions: () => ({}) }));
vi.mock('../persistence/originals', () => ({
  deleteOriginals: persistence.deleteOriginals,
  getOriginal: persistence.getOriginal,
  putOriginalIfMissing: persistence.putOriginalIfMissing,
}));
vi.mock('../persistence/corpusRepository', () => ({
  saveActiveCorpusPositions: persistence.saveActiveCorpusPositions,
  markActiveCorpusEmpty: persistence.markActiveCorpusEmpty,
  unreferencedDocumentIds: persistence.unreferencedDocumentIds,
}));
vi.mock('../persistence/quota', () => ({
  estimateStorage: persistence.estimateStorage,
  formatStorageSummary: persistence.formatStorageSummary,
  storagePressure: persistence.storagePressure,
}));
const library = vi.hoisted(() => ({
  hasDocumentRecord: vi.fn(async () => true),
  rememberLibraryFiles: vi.fn(async () => {}),
}));
vi.mock('../persistence/library', () => library);
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

const aggState = {
  requests: [] as AggRequest[],
  hangType: null as AggRequest['type'] | null,
  failType: null as AggRequest['type'] | null,
};

class FakeAggWorker {
  onmessage: ((ev: MessageEvent<AggResponse>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  terminated = false;

  postMessage(message: unknown): void {
    const req = message as AggRequest;
    aggState.requests.push(req);
    if (req.type === aggState.hangType) return;
    queueMicrotask(() => {
      if (this.terminated || !this.onmessage) return;
      const data: AggResponse = req.type === aggState.failType
        ? { requestId: req.requestId, type: 'error', message: `${req.type} failed` }
        : fakeAggResponse(req);
      this.onmessage({ data } as MessageEvent<AggResponse>);
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
  if (req.type === 'music') return handleMusic(req);
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
  cancelAllMusicJobs();
  vi.restoreAllMocks();
  useCorpusStore.getState().reset();
  persistence.saveActiveCorpusPositions.mockReset().mockResolvedValue(undefined);
  aggState.requests = [];
  aggState.hangType = null;
  aggState.failType = null;
  useSettingsStore.getState().setMusicAnalysisMode('full');
  music.analyzeMusic.mockReset().mockResolvedValue({
    version: 2, tempoRevision: TEMPO_ANALYSIS_REVISION, keyRevision: KEY_ANALYSIS_REVISION, analyzedSeconds: 10, durationSeconds: 10,
    classifierConfiguration: fusionConfiguration(),
    tempo: { bpm: 140, confidence: 0.9 },
    key: { tonic: 2, mode: 'minor', strength: 0.9 },
    instruments: [{ label: 'synthesizer', status: 'likely', score: 0.9 }],
    instrumentScan: { revision: INSTRUMENT_ANALYSIS_REVISION, complete: true, analyzedSeconds: 10, windows: 1 }, notes: [],
  });
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
  library.hasDocumentRecord.mockReset().mockResolvedValue(true);
  library.rememberLibraryFiles.mockClear();
  persistence.unreferencedDocumentIds.mockImplementation(async (ids: string[]) => ids);
  persistence.estimateStorage.mockResolvedValue(null);
  useUiStore.setState({
    toasts: [],
    selectedId: null,
    pendingFocus: null,
    lastError: null,
    cameraCommand: null,
  });
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

  it('spawns live nodes at the recorded ingest origin, not a random shell', async () => {
    rememberWorldOrigin([12, -4, 3]);
    await ingestFiles([textFile('origin.txt', 'Kafka consumer retry notes for origin spawn.')]);

    expect(layout.layoutAddNodes).toHaveBeenCalled();
    const firstCall = layout.layoutAddNodes.mock.calls[0] as unknown as [
      { spawn?: number[] }[],
    ];
    const firstBatch = firstCall[0];
    expect(firstBatch.length).toBeGreaterThan(0);
    expect(firstBatch[0]?.spawn).toEqual([12, -4, 3]);
  });

  it('does not steal the camera when adding files to an existing corpus', async () => {
    await ingestFiles([textFile('first.txt', 'Initial kafka consumer documentation.')]);
    const afterFirst = useUiStore.getState().cameraCommand;
    expect(afterFirst?.kind).toBe('fitAll');
    const nonce = afterFirst?.nonce;

    await ingestFiles([textFile('second.txt', 'Added kafka consumer lag runbook.')]);
    expect(documentIds()).toHaveLength(2);
    expect(useUiStore.getState().cameraCommand?.nonce).toBe(nonce);
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

  it('retries failed embeddings when identical files are re-added without parsing again', async () => {
    const file = textFile('retry.txt', 'Kafka embedding retry fixture.');
    poolState.failEmbed = true;
    await ingestFiles([file]);
    const [id] = documentIds();
    expect(docVectorStore.has(id)).toBe(false);

    poolState.failEmbed = false;
    const request = vi.fn(defaultPoolRequest);
    poolState.requestImpl = request;
    await ingestFiles([{ ...file, fileId: 'retry-file-picker-id' }]);

    expect(documentIds()).toEqual([id]);
    expect(docVectorStore.has(id)).toBe(true);
    expect(request.mock.calls.some(([msg]) => msg.type === 'embedBatch')).toBe(true);
    expect(request.mock.calls.some(([msg]) => msg.type === 'parse')).toBe(false);
    expect(fileStatus('retry-file-picker-id')?.stage).toBe('placed');
    expect(useGraphStore.getState().ingestReport).toBeNull();
  });

  it('keeps same-basename sources distinct in failed embedding reports and retries', async () => {
    const good = {
      ...textFile('same.txt', 'Kafka good source.'),
      fileId: 'good-source', path: 'vault/good/same.txt',
    };
    const retry = {
      ...textFile('same.txt', 'Kafka retry source.'),
      fileId: 'failed-source', path: 'vault/retry/same.txt',
    };
    await ingestFiles([good]);
    poolState.failEmbed = true;
    await ingestFiles([retry]);

    expect(fileStatus('good-source')?.path).toBe(good.path);
    expect(fileStatus('failed-source')?.path).toBe(retry.path);
    expect(useGraphStore.getState().ingestReport?.entries).toEqual([
      expect.objectContaining({ name: retry.path, kind: 'failed' }),
    ]);

    poolState.failEmbed = false;
    await ingestFiles([{ ...retry, fileId: 'retry-source' }]);
    expect(fileStatus('retry-source')?.path).toBe(retry.path);
    expect(fileStatus('retry-source')?.stage).toBe('placed');
    expect(useGraphStore.getState().ingestReport).toBeNull();
  });

  it('resumes embeddings after a cancelled run when the same parsed file is re-added', async () => {
    const file = textFile('cancel-retry.txt', 'Kafka cancelled embedding fixture.');
    let embedStarted = false;
    poolState.requestImpl = async (msg, options) => {
      if (msg.type !== 'embedBatch') return defaultPoolRequest(msg, options);
      embedStarted = true;
      return new Promise<PoolResponse>((_resolve, reject) => {
        const signal = options!.signal!;
        signal.addEventListener('abort', () => reject(abortReason(signal)), { once: true });
      });
    };
    const run = ingestFiles([file]);
    await vi.waitFor(() => expect(embedStarted).toBe(true));
    cancelIngest();
    await run;
    const [id] = documentIds();
    expect(id).toBeDefined();
    expect(docVectorStore.has(id)).toBe(false);

    poolState.requestImpl = undefined;
    await ingestFiles([file]);
    expect(documentIds()).toEqual([id]);
    expect(docVectorStore.has(id)).toBe(true);
    expect(useGraphStore.getState().phase).toBe('ready');
  });

  it('keeps fully indexed duplicate drops as no-ops', async () => {
    const file = textFile('complete.txt', 'Fully indexed kafka documentation.');
    await ingestFiles([file]);
    const request = vi.fn(defaultPoolRequest);
    poolState.requestImpl = request;
    persistence.saveSession.mockClear();

    await ingestFiles([file]);

    expect(request).not.toHaveBeenCalled();
    expect(persistence.saveSession).not.toHaveBeenCalled();
    expect(documentIds()).toHaveLength(1);
  });

  it.each(['semantic', 'cluster'] as const)(
    'retries cancelled %s work without repeating completed embeddings',
    async (passType) => {
      if (passType === 'cluster') {
        await ingestFiles([textFile('existing.txt', 'Kafka existing document.')]);
      }
      const files = [
        textFile('late-cancel-one.txt', 'Kafka late cancellation one.'),
        textFile('late-cancel-two.txt', 'Kafka late cancellation two.'),
      ];
      aggState.hangType = passType;
      const run = ingestFiles(files);
      await vi.waitFor(() => expect(aggState.requests.some((req) => req.type === passType)).toBe(true));
      cancelIngest();
      await run;
      expect(docVectorStore.size).toBe(documentIds().length);

      aggState.hangType = null;
      aggState.requests = [];
      const request = vi.fn(defaultPoolRequest);
      poolState.requestImpl = request;
      await ingestFiles(files);

      expect(request).not.toHaveBeenCalled();
      expect(aggState.requests.map((req) => req.type)).toEqual(['lexical', 'semantic']);
      expect(useGraphStore.getState().edges.some((edge) => edge.kind === 'semantic')).toBe(true);
      expect(useGraphStore.getState().nodes.filter((node) => node.kind === 'document')
        .every((node) => node.cluster >= 0)).toBe(true);
      expect(useGraphStore.getState().phase).toBe('ready');
    },
  );

  it.each(['lexical', 'semantic', 'cluster'] as const)(
    'retries failed %s work and stops retrying once derived passes complete',
    async (passType) => {
      if (passType === 'cluster') {
        await ingestFiles([textFile('existing.txt', 'Kafka existing document.')]);
      }
      const files = [
        textFile('derived-retry-one.txt', 'Kafka failed derived pass one.'),
        textFile('derived-retry-two.txt', 'Kafka failed derived pass two.'),
      ];
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      aggState.failType = passType;
      await ingestFiles(files);
      expect(aggState.requests.some((req) => req.type === passType)).toBe(true);
      expect(docVectorStore.size).toBe(documentIds().length);

      aggState.failType = null;
      aggState.requests = [];
      const request = vi.fn(defaultPoolRequest);
      poolState.requestImpl = request;
      await ingestFiles(files);

      expect(request).not.toHaveBeenCalled();
      expect(aggState.requests[0]?.type).toBe('lexical');
      expect(aggState.requests).toHaveLength(2);
      expect(useGraphStore.getState().edges.some((edge) => edge.kind === 'semantic')).toBe(true);
      expect(useGraphStore.getState().nodes.filter((node) => node.kind === 'document')
        .every((node) => node.cluster >= 0)).toBe(true);

      aggState.requests = [];
      await ingestFiles(files);
      expect(aggState.requests).toHaveLength(0);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('cancels the lexical backfill of restored documents and releases the run queue', async () => {
    await ingestFiles([
      textFile('restored-one.txt', 'Kafka restored document one.'),
      textFile('restored-two.txt', 'Kafka restored document two.'),
    ]);
    const restoredNodes = [...useGraphStore.getState().nodes];
    const restoredTexts = new Map(textStore);
    resetCorpus();
    useGraphStore.getState().addNodes(restoredNodes);
    for (const [id, text] of restoredTexts) textStore.set(id, text);

    const signals: AbortSignal[] = [];
    poolState.requestImpl = async (msg, options) => {
      if (msg.type !== 'analyze') return defaultPoolRequest(msg, options);
      const signal = options?.signal;
      if (!signal) throw new Error('Backfill must receive the ingest abort signal');
      signals.push(signal);
      return new Promise<PoolResponse>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(abortReason(signal)), { once: true });
      });
    };
    const run = ingestFiles([textFile('added.txt', 'Kafka new document.')]);
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    cancelIngest();
    await run;

    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(hasCancellableIngest()).toBe(false);
    expect(useGraphStore.getState().phase).toBe('ready');
    await expect(enqueueRun(async () => 'queue available')).resolves.toBe('queue available');
  });

  it('settles a hydration failure before the next ingest can run', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hydrate = vi.spyOn(textHydration, 'getDocTexts');
    hydrate.mockRejectedValueOnce(new Error('IndexedDB read failed'));
    const failed = ingestFiles([textFile('hydrate-failure.txt', 'Kafka hydration failure.')]);
    await expect(failed).rejects.toThrow('IndexedDB read failed');

    expect(useGraphStore.getState().phase).toBe('ready');
    expect(useGraphStore.getState().modelProgress).toBeNull();
    expect(hasCancellableIngest()).toBe(false);
    expect(useUiStore.getState().toasts.some((toast) => /re-add.*retry/.test(toast.message))).toBe(true);

    await ingestFiles([textFile('next.txt', 'Kafka subsequent ingest.')]);
    expect(useGraphStore.getState().phase).toBe('ready');
    expect(documentIds()).toHaveLength(2);
  });
});

describe('coordinator remove and watch reconcile', () => {
  it('retries failed restored-document analysis on an identical re-add with vectors already complete', async () => {
    const retry = textFile('restored-retry.txt', 'Kafka restored retry fixture.');
    await ingestFiles([
      retry,
      textFile('restored-good.txt', 'Kafka restored good fixture.'),
      textFile('restored-remove.txt', 'Kafka restored removal fixture.'),
    ]);
    const restoredNodes = [...useGraphStore.getState().nodes];
    const restoredTexts = new Map(textStore);
    const restoredVectors = new Map(docVectorStore);
    const removeId = restoredNodes.find((node) => node.title === 'restored-remove')!.id;
    resetCorpus();
    useGraphStore.getState().addNodes(restoredNodes);
    for (const [id, text] of restoredTexts) textStore.set(id, text);
    for (const [id, vector] of restoredVectors) docVectorStore.set(id, vector);

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    poolState.failParseNames.add(retry.name);
    aggState.requests = [];
    await expect(removeDocuments([removeId])).rejects.toThrow(
      'Lexical analysis failed for restored-retry.txt',
    );
    expect(aggState.requests).toHaveLength(0);
    expect(docVectorStore.size).toBe(documentIds().length);
    expect(useGraphStore.getState().phase).toBe('ready');

    poolState.failParseNames.clear();
    const request = vi.fn(defaultPoolRequest);
    poolState.requestImpl = request;
    await ingestFiles([retry]);

    expect(request.mock.calls.map(([msg]) => msg.type)).toEqual(['analyze']);
    expect(request.mock.calls[0][0]).toMatchObject({ name: retry.name });
    expect(aggState.requests.map((req) => req.type)).toEqual(['lexical', 'semantic']);
    const lexical = aggState.requests[0];
    if (lexical.type !== 'lexical') throw new Error('Expected lexical aggregation');
    expect(lexical.docs.every((doc) => Object.keys(doc.tf).length > 0)).toBe(true);
    expect(useGraphStore.getState().edges.some((edge) => edge.kind === 'semantic')).toBe(true);

    request.mockClear();
    aggState.requests = [];
    await ingestFiles([retry]);
    expect(request).not.toHaveBeenCalled();
    expect(aggState.requests).toHaveLength(0);
  });

  it('settles a failed removal hydration and clears stale model progress', async () => {
    await ingestFiles([
      textFile('keep-after-failure.txt', 'Kafka survivor.'),
      textFile('remove-before-failure.txt', 'Kafka removal.'),
    ]);
    const [keepId, removeId] = documentIds();
    useGraphStore.getState().setModelProgress({
      kind: 'embedding-model', loaded: 1, total: 2, note: 'old progress',
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(textHydration, 'getDocTexts').mockRejectedValueOnce(new Error('IndexedDB read failed'));

    await expect(removeDocuments([removeId])).rejects.toThrow('IndexedDB read failed');

    expect(documentIds()).toEqual([keepId]);
    expect(useGraphStore.getState().phase).toBe('ready');
    expect(useGraphStore.getState().modelProgress).toBeNull();
    await expect(enqueueRun(async () => 'queue available')).resolves.toBe('queue available');
  });

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


describe('WAV music ingestion', () => {
  it('passes the OGG upload MIME through persistence and the real analysis entry point', async () => {
    useSettingsStore.getState().setMusicAnalysisMode('full');
    await ingestFiles([{ ...textFile('uploaded.OGG', 'OggS test bytes'), fileType: 'audio' as const }]);
    expect(music.analyzeMusic).toHaveBeenCalledTimes(1);
    const [blob, name, options] = music.analyzeMusic.mock.calls[0];
    expect(name).toBe('uploaded.OGG');
    expect(blob.type).toBe('audio/ogg');
    expect(supportsFusionInput(10, options.mode, blob.type)).toBe(true);
    // Any full-mode recording above the policy minimum is scored, whatever the container.
    expect(supportsFusionInput(9, options.mode, blob.type)).toBe(true);
    expect(supportsFusionInput(183, options.mode, 'audio/mpeg')).toBe(true);
    expect(supportsFusionInput(1, options.mode, blob.type)).toBe(false);
    expect(persistence.putOriginalIfMissing).toHaveBeenCalledWith(expect.any(String), name, blob);
  });

  it('repairs legacy saved OGG MIME during explicit reanalysis without changing bytes', async () => {
    await ingestFiles([{ ...textFile('legacy.ogg', 'OggS original bytes'), fileType: 'audio' as const }]);
    const node = useGraphStore.getState().nodes.find(n => n.fileType === 'audio')!;
    const saved = new Blob(['OggS original bytes'], { type: 'application/octet-stream' });
    persistence.getOriginal.mockResolvedValue({ blob: saved, name: 'legacy.ogg' });
    music.analyzeMusic.mockClear();
    await analyzeAudioCorpus([node.id]);
    const blob = music.analyzeMusic.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('audio/ogg');
    expect(await blob.text()).toBe(await saved.text());
    expect(saved.type).toBe('application/octet-stream');
  });
  const wav = (name: string) => ({ ...textFile(name, 'RIFF test audio bytes'), fileType: 'audio' as const });
  it('preserves cancelled partial evidence and confirmations when a later run restarts', async () => {
    await ingestFiles([wav('selected.wav')]);
    const selected=useGraphStore.getState().nodes.find(n=>n.fileType==='audio')!;
    const saved={...selected.audio!,confirmedInstruments:['piano']};
    useGraphStore.getState().patchNodes(new Map([[selected.id,{audio:saved}]]));
    persistence.getOriginal.mockResolvedValue({blob:new Blob(['RIFF']),name:'selected.wav'});
    const controller=new AbortController();
    const recognition=createRecognition(saved.durationSeconds,'full'); recognition.status='cancelled';
    music.analyzeMusic.mockImplementationOnce(async (_blob, _name, options) => {
      controller.abort(); options.onPartial?.({...saved,recognition});
      throw new DOMException('cancelled','AbortError');
    });
    await expect(analyzeAudioCorpus([selected.id],controller.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(useGraphStore.getState().nodes.find(n=>n.id===selected.id)?.audio).toMatchObject({confirmedInstruments:['piano'],recognition:{status:'cancelled'}});
    await analyzeAudioCorpus([selected.id]);
    expect(useGraphStore.getState().nodes.find(n=>n.id===selected.id)?.audio?.confirmedInstruments).toEqual(['piano']);
  });
  it('retains late cancellation evidence after Quick initial aborts before its deadline', async () => {
    await ingestFiles([wav('early-quick-cancel.wav')]);
    const node = useGraphStore.getState().nodes.find(n => n.fileType === 'audio')!;
    const saved = { ...node.audio!, confirmedInstruments: ['piano'] };
    useGraphStore.getState().patchNodes(new Map([[node.id, { audio: saved }]]));
    useSettingsStore.getState().setMusicAnalysisMode('fast');
    persistence.getOriginal.mockResolvedValue({ blob: new Blob(['RIFF']), name: 'early-quick-cancel.wav' });
    let partial!: (audio: typeof saved) => void;
    let rejectAnalysis!: (error: Error) => void;
    music.analyzeMusic.mockImplementationOnce((_blob, _name, options) => {
      options.onPreview?.({ ...saved, stage: 'preview' });
      partial = options.onPartial;
      return new Promise((_resolve, reject) => { rejectAnalysis = reject; });
    });
    const controller = new AbortController();
    const run = analyzeAudioCorpus([node.id], controller.signal);
    const rejected = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(partial).toBeTypeOf('function'));
    controller.abort();
    await rejected;

    // The decoder/worker unwinds after Quick's initial promise has rejected.
    // Its final ledger must wait behind an unrelated mutation without losing its owner.
    let release!: () => void;
    let entered = false;
    const blocker = enqueueRun(async () => {
      entered = true;
      await new Promise<void>(resolve => { release = resolve; });
    });
    await vi.waitFor(() => expect(entered).toBe(true));
    const recognition = createRecognition(saved.durationSeconds, 'fast');
    recognition.status = 'cancelled';
    let savedCancellation = false;
    persistence.saveSession.mockImplementationOnce(async () => {
      savedCancellation = useGraphStore.getState().nodes.find(n => n.id === node.id)?.audio?.recognition?.runId === recognition.runId;
    });
    partial({ ...saved, recognition });
    rejectAnalysis(new DOMException('Cancelled', 'AbortError'));
    try {
      await Promise.resolve();
      expect(useGraphStore.getState().nodes.find(n => n.id === node.id)?.audio?.recognition?.status).not.toBe('cancelled');
    } finally { release(); }
    await blocker;
    await enqueueRun(async () => undefined);
    expect(useGraphStore.getState().nodes.find(n => n.id === node.id)?.audio).toMatchObject({
      confirmedInstruments: ['piano'], recognition: { status: 'cancelled', runId: recognition.runId },
    });
    expect(savedCancellation).toBe(true);
  });
  it('does not let a cancelled Quick job write into a reset replacement with the same id', async () => {
    useSettingsStore.getState().setMusicAnalysisMode('fast');
    const original = music.analyzeMusic.getMockImplementation()!;
    let oldPartial!: (result: Awaited<ReturnType<typeof original>>) => void;
    let finishOldFull!: (result: Awaited<ReturnType<typeof original>>) => void;
    let firstResult!: Awaited<ReturnType<typeof original>>;
    music.analyzeMusic.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[2].mode === 'fast') {
        firstResult = { ...result, instrumentScan: { ...result.instrumentScan, mode: 'fast' } };
        return firstResult;
      }
      oldPartial = args[2].onPartial;
      return new Promise(resolve => { finishOldFull = resolve; });
    });

    await ingestFiles([wav('same.wav')]);
    await vi.waitFor(() => expect(oldPartial).toBeTypeOf('function'));
    const oldId = useGraphStore.getState().nodes.find(n => n.fileType === 'audio')!.id;

    resetCorpus();
    music.analyzeMusic.mockImplementation(async (...args) => {
      const result = await original(...args);
      return {
        ...result,
        durationSeconds: 22,
        instrumentScan: { ...result.instrumentScan, mode: args[2].mode },
      };
    });
    await ingestFiles([wav('same.wav')]);
    const replacement = useGraphStore.getState().nodes.find(n => n.fileType === 'audio')!;
    expect(replacement.id).toBe(oldId);

    const cancelledRecognition = createRecognition(firstResult.durationSeconds, 'full');
    cancelledRecognition.status = 'cancelled';
    oldPartial({ ...firstResult, durationSeconds: 1, recognition: cancelledRecognition });
    await enqueueRun(async () => undefined);

    expect(useGraphStore.getState().nodes.find(n => n.id === oldId)?.audio?.durationSeconds).toBe(22);
    expect(useGraphStore.getState().nodes.find(n => n.id === oldId)?.audio?.recognition?.status).not.toBe('cancelled');

    finishOldFull(firstResult);
    await enqueueRun(async () => undefined);
  });
  it('keeps cancelled evidence when Full resolves after its signal was aborted',async()=>{
    await ingestFiles([wav('late-full.wav')]);
    const selected=useGraphStore.getState().nodes.find(n=>n.fileType==='audio')!;
    persistence.getOriginal.mockResolvedValue({blob:new Blob(['RIFF']),name:'late-full.wav'});
    const controller=new AbortController();
    const recognition=createRecognition(selected.audio!.durationSeconds,'full');recognition.status='cancelled';
    music.analyzeMusic.mockImplementationOnce(async(_blob,_name,options)=>{
      controller.abort();options.onPartial?.({...selected.audio!,recognition});
      return {...selected.audio!,durationSeconds:999};
    });
    await expect(analyzeAudioCorpus([selected.id],controller.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(useGraphStore.getState().nodes.find(n=>n.id===selected.id)?.audio).toMatchObject({recognition:{status:'cancelled'}});
    expect(useGraphStore.getState().nodes.find(n=>n.id===selected.id)?.audio?.durationSeconds).not.toBe(999);
  });
  it('queues cancelled background evidence behind a later parsing invocation',async()=>{
    useSettingsStore.getState().setMusicAnalysisMode('fast');
    const original=music.analyzeMusic.getMockImplementation()!;
    let partial!: (result: Awaited<ReturnType<typeof original>>)=>void;
    let finish!: (result: Awaited<ReturnType<typeof original>>)=>void;
    let result!: Awaited<ReturnType<typeof original>>;
    music.analyzeMusic.mockImplementation(async(...args)=>{
      result=await original(...args);
      if(args[2].mode==='fast')return {...result,instrumentScan:{...result.instrumentScan,mode:'fast'}};
      partial=args[2].onPartial;
      return new Promise(resolve=>{finish=resolve;});
    });
    await ingestFiles([wav('background-cancel.wav')]);
    await vi.waitFor(()=>expect(partial).toBeTypeOf('function'));
    const node=useGraphStore.getState().nodes.find(n=>n.fileType==='audio')!;
    let release!: ()=>void;let entered=false;
    const blocker=enqueueRun(async()=>{useGraphStore.getState().setPhase('parsing');entered=true;await new Promise<void>(resolve=>{release=resolve;});useGraphStore.getState().setPhase('ready');});
    await vi.waitFor(()=>expect(entered).toBe(true));
    const recognition=createRecognition(result.durationSeconds,'full');recognition.status='cancelled';
    cancelMusicJob(node.id);partial({...result,recognition});finish(result);
    try { expect(useGraphStore.getState().nodes.find(n=>n.id===node.id)?.audio?.recognition?.status).not.toBe('cancelled'); } finally { release(); }
    await blocker;await enqueueRun(async()=>undefined);
    expect(useGraphStore.getState().nodes.find(n=>n.id===node.id)?.audio?.recognition?.status).toBe('cancelled');
  });
  it('invalidates sound links after reviews and preserves authored collisions through full reanalysis', async () => {
    await ingestFiles([wav('alpha.wav'), wav('beta.wav')]);
    const ids=documentIds();
    for(const id of ids)await setAudioDjTags(id,{source:['piano'],production:[],character:['metallic']});
    expect(useGraphStore.getState().edges.filter(e=>e.kind==='sound')).toHaveLength(1);
    const selected=useGraphStore.getState().nodes.find(n=>n.id===ids[0])!;
    useGraphStore.getState().patchNodes(new Map([[selected.id,{audio:{...selected.audio!,recognition:createRecognition(selected.audio!.durationSeconds,'full')}}]]));
    await setAudioReview(selected.id,'metallic','character','uncertain');
    expect(useGraphStore.getState().edges.filter(e=>e.kind==='sound')).toHaveLength(0);
    await setAudioReview(selected.id,'metallic','character','confirmed');
    expect(useGraphStore.getState().edges.filter(e=>e.kind==='sound')).toHaveLength(1);
    const automatic=useGraphStore.getState().edges.find(e=>e.kind==='tempo')!;
    const authored={...automatic,authored:true,weight:.123,evidence:['My saved tempo relationship']};
    useGraphStore.getState().setEdges(useGraphStore.getState().edges.map(e=>e.id===authored.id?authored:e));
    persistence.getOriginal.mockResolvedValue({blob:new Blob(['RIFF']),name:'alpha.wav'});
    await analyzeAudioCorpus(ids);
    expect(useGraphStore.getState().edges.find(e=>e.id===authored.id)).toEqual(authored);
  });
  it('saves review history and retains it across reanalysis without promoting rejected labels',async()=>{
    await ingestFiles([wav('review.wav')]);
    const selected=useGraphStore.getState().nodes.find(n=>n.fileType==='audio')!;
    useGraphStore.getState().patchNodes(new Map([[selected.id,{audio:{...selected.audio!,recognition:createRecognition(selected.audio!.durationSeconds,'full')}}]]));
    await setAudioReview(selected.id,'oboe','source','confirmed');
    await setAudioReview(selected.id,'oboe','source','rejected');
    const reviews=useGraphStore.getState().nodes.find(n=>n.id===selected.id)?.audio?.soundReviews;
    expect(reviews?.map(r=>r.decision)).toEqual(['confirmed','rejected']);
    persistence.getOriginal.mockResolvedValue({blob:new Blob(['RIFF']),name:'review.wav'});
    await analyzeAudioCorpus([selected.id]);
    expect(useGraphStore.getState().nodes.find(n=>n.id===selected.id)?.audio?.soundReviews).toEqual(reviews);
  });
  it('reconciles bulk instrument corrections with per-label reviews without losing history',async()=>{
    await ingestFiles([wav('review.wav')]);
    const selected=useGraphStore.getState().nodes.find(n=>n.fileType==='audio')!;
    useGraphStore.getState().patchNodes(new Map([[selected.id,{audio:{...selected.audio!,recognition:createRecognition(selected.audio!.durationSeconds,'full')}}]]));
    await setAudioReview(selected.id,'piano','source','confirmed');
    await setAudioInstruments([selected.id],[]);
    expect(useGraphStore.getState().nodes.find(n=>n.id===selected.id)?.audio?.soundReviews?.map(r=>r.decision)).toEqual(['confirmed','rejected']);
    await setAudioInstruments([selected.id],['piano']);
    expect(useGraphStore.getState().nodes.find(n=>n.id===selected.id)?.audio?.soundReviews?.map(r=>r.decision)).toEqual(['confirmed','rejected','confirmed']);
    await setAudioReview(selected.id,'piano','source','rejected');
    expect(useGraphStore.getState().nodes.find(n=>n.id===selected.id)?.audio?.confirmedInstruments).toEqual([]);
  });
  it('synchronizes explicit source snapshots without clearing production or character corrections', async () => {
    await ingestFiles([wav('source-snapshot.wav')]);
    const id = documentIds()[0];
    await setAudioInstruments([id], ['piano']);
    await setAudioDjTags(id, { source: [], production: [], character: [] });
    expect(useGraphStore.getState().nodes.find(n => n.id === id)?.audio?.confirmedInstruments).toEqual([]);
    await setAudioDjTags(id, { source: ['piano'], production: ['chops'], character: ['airy'] });
    const tags = useGraphStore.getState().nodes.find(n => n.id === id)!.audio!.confirmedDjTags!;
    await setAudioInstruments([id], []);
    expect(useGraphStore.getState().nodes.find(n => n.id === id)?.audio?.confirmedDjTags).toEqual({ ...tags, source: [] });
    await setAudioDjTags(id, { source: ['foley'], production: ['chops'], character: ['airy'] });
    const restored = sanitizeMusicAnalysis(JSON.parse(JSON.stringify(useGraphStore.getState().nodes.find(n => n.id === id)?.audio)));
    expect(restored?.confirmedInstruments).toEqual(['foley']);
    expect(restored?.confirmedDjTags).toEqual({ source: ['foley'], production: ['chops'], character: ['airy'] });
  });
  it('lets explicit DJ source correction supersede rejection while preserving its review history', async () => {
    await ingestFiles([wav('dj-review.wav')]);
    const node = useGraphStore.getState().nodes.find(n => n.fileType === 'audio')!;
    useGraphStore.getState().patchNodes(new Map([[node.id, { audio: { ...node.audio!, recognition: createRecognition(node.audio!.durationSeconds, 'full') } }]]));
    await setAudioReview(node.id, 'piano', 'source', 'rejected');
    await setAudioDjTags(node.id, { source: ['piano'], production: [], character: [] });
    const updated = useGraphStore.getState().nodes.find(n => n.id === node.id)!.audio!;
    expect(updated.confirmedInstruments).toEqual(['piano']);
    expect(updated.soundReviews?.map(review => review.decision)).toEqual(['rejected', 'confirmed']);
    await setAudioInstruments([node.id]);
    expect(useGraphStore.getState().nodes.find(n => n.id === node.id)?.audio?.soundReviews).toEqual(updated.soundReviews);
    expect(useGraphStore.getState().nodes.find(n => n.id === node.id)?.audio?.confirmedDjTags?.source).toEqual(['piano']);
    await setAudioDjTags(node.id);
    expect(useGraphStore.getState().nodes.find(n => n.id === node.id)?.audio?.soundReviews).toEqual(updated.soundReviews);
  });
  it('lets saved character corrections supersede older reviews while later individual reviews still win', async () => {
    await ingestFiles([wav('character-review.wav')]);
    const node = useGraphStore.getState().nodes.find(n => n.fileType === 'audio')!;
    useGraphStore.getState().patchNodes(new Map([[node.id, { audio: { ...node.audio!, recognition: createRecognition(node.audio!.durationSeconds, 'full') } }]]));
    const current = () => useGraphStore.getState().nodes.find(n => n.id === node.id)!.audio!;
    await setAudioReview(node.id, 'warm', 'character', 'confirmed');
    const original = current().soundReviews![0];
    await setAudioDjTags(node.id, { source: [], production: [], character: [] });
    expect(resolvedNonSourceLabels(current()).filter(label => label.group === 'character')).toEqual([]);
    expect(current().soundReviews?.[0]).toEqual(original);
    expect(latestSoundReview(current().soundReviews, 'character', 'warm')?.decision).toBe('rejected');
    const clearedHistory = current().soundReviews;
    await setAudioDjTags(node.id, { source: [], production: [], character: [] });
    expect(current().soundReviews).toEqual(clearedHistory);
    const restored = sanitizeMusicAnalysis(JSON.parse(JSON.stringify(current())))!;
    expect(resolvedNonSourceLabels(restored).filter(label => label.group === 'character')).toEqual([]);
    await setAudioReview(node.id, 'warm', 'character', 'confirmed');
    expect(resolvedNonSourceLabels(current())).toContainEqual({ group: 'character', label: 'warm', source: 'confirmed' });
    await setAudioReview(node.id, 'warm', 'character', 'uncertain');
    await setAudioDjTags(node.id, { source: [], production: [], character: ['warm'] });
    expect(resolvedNonSourceLabels(current())).toContainEqual({ group: 'character', label: 'warm', source: 'confirmed' });
    expect(current().soundReviews?.map(review => review.decision)).toEqual(['confirmed', 'rejected', 'confirmed', 'uncertain', 'confirmed']);
    const history = current().soundReviews;
    await setAudioDjTags(node.id);
    expect(current().soundReviews).toEqual(history);
  });
  it('lets a saved falling correction supersede a historical downlifter rejection', async () => {
    await ingestFiles([wav('downlifter-review.wav')]);
    const node = useGraphStore.getState().nodes.find(n => n.fileType === 'audio')!;
    useGraphStore.getState().patchNodes(new Map([[node.id, { audio: { ...node.audio!, recognition: createRecognition(node.audio!.durationSeconds, 'full') } }]]));
    await setAudioReview(node.id, 'downlifter', 'effect', 'rejected');
    const current = () => useGraphStore.getState().nodes.find(n => n.id === node.id)!.audio!;
    const original = current().soundReviews![0];
    await setAudioDjTags(node.id, { source: [], production: [], character: ['falling'] });
    expect(latestSoundReview(current().soundReviews, 'character', 'falling')?.decision).toBe('confirmed');
    expect(resolvedNonSourceLabels(current())).toContainEqual({ group: 'character', label: 'falling', source: 'confirmed' });
    expect(current().soundReviews?.[0]).toEqual(original);
    const restored = sanitizeMusicAnalysis(JSON.parse(JSON.stringify(current())))!;
    expect(resolvedNonSourceLabels(restored)).toContainEqual({ group: 'character', label: 'falling', source: 'confirmed' });
    const history = current().soundReviews;
    await setAudioDjTags(node.id, { source: [], production: [], character: ['falling'] });
    expect(current().soundReviews).toEqual(history);
    await setAudioDjTags(node.id, { source: [], production: [], character: [] });
    expect(latestSoundReview(current().soundReviews, 'character', 'falling')?.decision).toBe('rejected');
    expect(resolvedNonSourceLabels(current())).toEqual([]);
  });
  it('refuses a character correction atomically when reconciliation would exceed the review history limit', async () => {
    await ingestFiles([wav('character-review-limit.wav')]);
    const node = useGraphStore.getState().nodes.find(n => n.fileType === 'audio')!;
    const review = { labelId: 'warm', dimension: 'character' as const, decision: 'confirmed' as const, scope: 'track' as const, at: '2026-10-10T00:00:00Z', evidenceRunId: 'r' };
    const audio = { ...node.audio!, soundReviews: Array.from({ length: 500 }, () => ({ ...review })) };
    useGraphStore.getState().patchNodes(new Map([[node.id, { audio }]]));
    await expect(setAudioDjTags(node.id, { source: [], production: [], character: [] })).rejects.toThrow('Review history limit reached');
    expect(useGraphStore.getState().nodes.find(n => n.id === node.id)?.audio).toEqual(audio);
    // Saving an unchanged decision needs no new history entry, even at the limit.
    await expect(setAudioDjTags(node.id, { source: [], production: [], character: ['warm'] })).resolves.toBe(true);
    expect(useGraphStore.getState().nodes.find(n => n.id === node.id)?.audio?.soundReviews).toEqual(audio.soundReviews);
  });
  it('re-runs saved one-shots and full long recordings after a one-shot model change, keeping their reviews', async () => {
    await ingestFiles([wav('hit.wav'), wav('song.wav')]);
    const [hit, song] = useGraphStore.getState().nodes.filter(n => n.fileType === 'audio');
    const old = (seconds: number) => ({ ...createRecognition(seconds, 'full'), configurationHash: recognitionConfiguration('full') });
    useGraphStore.getState().patchNodes(new Map([
      [hit.id, { audio: { ...hit.audio!, durationSeconds: 1.5, recognition: old(1.5) } }],
      [song.id, { audio: { ...song.audio!, durationSeconds: 30, recognition: old(30) } }],
    ]));
    await setAudioReview(hit.id, 'piano', 'source', 'rejected');
    await setAudioDjTags(hit.id, { source: [], production: ['kick'], character: [] });
    const saved = useGraphStore.getState().nodes.find(n => n.id === hit.id)!.audio!;
    const songBefore = useGraphStore.getState().nodes.find(n => n.id === song.id)!.audio;
    // Two tracks re-run now: each needs its own result object, as real analyses return.
    const fresh = await music.analyzeMusic();
    music.analyzeMusic.mockClear();
    music.analyzeMusic.mockImplementation(async () => structuredClone(fresh));
    persistence.getOriginal.mockResolvedValue({ blob: new Blob(['RIFF']), name: 'hit.wav' });
    await analyzeAudioCorpus();
    // The song's full analysis used the one-shot heads on its event windows, so it re-runs too.
    expect(music.analyzeMusic).toHaveBeenCalledTimes(2);
    const after = useGraphStore.getState().nodes.find(n => n.id === hit.id)!.audio!;
    expect(after.soundReviews).toEqual(saved.soundReviews);
    expect(after.confirmedDjTags).toEqual(saved.confirmedDjTags);
    expect(useGraphStore.getState().nodes.find(n => n.id === song.id)!.audio).not.toEqual(songBefore);
  });
  it('reanalyzes only selected audio while other stale results stay untouched', async () => {
    await ingestFiles([wav('selected.wav'), wav('stale.wav')]);
    const nodes = useGraphStore.getState().nodes.filter(n => n.fileType === 'audio');
    const [selected, stale] = nodes;
    useGraphStore.getState().patchNodes(new Map([[stale.id, { audio: { ...stale.audio!, keyRevision: 0 } }]]));
    const before = useGraphStore.getState().nodes.find(n => n.id === stale.id)!.audio;
    persistence.getOriginal.mockResolvedValue({ blob: new Blob(['RIFF']), name: 'selected.wav' });
    await analyzeAudioCorpus([selected.id]);
    expect(useGraphStore.getState().nodes.find(n => n.id === stale.id)!.audio).toEqual(before);
  });
  it('reports correction save failures and supports retrying the visible change', async () => {
    await ingestFiles([wav('one.wav')]);
    persistence.saveActiveCorpusPositions.mockRejectedValueOnce(new Error('quota'));
    await expect(setAudioInstruments(documentIds(), ['piano'])).rejects.toThrow('visible but could not be saved');
    expect(useGraphStore.getState().nodes.find(n => n.fileType === 'audio')?.audio?.confirmedInstruments).toEqual(['piano']);
    await expect(setAudioInstruments(documentIds(), ['piano'])).resolves.toEqual({ saved: true, count: 1 });
    expect(persistence.saveActiveCorpusPositions).toHaveBeenCalledTimes(2);
  });
  it.each(['shared', 'imported'] as const)('does not claim a durable correction in %s graphs', async mode => {
    await ingestFiles([wav('one.wav')]);
    useCorpusStore.getState().setEphemeral('Temporary graph', mode);
    await expect(setAudioInstruments(documentIds(), ['piano'])).resolves.toEqual({ saved: false, count: 1 });
    expect(persistence.saveActiveCorpusPositions).not.toHaveBeenCalled();
  });
  it('preserves instrument corrections through reanalysis and can restore automatic labels', async () => {
    await ingestFiles([wav('one.wav'), wav('two.wav')]);
    const ids = documentIds();
    await setAudioInstruments(ids, ['piano']);
    expect(useGraphStore.getState().edges.find(e => e.kind === 'instrument')?.evidence[0]).toContain('Confirmed by you on both tracks');
    const nodes = useGraphStore.getState().nodes.filter(n => n.fileType === 'audio');
    useGraphStore.getState().patchNodes(new Map(nodes.map(n => [n.id, { audio: { ...n.audio!, keyRevision: 0 } }])));
    persistence.getOriginal.mockResolvedValue({ blob: new Blob(['RIFF']), name: 'one.wav' });
    const fresh = await music.analyzeMusic();
    music.analyzeMusic.mockClear();
    music.analyzeMusic.mockImplementation(async () => structuredClone(fresh));
    await analyzeAudioCorpus();
    expect(music.analyzeMusic).toHaveBeenCalledTimes(2);
    expect(useGraphStore.getState().nodes.filter(n => n.fileType === 'audio').every(n => n.audio?.confirmedInstruments?.[0] === 'piano')).toBe(true);
    await setAudioInstruments(ids);
    expect(useGraphStore.getState().nodes.filter(n => n.fileType === 'audio').every(n => n.audio?.confirmedInstruments === undefined)).toBe(true);
    expect(useGraphStore.getState().edges.find(e => e.kind === 'instrument')?.evidence[0]).toContain('synthesizer');
  });
  it('analyzes only the new track when files are added to a library with older results', async () => {
    await ingestFiles([wav('one.wav'), wav('two.wav')]);
    const ids = documentIds();
    // Every saved result predates the current detectors, as after a model update ships.
    useGraphStore.getState().patchNodes(new Map(ids.map(id => {
      const audio = useGraphStore.getState().nodes.find(n => n.id === id)!.audio!;
      return [id, { audio: { ...audio, keyRevision: 0, classifierConfiguration: 'older release' } }];
    })));
    const before = new Map(ids.map(id => [id, useGraphStore.getState().nodes.find(n => n.id === id)!.audio]));
    music.analyzeMusic.mockClear();
    // Re-reading the whole folder with one new file in it.
    await ingestFiles([wav('one.wav'), wav('two.wav'), wav('three.wav')]);
    expect(music.analyzeMusic).toHaveBeenCalledTimes(1);
    expect(music.analyzeMusic.mock.calls[0][1]).toBe('three.wav');
    for (const id of ids) expect(useGraphStore.getState().nodes.find(n => n.id === id)!.audio).toEqual(before.get(id));
    expect(outdatedAudioIds().sort()).toEqual([...ids].sort());
    // Updating them is a separate, explicit step.
    persistence.getOriginal.mockResolvedValue({ blob: new Blob(['RIFF']), name: 'one.wav' });
    const fresh = await music.analyzeMusic();
    music.analyzeMusic.mockClear();
    music.analyzeMusic.mockImplementation(async () => structuredClone(fresh));
    await analyzeAudioCorpus();
    expect(music.analyzeMusic).toHaveBeenCalledTimes(2);
    expect(outdatedAudioIds()).toEqual([]);
  });
  it('updates the listed older tracks without restarting unrelated unfinished analysis', async () => {
    await ingestFiles([wav('older.wav'), wav('unfinished.wav'), wav('current.wav')]);
    const [older, unfinished, current] = useGraphStore.getState().nodes.filter(n => n.fileType === 'audio');
    useGraphStore.getState().patchNodes(new Map([
      [older.id, { audio: { ...older.audio!, keyRevision: 0 } }],
      [unfinished.id, { audio: { ...unfinished.audio!, instrumentScan: { ...unfinished.audio!.instrumentScan!, complete: false } } }],
    ]));
    const before = useGraphStore.getState().nodes.find(n => n.id === unfinished.id)!.audio;
    const updating = outdatedAudioIds();
    expect(updating).toEqual([older.id]);
    persistence.getOriginal.mockResolvedValue({ blob: new Blob(['RIFF']), name: 'older.wav' });
    const fresh = await music.analyzeMusic();
    music.analyzeMusic.mockClear();
    music.analyzeMusic.mockImplementation(async () => structuredClone(fresh));
    await analyzeAudioCorpus(updating);
    expect(music.analyzeMusic).toHaveBeenCalledTimes(1);
    expect(music.analyzeMusic.mock.calls[0][2].cacheKey).toBe(older.id);
    expect(useGraphStore.getState().nodes.find(n => n.id === unfinished.id)!.audio).toEqual(before);
    expect(useGraphStore.getState().nodes.find(n => n.id === current.id)!.audio).toEqual(current.audio);
    expect(outdatedAudioIds()).toEqual([]);
  });
  it('finishes an unfinished track in the drop without touching unfinished tracks outside it', async () => {
    await ingestFiles([wav('one.wav'), wav('two.wav')]);
    const [one, two] = useGraphStore.getState().nodes.filter(n => n.fileType === 'audio');
    useGraphStore.getState().patchNodes(new Map([one, two].map(n => [n.id, { audio: { ...n.audio!, instrumentScan: { ...n.audio!.instrumentScan!, complete: false } } }])));
    music.analyzeMusic.mockClear();
    await ingestFiles([wav('one.wav')]);
    expect(music.analyzeMusic).toHaveBeenCalledTimes(1);
    expect(useGraphStore.getState().nodes.find(n => n.id === one.id)!.audio?.instrumentScan?.complete).toBe(true);
    expect(useGraphStore.getState().nodes.find(n => n.id === two.id)!.audio?.instrumentScan?.complete).toBe(false);
  });
  it('analyzes new WAVs and repairs missing analysis when the same files are dropped again', async () => {
    await ingestFiles([wav('one.wav'), wav('two.WAV')]);
    expect(music.analyzeMusic).toHaveBeenCalledTimes(2);
    expect(useGraphStore.getState().edges.map(e => e.kind)).toEqual(expect.arrayContaining(['tempo', 'key', 'instrument']));
    const ids = documentIds();
    useGraphStore.getState().patchNodes(new Map(ids.map(id => [id, { audio: undefined }])));
    useGraphStore.getState().setEdges([]);
    music.analyzeMusic.mockClear();
    await ingestFiles([wav('one.wav'), wav('two.WAV')]);
    expect(music.analyzeMusic).toHaveBeenCalledTimes(2);
    expect(documentIds()).toHaveLength(2);
    expect(useGraphStore.getState().nodes.filter(n => n.fileType === 'audio').every(n => n.audio?.instrumentScan?.complete)).toBe(true);
    expect(useGraphStore.getState().edges.map(e => e.kind)).toContain('tempo');
    expect(persistence.getOriginal).not.toHaveBeenCalled();
    music.analyzeMusic.mockClear();
    await ingestFiles([wav('one.wav')]);
    expect(music.analyzeMusic).not.toHaveBeenCalled();
  });
  it('publishes a preview before finishing a new upload without replacing a completed reanalysis', async () => {
    const original = music.analyzeMusic.getMockImplementation()!;
    music.analyzeMusic.mockImplementation(async (...args) => {
      const final = await original(...args);
      args[2].onPreview({ ...final, stage: 'preview', instruments: [], instrumentScan: { ...final.instrumentScan, complete: false } });
      expect(useGraphStore.getState().nodes.find(n => n.fileType === 'audio')?.audio?.stage).toBe('preview');
      return final;
    });
    await ingestFiles([wav('preview.wav')]);
    expect(useGraphStore.getState().nodes.find(n => n.fileType === 'audio')?.audio?.stage).toBeUndefined();
    const node = useGraphStore.getState().nodes.find(n => n.fileType === 'audio')!;
    useGraphStore.getState().patchNodes(new Map([[node.id, { audio: { ...node.audio!, keyRevision: 0 } }]]));
    music.analyzeMusic.mockImplementation(async (...args) => {
      const final = await original(...args);
      args[2].onPreview({ ...final, stage: 'preview', instruments: [] });
      expect(useGraphStore.getState().nodes.find(n => n.id === node.id)?.audio?.stage).toBeUndefined();
      return final;
    });
    await ingestFiles([wav('preview.wav')]);
  });
  it('automatically follows an immediate Quick result with Full and reuses the finished scan', async () => {
    const original = music.analyzeMusic.getMockImplementation()!;
    music.analyzeMusic.mockImplementation(async (...args) => {
      const final = await original(...args);
      return { ...final, instrumentScan: { ...final.instrumentScan, mode: args[2].mode } };
    });
    useSettingsStore.getState().setMusicAnalysisMode('fast');
    await ingestFiles([wav('modes.wav')]);
    await vi.waitFor(()=>expect(useGraphStore.getState().nodes.find(n=>n.fileType==='audio')?.audio?.instrumentScan?.mode).toBe('full'));
    expect(music.analyzeMusic.mock.calls.map(call=>call[2].mode)).toEqual(['fast','full']);
    music.analyzeMusic.mockClear();
    await ingestFiles([wav('modes.wav')]);
    expect(music.analyzeMusic).not.toHaveBeenCalled();
  });
  it('batches background results into one worker rebuild and reclusters the final graph', async () => {
    useSettingsStore.getState().setMusicAnalysisMode('fast');
    const original = music.analyzeMusic.getMockImplementation()!;
    const finishes: (() => void)[] = [];
    music.analyzeMusic.mockImplementation(async (...args) => {
      const base = await original(...args);
      const result = { ...base, instrumentScan: { ...base.instrumentScan, mode: args[2].mode } };
      if (args[2].mode === 'full') return new Promise(resolve => finishes.push(() => resolve(result)));
      return result;
    });
    await ingestFiles([wav('batch-one.wav'), { ...wav('batch-two.wav'), bytes: new TextEncoder().encode('RIFF second distinct audio').buffer }]);
    await vi.waitFor(() => expect(finishes).toHaveLength(2));
    for (const name of ['batch-one.wav', 'batch-two.wav']) {
      const calls = music.analyzeMusic.mock.calls.filter(call => call[1] === name);
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toBe(calls[1][0]);
      expect(calls[0][2].cacheContext).toBe(calls[1][2].cacheContext);
    }
    aggState.requests = [];
    layout.layoutSetClusters.mockClear();
    persistence.saveSession.mockClear();
    finishes.forEach(finish => finish());
    await vi.waitFor(() => expect(layout.layoutSetClusters).toHaveBeenCalled());
    await enqueueRun(async () => undefined);
    expect(aggState.requests.filter(req => req.type === 'music')).toHaveLength(1);
    expect(aggState.requests.filter(req => req.type === 'cluster')).toHaveLength(1);
    expect(persistence.saveSession).toHaveBeenCalled();
    expect(useGraphStore.getState().nodes.filter(n => n.fileType === 'audio').every(n => n.audio?.instrumentScan?.mode === 'full')).toBe(true);
  });
  it('queues all Full-mode songs and shows their previews before waiting for completed scans', async () => {
    const original = music.analyzeMusic.getMockImplementation()!;
    const finish: (() => void)[] = [];
    music.analyzeMusic.mockImplementation(async (...args) => {
      const final = await original(...args);
      args[2].onPreview({ ...final, stage: 'preview', instrumentScan: { ...final.instrumentScan, complete: false } });
      return new Promise(resolve => { finish.push(() => resolve(final)); });
    });
    const ingest = ingestFiles([wav('one.wav'), wav('two.wav'), wav('three.wav')]);
    await vi.waitFor(() => expect(finish).toHaveLength(3));
    expect(useGraphStore.getState().nodes.filter(n => n.fileType === 'audio').every(n => n.audio?.stage === 'preview')).toBe(true);
    finish.forEach(resolve => resolve());
    await ingest;
    expect(useGraphStore.getState().nodes.filter(n => n.fileType === 'audio').every(n => n.audio?.instrumentScan?.complete)).toBe(true);
  });
  it('publishes a late Quick preview after the graph opens without losing confirmed labels', async () => {
    vi.useFakeTimers();
    useSettingsStore.getState().setMusicAnalysisMode('fast');
    const original = music.analyzeMusic.getMockImplementation()!;
    let emitPreview!: (result: Awaited<ReturnType<typeof original>>) => void;
    let finish!: (result: Awaited<ReturnType<typeof original>>) => void;
    let final!: Awaited<ReturnType<typeof original>>;
    music.analyzeMusic.mockImplementation(async (...args) => {
      final = await original(...args);
      emitPreview = args[2].onPreview;
      return new Promise(resolve => { finish = resolve; });
    });
    const ingest = ingestFiles([wav('late-preview.wav')]);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await vi.advanceTimersByTimeAsync(14000);
    await ingest;
    vi.useRealTimers();
    const node = useGraphStore.getState().nodes.find(n => n.fileType === 'audio')!;
    expect(node.audio?.durationSeconds).toBe(0);
    await setAudioDjTags(node.id, { source: ['piano'], production: [], character: [] });
    emitPreview({ ...final, stage: 'preview', instrumentScan: { ...final.instrumentScan, complete: false } });
    await enqueueRun(async () => undefined);
    const updated = useGraphStore.getState().nodes.find(n => n.id === node.id)!;
    expect(updated.audio?.durationSeconds).toBe(10);
    expect(updated.audio?.confirmedDjTags?.source).toEqual(['piano']);
    cancelMusicJob(node.id);
    finish(final);
    await enqueueRun(async () => undefined);
  });
  it('keeps Quick results when the background Full scan is stopped', async () => {
    useSettingsStore.getState().setMusicAnalysisMode('fast');
    const original=music.analyzeMusic.getMockImplementation()!;
    let finishFull!: ()=>void;
    let fullSignal: AbortSignal | undefined;
    music.analyzeMusic.mockImplementation(async (...args)=>{
      const base=await original(...args);
      const result={...base,instrumentScan:{...base.instrumentScan,mode:args[2].mode}};
      if(args[2].mode==='fast')return result;
      fullSignal=args[2].signal;
      return new Promise(resolve=>{finishFull=()=>resolve(result);});
    });
    await ingestFiles([wav('stop-full.wav')]);
    await vi.waitFor(()=>expect(finishFull).toBeTypeOf('function'));
    const node=useGraphStore.getState().nodes.find(n=>n.fileType==='audio')!;
    expect(node.audio?.instrumentScan?.mode).toBe('fast');
    cancelMusicJob(node.id);
    expect(fullSignal?.aborted).toBe(true);
    finishFull();
    await enqueueRun(async()=>undefined);
    expect(useGraphStore.getState().nodes.find(n=>n.id===node.id)?.audio?.instrumentScan?.mode).toBe('fast');
    expect(useMusicJobs.getState().jobs[node.id]).toBeUndefined();
  });
  it('reports Mac metadata disguised as WAV without creating a track', async () => {
    const bytes = new ArrayBuffer(4096); const view = new DataView(bytes);
    view.setUint32(0, 0x00051607); view.setUint32(4, 0x00020000);
    await ingestFiles([{ ...wav('_sample.wav'), bytes }]);
    expect(documentIds()).toHaveLength(0);
    expect(music.analyzeMusic).not.toHaveBeenCalled();
    expect(useGraphStore.getState().ingestReport?.entries[0].reason).toContain('Mac metadata');
  });
  it('reports decode failures and retries them on a second drop', async () => {
    music.analyzeMusic.mockRejectedValueOnce(new Error('Cannot decode audio'));
    await ingestFiles([wav('broken.wav')]);
    expect(fileStatus('file-broken.wav')?.stage).toBe('error');
    expect(useGraphStore.getState().ingestReport?.entries[0].reason).toBe('Cannot decode audio');
    await ingestFiles([wav('broken.wav')]);
    expect(fileStatus('file-broken.wav')?.stage).toBe('placed');
    expect(useGraphStore.getState().ingestReport).toBeNull();
  });
  it('releases Quick ingest after its richer preview deadline and preserves later corrections when background work finishes', async () => {
    vi.useFakeTimers();
    useSettingsStore.getState().setMusicAnalysisMode('fast');
    const original=music.analyzeMusic.getMockImplementation()!;
    let finish!: (value: Awaited<ReturnType<typeof original>>)=>void;
    let finishFull!: (value: Awaited<ReturnType<typeof original>>)=>void;
    let final: Awaited<ReturnType<typeof original>>;
    music.analyzeMusic.mockImplementation(async (...args)=>{
      final=await original(...args);
      if(args[2].mode==='full')return new Promise(resolve=>{finishFull=resolve;});
      args[2].onPreview({...final,stage:'preview',instruments:[]});
      return new Promise(resolve=>{finish=resolve;});
    });
    const ingest=ingestFiles([wav('background.wav')]);
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    await vi.advanceTimersByTimeAsync(14000);
    await ingest;
    vi.useRealTimers();
    expect(useGraphStore.getState().phase).toBe('ready');
    const node=useGraphStore.getState().nodes.find(n=>n.fileType==='audio')!;
    expect(node.audio?.stage).toBe('preview');
    await setAudioDjTags(node.id,{source:['piano'],production:[],character:[]});
    finish(final!);
    await vi.waitFor(()=>expect(finishFull).toBeTypeOf('function'));
    expect(useGraphStore.getState().phase).toBe('ready');
    finishFull({...final!,instrumentScan:{...final!.instrumentScan,mode:'full'}});
    await vi.waitFor(()=>expect(useGraphStore.getState().nodes.find(n=>n.id===node.id)?.audio?.instrumentScan?.mode).toBe('full'));
    await vi.waitFor(()=>expect(useGraphStore.getState().nodes.find(n=>n.id===node.id)?.audio?.stage).toBeUndefined());
    expect(useGraphStore.getState().nodes.find(n=>n.id===node.id)?.audio?.confirmedDjTags?.source).toEqual(['piano']);
  });
});

describe('remembered library', () => {
  const wavBytes = () => new TextEncoder().encode('RIFF library audio bytes').buffer;
  const known = (name: string, knownId: string, readBytes = vi.fn(async () => wavBytes())): IngestFile => ({
    fileId: `known-${name}`, name, path: `Crate/${name}`, fileType: 'audio', bytes: new ArrayBuffer(0),
    lastModified: 1_700_000_000_000, knownId, readBytes,
  });
  /** Ingest a track once, then forget the live corpus so only the stored record remains. */
  async function storedTrack(name: string) {
    await ingestFiles([{ fileId: `first-${name}`, name, path: `Crate/${name}`, fileType: 'audio', bytes: wavBytes(), lastModified: 1_700_000_000_000 }]);
    const node = useGraphStore.getState().nodes.find(n => n.fileType === 'audio')!;
    resetCorpus();
    persistence.lookupDocCache.mockImplementation(async (id: string) => id === node.id
      ? { node, text: '', chunkTexts: [], chunkVectors: null, docVector: null, mdLinkTargets: [], docLinks: [] }
      : undefined);
    music.analyzeMusic.mockClear();
    persistence.putOriginalIfMissing.mockClear();
    return node;
  }

  it('remembers the path, size and date of each file it reads', async () => {
    await ingestFiles([{ fileId: 'f', name: 'a.wav', path: 'Crate/a.wav', fileType: 'audio', bytes: wavBytes(), lastModified: 42 }]);
    const id = documentIds()[0];
    expect(library.rememberLibraryFiles).toHaveBeenCalledWith([
      { path: 'Crate/a.wav', size: wavBytes().byteLength, lastModified: 42, docId: id, fileType: 'audio' },
    ]);
  });

  it('restores an unchanged track from storage without reading or re-analyzing it', async () => {
    const node = await storedTrack('kept.wav');
    const readBytes = vi.fn(async () => wavBytes());
    await ingestFiles([known('kept.wav', node.id, readBytes)]);
    expect(readBytes).not.toHaveBeenCalled();
    expect(music.analyzeMusic).not.toHaveBeenCalled();
    expect(persistence.putOriginalIfMissing).not.toHaveBeenCalled();
    expect(documentIds()).toEqual([node.id]);
    expect(fileStatus('known-kept.wav')?.stage).toBe('cached');
    expect(library.rememberLibraryFiles).toHaveBeenCalledWith([]);
    expect(useUiStore.getState().toasts.map(t => t.message)).toContain('All 1 track came from your saved library; nothing needed re-analyzing.');
  });

  it('re-analyzes a remembered track whose saved analysis is out of date, from the stored original', async () => {
    const node = await storedTrack('stale.wav');
    persistence.lookupDocCache.mockResolvedValue({ node: { ...node, audio: undefined }, text: '', chunkTexts: [], chunkVectors: null, docVector: null, mdLinkTargets: [], docLinks: [] });
    persistence.getOriginal.mockResolvedValue({ blob: new Blob([wavBytes()], { type: 'audio/wav' }), name: 'stale.wav' });
    const readBytes = vi.fn(async () => wavBytes());
    await ingestFiles([known('stale.wav', node.id, readBytes)]);
    expect(readBytes).not.toHaveBeenCalled();
    expect(persistence.getOriginal).toHaveBeenCalledWith(node.id);
    expect(music.analyzeMusic).toHaveBeenCalledTimes(1);
    expect(useGraphStore.getState().nodes.find(n => n.id === node.id)?.audio?.instrumentScan?.complete).toBe(true);
  });

  it.each([85, 86, 93, 94])('explicitly refreshes a persisted pre-calibration analysis at revision %i', async revision => {
    const node = await storedTrack('calibration.wav');
    const saved = { ...node, audio: { ...node.audio!,
      instrumentScan: { ...node.audio!.instrumentScan!, revision },
      confirmedInstruments: ['piano'],
    } };
    persistence.lookupDocCache.mockResolvedValue({ node: saved, text: '', chunkTexts: [], chunkVectors: null, docVector: null, mdLinkTargets: [], docLinks: [] });
    persistence.getOriginal.mockResolvedValue({ blob: new Blob([wavBytes()], { type: 'audio/wav' }), name: 'calibration.wav' });
    persistence.getOriginal.mockClear();
    const readBytes = vi.fn(async () => wavBytes());
    await ingestFiles([known('calibration.wav', node.id, readBytes)]);
    expect(readBytes).not.toHaveBeenCalled();
    expect(persistence.getOriginal).not.toHaveBeenCalled();
    expect(music.analyzeMusic).not.toHaveBeenCalled();
    expect(useGraphStore.getState().nodes.find(n => n.id === node.id)?.audio).toEqual(saved.audio);
    const updating = outdatedAudioIds();
    expect(updating).toEqual([node.id]);
    await analyzeAudioCorpus(updating);
    expect(persistence.getOriginal).toHaveBeenCalledWith(node.id);
    expect(music.analyzeMusic).toHaveBeenCalledTimes(1);
    const refreshed = useGraphStore.getState().nodes.find(n => n.id === node.id)!.audio!;
    expect(refreshed.instrumentScan?.revision).toBe(INSTRUMENT_ANALYSIS_REVISION);
    expect(refreshed.instrumentScan?.revision).toBeGreaterThan(86);
    expect(refreshed.confirmedInstruments).toEqual(['piano']);
    expect(outdatedAudioIds()).toEqual([]);
    music.analyzeMusic.mockClear();
    await analyzeAudioCorpus();
    expect(music.analyzeMusic).not.toHaveBeenCalled();
  });

  it('reads the file after all when its stored record has gone', async () => {
    library.hasDocumentRecord.mockResolvedValue(false);
    const readBytes = vi.fn(async () => wavBytes());
    await ingestFiles([known('gone.wav', 'stale-id', readBytes)]);
    expect(readBytes).toHaveBeenCalledTimes(1);
    expect(music.analyzeMusic).toHaveBeenCalledTimes(1);
    const id = documentIds()[0];
    expect(id).not.toBe('stale-id');
    expect(id).toBe(await documentContentId('Crate/gone.wav', wavBytes()));
    expect(library.rememberLibraryFiles).toHaveBeenCalledWith([expect.objectContaining({ docId: id, path: 'Crate/gone.wav' })]);
  });
});
