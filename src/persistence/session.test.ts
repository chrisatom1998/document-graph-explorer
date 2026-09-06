import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMBED_DIMS, EMBEDDING_FINGERPRINT } from '../config';
import { useGraphStore } from '../store/graphStore';
import { useCorpusStore } from '../store/corpusStore';
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

const cache = vi.hoisted(() => ({
  deleteDocsFromCache: vi.fn().mockResolvedValue(undefined),
  deleteGraphFromCache: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn(),
  isPersistenceHealthy: vi.fn(() => true),
  lookupGraphCache: vi.fn(),
  reportPersistenceUnavailable: vi.fn(),
  saveDocsToCache: vi.fn().mockResolvedValue(true),
  saveGraphToCache: vi.fn().mockResolvedValue(undefined),
  saveSnapshot: vi.fn().mockResolvedValue(1),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

const repo = vi.hoisted(() => ({
  activateCorpus: vi.fn().mockResolvedValue(undefined),
  getCorpusRecord: vi.fn(),
  initializeCorpusRepository: vi.fn(),
  markActiveCorpusEmpty: vi.fn().mockResolvedValue(undefined),
  unreferencedDocumentIds: vi.fn().mockResolvedValue([]),
}));

const layout = vi.hoisted(() => ({
  layoutAddNodes: vi.fn(),
  layoutReheat: vi.fn(),
  layoutSetClusters: vi.fn(),
  layoutSetLinks: vi.fn(),
  onLayoutSettled: vi.fn(),
}));

const dbState = vi.hoisted(() => ({
  docs: new Map<string, any>(),
  embeddings: new Map<string, any>(),
}));

const fakeDb = vi.hoisted(() => ({
  transaction: vi.fn(() => ({
    objectStore: (name: string) => ({
      get: async (id: string) => {
        if (name === 'documents') return dbState.docs.get(id);
        if (name === 'embeddings') return dbState.embeddings.get(id);
        return undefined;
      },
    }),
  })),
}));

vi.mock('./db', () => ({
  getDb: vi.fn(async () => fakeDb),
}));
vi.mock('./cache', () => ({
  ...cache,
  validDocVector: (vector: Float32Array | null | undefined) =>
    vector instanceof Float32Array && vector.length === EMBED_DIMS,
  validChunkVectors: (vectors: Float32Array | null | undefined, chunkCount: number) =>
    vectors instanceof Float32Array &&
    chunkCount > 0 &&
    vectors.length === chunkCount * EMBED_DIMS,
}));
vi.mock('./corpusRepository', () => repo);
vi.mock('./validateImport', () => ({
  sanitizeGraphExport: vi.fn((value) => value),
}));
vi.mock('./originals', () => ({
  deleteOriginals: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./chatHistorySync', () => ({
  flushPendingChatSave: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../layout/layoutBridge', () => layout);
vi.mock('../demo/manifest', () => ({
  fetchDemoManifest: vi.fn(),
}));
vi.mock('../pipeline/runQueue', () => ({
  enqueueRun: vi.fn((fn) => fn()),
}));

import type { GraphExport } from '../model/types';
import { hydrateFromRecord, restoreSession, saveCurrentSnapshot } from './session';
import { fetchDemoManifest } from '../demo/manifest';

function makeNode(id: string, title = id): any {
  return {
    id,
    kind: 'document',
    title,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 5,
    cluster: 1,
    degree: 0,
    status: 'ok',
    path: title,
  };
}

describe('session persistence', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    useCorpusStore.getState().reset();
    clearRuntimeStores(); // all runtime maps + dirty set + hydration bookkeeping
    dbState.docs.clear();
    dbState.embeddings.clear();
    vi.clearAllMocks();
  });

  it('hydrates a saved graph back into the runtime stores and layout', async () => {
    const node = makeNode('doc-1', 'Doc One');
    const exportData: GraphExport = {
      version: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      generator: 'knowledge-nebula',
      includeEmbeddings: true,
      nodes: [node],
      edges: [],
    };
    const chunkText = 'hello world';
    dbState.docs.set(node.id, {
      hash: node.id,
      node,
      text: chunkText,
      chunkTexts: [chunkText],
      mdLinkTargets: ['https://example.com'],
      docLinks: [{ text: 'Docs', url: 'https://example.com' }],
    });
    dbState.embeddings.set(node.id, {
      hash: node.id,
      fingerprint: EMBEDDING_FINGERPRINT,
      docVector: new Float32Array(EMBED_DIMS).fill(1),
      chunkVectors: new Float32Array(EMBED_DIMS).fill(1),
      nChunks: 1,
    });

    const restored = await hydrateFromRecord(exportData, { [node.id]: [1, 2, 3] }, 'corpus-hash');

    expect(restored).toBe(true);
    expect(useGraphStore.getState().nodes).toHaveLength(1);
    expect(useGraphStore.getState().phase).toBe('ready');
    expect(useGraphStore.getState().corpusHash).toBe('corpus-hash');
    expect(textStore.get(node.id)).toBe(chunkText);
    expect(chunkStore.get(node.id)?.texts).toEqual([chunkText]);
    expect(docVectorStore.get(node.id)).toEqual(new Float32Array(EMBED_DIMS).fill(1));
    expect(mdLinkTargetsStore.get(node.id)).toEqual(['https://example.com']);
    expect(docLinksStore.get(node.id)).toEqual([{ text: 'Docs', url: 'https://example.com' }]);
    expect(layout.layoutAddNodes).toHaveBeenCalledWith([
      { id: node.id, cluster: 1, initial: [1, 2, 3] },
    ]);
    expect(layout.layoutSetLinks).toHaveBeenCalledWith([]);
  });

  it('restores a saved demo workspace instead of deleting it on startup', async () => {
    const node = makeNode('demo-1', 'demo-file.md');
    const exportData: GraphExport = {
      version: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      generator: 'knowledge-nebula',
      includeEmbeddings: false,
      nodes: [node],
      edges: [],
    };
    repo.initializeCorpusRepository.mockResolvedValue('active-corpus');
    repo.getCorpusRecord.mockResolvedValue({
      id: 'active-corpus',
      name: 'Demo',
      createdAt: 1,
      updatedAt: 2,
      corpusHash: 'persisted-hash',
      docHashes: [node.id],
      exportData,
      positions: {},
    });
    vi.mocked(fetchDemoManifest).mockResolvedValue({
      ok: true,
      json: async () => ({ files: ['demo-file.md'] }),
    } as Response);
    const result = await restoreSession();

    expect(result).toBe(true);
    expect(useGraphStore.getState().nodes).toEqual([node]);
    expect(useGraphStore.getState().corpusHash).toBe('persisted-hash');
    expect(repo.markActiveCorpusEmpty).not.toHaveBeenCalled();
    expect(cache.deleteDocsFromCache).not.toHaveBeenCalled();
    expect(cache.deleteGraphFromCache).not.toHaveBeenCalled();
  });

  it('saveCurrentSnapshot rewrites only dirty documents, never evicted clean ones', async () => {
    const dirty = makeNode('doc-dirty');
    const clean = makeNode('doc-clean');
    useGraphStore.getState().addNodes([dirty, clean]);
    useGraphStore.getState().setPhase('ready');
    useGraphStore.getState().setCorpusHash('corpus-hash');
    // doc-clean's full text has been evicted: rewriting its record from
    // memory would clobber the persisted text with ''.
    textStore.set('doc-dirty', 'fresh dirty body');
    markDocsDirty(['doc-dirty']);

    const id = await saveCurrentSnapshot('milestone');

    expect(id).toBe(1);
    const saved = cache.saveDocsToCache.mock.calls.at(-1)?.[0] ?? [];
    expect(saved.map((d: { node: { id: string } }) => d.node.id)).toEqual(['doc-dirty']);
    expect([...dirtyDocIds]).toEqual([]); // committed ids leave the dirty set
  });

  it('does not create a snapshot when required document persistence fails', async () => {
    const node = makeNode('unsaved-doc');
    useGraphStore.getState().addNodes([node]);
    useGraphStore.getState().setPhase('ready');
    markDocsDirty([node.id]);
    textStore.set(node.id, 'only copy in memory');
    cache.saveDocsToCache.mockResolvedValueOnce(false);

    expect(await saveCurrentSnapshot('incomplete')).toBeUndefined();
    expect(cache.saveSnapshot).not.toHaveBeenCalled();
    expect(dirtyDocIds.has(node.id)).toBe(true);
  });

  it('does not clear a document edited again while snapshot persistence is in flight', async () => {
    const node = makeNode('edited-doc');
    useGraphStore.getState().addNodes([node]);
    useGraphStore.getState().setPhase('ready');
    markDocsDirty([node.id]);
    let complete!: (saved: boolean) => void;
    cache.saveDocsToCache.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { complete = resolve; }),
    );
    const saving = saveCurrentSnapshot('before edit');
    textStore.set(node.id, 'new content');
    markDocsDirty([node.id]);
    complete(true);

    expect(await saving).toBe(1);
    expect(dirtyDocIds.has(node.id)).toBe(true);
  });

  it('keeps a snapshot owned by its original corpus when the workspace switches during saving', async () => {
    const node = makeNode('corpus-A-doc');
    useGraphStore.getState().addNodes([node]);
    useGraphStore.getState().setPhase('ready');
    useCorpusStore.setState({ activeCorpusId: 'corpus-A' });
    markDocsDirty([node.id]);
    let complete!: (saved: boolean) => void;
    cache.saveDocsToCache.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { complete = resolve; }),
    );
    const saving = saveCurrentSnapshot('A snapshot');
    useCorpusStore.setState({ activeCorpusId: 'corpus-B' });
    complete(true);

    expect(await saving).toBe(1);
    expect(cache.saveSnapshot).toHaveBeenCalledWith(
      'A snapshot', 'unnamed', expect.objectContaining({ nodes: [node] }),
      expect.any(Object), [node.id], 'corpus-A',
    );
  });
});
