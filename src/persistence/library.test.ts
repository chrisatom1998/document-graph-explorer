import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Minimal in-memory stand-in for the idb stores library.ts touches. */
const fake = vi.hoisted(() => {
  const stores = new Map<string, Map<string, unknown>>();
  const keyPaths: Record<string, string | undefined> = { library: 'key', documents: 'hash', originals: 'hash' };
  const store = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const data = stores.get(name)!;
    return {
      get: async (key: string) => data.get(key),
      getKey: async (key: string) => (data.has(key) ? key : undefined),
      put: async (value: unknown, key?: string) => {
        data.set(key ?? String((value as Record<string, unknown>)[keyPaths[name]!]), value);
      },
      delete: async (key: string) => void data.delete(key),
      clear: async () => data.clear(),
      count: async () => data.size,
      getAll: async () => [...data.values()],
      getAllKeys: async () => [...data.keys()],
    };
  };
  const db = {
    transaction: (names: string | string[]) => ({
      objectStore: store,
      store: store(Array.isArray(names) ? names[0] : names),
      done: Promise.resolve(),
    }),
    getKey: (name: string, key: string) => store(name).getKey(key),
  };
  return { stores, store, db, fail: false };
});

vi.mock('./db', () => ({
  getDb: async () => {
    if (fake.fail) throw new Error('blocked');
    return fake.db;
  },
}));

import {
  clearLibrary,
  hasDocumentRecord,
  libraryKey,
  libraryStats,
  lookupLibraryFiles,
  rememberLibraryFiles,
} from './library';

const file = { path: 'Crate/kick.wav', size: 1200, lastModified: 1_700_000_000_000 };

beforeEach(() => {
  fake.stores.clear();
  fake.fail = false;
});

describe('remembered library', () => {
  it('finds a remembered file only while its document and original are stored', async () => {
    await rememberLibraryFiles([{ ...file, docId: 'doc-1', fileType: 'audio' }]);
    expect((await lookupLibraryFiles([file])).size).toBe(0);

    await fake.store('documents').put({ hash: 'doc-1' });
    expect((await lookupLibraryFiles([file])).size).toBe(0);

    await fake.store('originals').put({ hash: 'doc-1' });
    expect(await lookupLibraryFiles([file])).toEqual(
      new Map([[libraryKey(file), { docId: 'doc-1', fileType: 'audio' }]]),
    );
    expect(await hasDocumentRecord('doc-1')).toBe(true);
    expect(await hasDocumentRecord('doc-2')).toBe(false);
  });

  it('misses when the size or modified time differs', async () => {
    await rememberLibraryFiles([{ ...file, docId: 'doc-1', fileType: 'audio' }]);
    await fake.store('documents').put({ hash: 'doc-1' });
    await fake.store('originals').put({ hash: 'doc-1' });
    expect((await lookupLibraryFiles([{ ...file, size: 1201 }])).size).toBe(0);
    expect((await lookupLibraryFiles([{ ...file, lastModified: file.lastModified + 1 }])).size).toBe(0);
  });

  it('counts remembered files and saved analyses, and forgets both without touching other settings', async () => {
    await rememberLibraryFiles([
      { ...file, docId: 'doc-1', fileType: 'audio' },
      { ...file, path: 'Crate/snare.wav', docId: 'doc-2', fileType: 'audio' },
    ]);
    const settings = fake.store('settings');
    await settings.put({ audio: {} }, 'music-analysis:v2:a');
    await settings.put({ value: {} }, 'audio-inference:v2:b');
    await settings.put('abc', 'lastCorpusHash');
    expect(await libraryStats()).toEqual({ files: 2, analyses: 1 });

    expect(await clearLibrary()).toBe(true);
    expect(await libraryStats()).toEqual({ files: 0, analyses: 0 });
    expect(await settings.getAllKeys()).toEqual(['lastCorpusHash']);
  });

  it('degrades to no hits and no stats when storage is unavailable', async () => {
    fake.fail = true;
    expect((await lookupLibraryFiles([file])).size).toBe(0);
    await expect(rememberLibraryFiles([{ ...file, docId: 'doc-1', fileType: 'audio' }])).resolves.toBeUndefined();
    expect(await libraryStats()).toBeNull();
    expect(await clearLibrary()).toBe(false);
  });
});
