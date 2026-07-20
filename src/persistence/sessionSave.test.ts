import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';

const cache = vi.hoisted(() => ({
  saveDocsToCache: vi.fn().mockResolvedValue(true),
  saveGraphToCache: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  reportPersistenceUnavailable: vi.fn(),
}));
vi.mock('./cache', () => cache);
vi.mock('./corpusRepository', () => ({
  saveActiveCorpusSnapshot: vi.fn().mockResolvedValue(undefined),
  saveActiveCorpusPositions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../scene/positionBuffer', () => ({
  positionBuffer: { array: new Float32Array(0), count: 0 },
  getNodePosition: vi.fn(() => [0, 0, 0] as [number, number, number]),
}));
vi.mock('./graphExport', () => ({ toGraphExport: vi.fn(() => ({ nodes: [], edges: [] })) }));

import { saveSession } from './sessionSave';
import { useGraphStore } from '../store/graphStore';
import { dirtyDocIds, markDocsDirty, textStore } from '../store/runtimeStores';

function mkNode(id: string): DocNode {
  return {
    id,
    kind: 'document',
    title: id,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
  };
}

function savedIds(): string[] {
  const docs = cache.saveDocsToCache.mock.calls.at(-1)?.[0] ?? [];
  return docs.map((d: { node: DocNode }) => d.node.id);
}

beforeEach(() => {
  useGraphStore.getState().reset();
  useGraphStore.getState().addNodes([mkNode('a'), mkNode('b'), mkNode('c')]);
  useGraphStore.getState().setPhase('ready');
  useGraphStore.getState().setCorpusHash('corpus-hash');
  for (const id of ['a', 'b', 'c']) textStore.set(id, `text of ${id}`);
  dirtyDocIds.clear();
});

afterEach(() => {
  dirtyDocIds.clear();
  textStore.clear();
  useGraphStore.getState().reset();
  vi.clearAllMocks();
});

describe('saveSession document writes', () => {
  it('persists only the documents that changed', async () => {
    markDocsDirty(['a', 'c']);

    await saveSession();

    expect(savedIds().sort()).toEqual(['a', 'c']);
  });

  it('clears the dirty set once the write commits', async () => {
    markDocsDirty(['a']);

    await saveSession();

    expect([...dirtyDocIds]).toEqual([]);
  });

  it('keeps documents queued when the cache write fails', async () => {
    cache.saveDocsToCache.mockResolvedValueOnce(false); // quota / private mode
    markDocsDirty(['a', 'b']);

    await saveSession();

    // Dropping these would lose the documents entirely; the next save retries.
    expect([...dirtyDocIds].sort()).toEqual(['a', 'b']);
  });

  it('writes no documents when nothing changed, but still saves the graph', async () => {
    await saveSession();

    expect(savedIds()).toEqual([]);
    expect(cache.saveGraphToCache).toHaveBeenCalledTimes(1);
  });

  it('ignores dirty ids whose document has since been removed', async () => {
    markDocsDirty(['a', 'gone']);

    await saveSession();

    expect(savedIds()).toEqual(['a']);
  });
});
