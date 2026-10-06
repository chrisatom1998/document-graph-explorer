import { describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock('./db', () => ({ getDb: getDbMock }));

import { clearAllCaches } from './cache';

describe('clearAllCaches', () => {
  it('clears every persistent store, including chats, the corpus registry and the library index', async () => {
    const clears = new Map<string, ReturnType<typeof vi.fn>>();
    const objectStore = vi.fn((name: string) => {
      const clear = vi.fn().mockResolvedValue(undefined);
      clears.set(name, clear);
      return { clear };
    });
    const transaction = vi.fn(() => ({ objectStore, done: Promise.resolve() }));
    getDbMock.mockResolvedValue({ transaction });

    await expect(clearAllCaches()).resolves.toBe(true);
    expect(transaction).toHaveBeenCalledWith(
      [
        'documents',
        'embeddings',
        'graphs',
        'settings',
        'snapshots',
        'originals',
        'chats',
        'corpora',
        'library',
      ],
      'readwrite',
    );
    expect([...clears.keys()]).toEqual([
      'documents',
      'embeddings',
      'graphs',
      'settings',
      'snapshots',
      'originals',
      'chats',
      'corpora',
      'library',
    ]);
    for (const clear of clears.values()) expect(clear).toHaveBeenCalledOnce();
  });
});
