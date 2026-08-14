import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCorpusStore } from '../store/corpusStore';

const cache = vi.hoisted(() => ({
  getSetting: vi.fn(),
  lookupGraphCache: vi.fn(),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

const dbState = vi.hoisted(() => ({
  corpora: new Map<string, any>(),
  snapshots: new Map<number, any>(),
}));

const fakeDb = vi.hoisted(() => ({
  getAll: vi.fn(async (store: string) => {
    if (store === 'corpora') return [...dbState.corpora.values()];
    if (store === 'snapshots') return [...dbState.snapshots.values()];
    return [];
  }),
  get: vi.fn(async (store: string, key: string | number) => {
    if (store === 'corpora') return dbState.corpora.get(String(key));
    if (store === 'snapshots') return dbState.snapshots.get(Number(key));
    return undefined;
  }),
  put: vi.fn(async (store: string, value: any, key?: string | number) => {
    if (store === 'corpora') {
      const id = key ?? value.id;
      dbState.corpora.set(String(id), value);
      return value;
    }
    if (store === 'snapshots') {
      const snapshotId = Number(key ?? value.id ?? 0);
      dbState.snapshots.set(snapshotId, value);
      return snapshotId;
    }
    return undefined;
  }),
  delete: vi.fn(async (store: string, key: string | number) => {
    if (store === 'corpora') dbState.corpora.delete(String(key));
    if (store === 'snapshots') dbState.snapshots.delete(Number(key));
  }),
  transaction: vi.fn((storeName: string | string[], _mode: string) => {
    const stores = Array.isArray(storeName) ? storeName : [storeName];
    if (stores.length === 0) {
      return { objectStore: () => ({ get: async () => undefined, put: async () => undefined, delete: async () => undefined, getAll: async () => [] }), done: Promise.resolve() };
    }
    const getStore = (name: string) => ({
      get: async (id: string | number) => {
        if (name === 'corpora') return dbState.corpora.get(String(id));
        if (name === 'snapshots') return dbState.snapshots.get(Number(id));
        return undefined;
      },
      put: async (value: any) => {
        if (name === 'corpora') {
          dbState.corpora.set(String(value.id), value);
        }
        if (name === 'snapshots') {
          const id = value.id ?? Number([...dbState.snapshots.keys()].at(-1) ?? -1) + 1;
          value.id = id;
          dbState.snapshots.set(id, value);
        }
      },
      delete: async (id: string | number) => {
        if (name === 'corpora') {
          dbState.corpora.delete(String(id));
        }
        if (name === 'snapshots') {
          dbState.snapshots.delete(Number(id));
        }
      },
      getAll: async () => {
        if (name === 'corpora') return [...dbState.corpora.values()];
        if (name === 'snapshots') return [...dbState.snapshots.values()];
        return [];
      },
    });
    return {
      objectStore: (name: string) => getStore(name),
      done: Promise.resolve(),
    };
  }),
}));

vi.mock('./cache', () => cache);
vi.mock('./db', () => ({
  getDb: vi.fn(async () => fakeDb),
}));

import {
  markActiveCorpusEmpty,
  unreferencedDocumentIds,
  updateCorpusAnnotations,
} from './corpusRepository';

describe('corpusRepository data mutations', () => {
  beforeEach(() => {
    useCorpusStore.getState().reset();
    dbState.corpora.clear();
    dbState.snapshots.clear();
    cache.getSetting.mockReset();
    cache.lookupGraphCache.mockReset();
    cache.setSetting.mockClear();
  });

  it('merges annotation patches without clobbering unrelated keys', async () => {
    dbState.corpora.set('corpus-1', {
      id: 'corpus-1',
      name: 'Alpha',
      createdAt: 1,
      updatedAt: 2,
      corpusHash: 'hash',
      docHashes: ['doc-a'],
      exportData: null,
      positions: {},
      annotations: {
        'doc-a': { note: 'keep me', tags: ['keep'], pinned: false, updatedAt: 10 },
        'doc-b': { note: 'do not remove', tags: ['stay'], pinned: true, updatedAt: 11 },
      },
    });
    useCorpusStore.getState().setLocalState([{
      id: 'corpus-1',
      name: 'Alpha',
      updatedAt: 2,
      documentCount: 1,
      watching: false,
    }], 'corpus-1');

    await updateCorpusAnnotations('corpus-1', {
      'doc-a': null,
      'doc-c': { note: 'new note', tags: ['new'], pinned: false, updatedAt: 12 },
    });

    expect(dbState.corpora.get('corpus-1').annotations).toEqual({
      'doc-b': { note: 'do not remove', tags: ['stay'], pinned: true, updatedAt: 11 },
      'doc-c': { note: 'new note', tags: ['new'], pinned: false, updatedAt: 12 },
    });
  });

  it('clears the active corpus snapshot without deleting the workspace itself', async () => {
    dbState.corpora.set('corpus-1', {
      id: 'corpus-1',
      name: 'Alpha',
      createdAt: 1,
      updatedAt: 2,
      corpusHash: 'old-hash',
      docHashes: ['doc-a'],
      exportData: {
        version: 1 as const,
        createdAt: '2024-01-01',
        generator: 'knowledge-nebula',
        includeEmbeddings: false,
        nodes: [],
        edges: [],
      },
      positions: { a: [1, 2, 3] },
    });
    useCorpusStore.getState().setLocalState([{
      id: 'corpus-1',
      name: 'Alpha',
      updatedAt: 2,
      documentCount: 1,
      watching: false,
    }], 'corpus-1');

    await markActiveCorpusEmpty();

    const record = dbState.corpora.get('corpus-1');
    expect(record.corpusHash).toBeNull();
    expect(record.docHashes).toEqual([]);
    expect(record.exportData).toBeNull();
    expect(record.positions).toEqual({});
    expect(cache.setSetting).toHaveBeenCalledWith('lastCorpusHash', '');
  });

  it('removes only document ids that are no longer referenced by any saved corpus or snapshot', async () => {
    dbState.corpora.set('corpus-1', {
      id: 'corpus-1',
      name: 'Alpha',
      createdAt: 1,
      updatedAt: 2,
      corpusHash: 'hash',
      docHashes: ['doc-a', 'doc-b'],
      exportData: null,
      positions: {},
    });
    dbState.corpora.set('corpus-2', {
      id: 'corpus-2',
      name: 'Beta',
      createdAt: 1,
      updatedAt: 2,
      corpusHash: 'hash-2',
      docHashes: ['doc-c'],
      exportData: null,
      positions: {},
    });
    dbState.snapshots.set(10, {
      id: 10,
      name: 'snapshot',
      savedAt: 123,
      corpusHash: 'snapshot-hash',
      docHashes: ['doc-d', 'doc-b'],
      exportData: {
        version: 1 as const,
        createdAt: '2024-01-01',
        generator: 'knowledge-nebula',
        includeEmbeddings: false,
        nodes: [],
        edges: [],
      },
      positions: {},
    });

    await expect(unreferencedDocumentIds(['doc-a', 'doc-b', 'doc-c', 'doc-d', 'doc-e'])).resolves.toEqual(['doc-e']);
  });
});
