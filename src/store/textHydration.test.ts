import { beforeEach, describe, expect, it, vi } from 'vitest';

const health = vi.hoisted(() => ({ healthy: true, reported: [] as unknown[] }));
vi.mock('../persistence/cache', () => ({
  isPersistenceHealthy: () => health.healthy,
  reportPersistenceUnavailable: (err: unknown) => health.reported.push(err),
}));

const dbState = vi.hoisted(() => ({
  docs: new Map<string, { hash: string; text: string }>(),
  gets: 0,
  gate: null as Promise<void> | null,
  error: null as Error | null,
}));
vi.mock('../persistence/db', () => {
  const get = async (id: string) => {
    dbState.gets += 1;
    if (dbState.gate) await dbState.gate;
    if (dbState.error) throw dbState.error;
    return dbState.docs.get(id);
  };
  return {
    getDb: async () => ({
      get: (_store: string, id: string) => get(id),
      transaction: () => ({ objectStore: () => ({ get } as { get: typeof get }) }),
    }),
  };
});

import {
  clearRuntimeStores,
  markDocsDirty,
  textStore,
} from './runtimeStores';
import {
  evictDocTexts,
  forgetPersistedDocs,
  getDocText,
  getDocTexts,
  hasDocTextSync,
  markDocsPersisted,
} from './textHydration';
import { useUiStore } from './uiStore';

function record(id: string, text: string): { hash: string; text: string } {
  return { hash: id, text };
}

/** Seed a resident, persisted, clean doc and set its LRU position via a read. */
async function seedResident(id: string, text: string): Promise<void> {
  textStore.set(id, text);
  markDocsPersisted([id]);
  await getDocText(id); // LRU touch in call order
}

beforeEach(() => {
  clearRuntimeStores(); // also resets hydration bookkeeping via the clear hook
  dbState.docs.clear();
  dbState.gets = 0;
  dbState.gate = null;
  dbState.error = null;
  health.healthy = true;
  health.reported.length = 0;
  useUiStore.setState({ selectedId: null, compareLeftId: null, compareRightId: null });
});

describe('getDocText', () => {
  it('answers from the resident store without touching IndexedDB', async () => {
    textStore.set('a', 'warm body');
    await expect(getDocText('a')).resolves.toBe('warm body');
    expect(dbState.gets).toBe(0);
  });

  it('hydrates an evicted text from its DocumentRecord and caches it back', async () => {
    dbState.docs.set('a', record('a', 'persisted body'));
    await expect(getDocText('a')).resolves.toBe('persisted body');
    expect(textStore.get('a')).toBe('persisted body');
    expect(hasDocTextSync('a')).toBe(true);
  });

  it('resolves undefined on a confirmed miss', async () => {
    await expect(getDocText('missing')).resolves.toBeUndefined();
    expect(textStore.has('missing')).toBe(false);
  });

  it('throws when IndexedDB fails instead of looking like a miss', async () => {
    markDocsPersisted(['a']);
    dbState.error = new Error('quota exceeded');

    await expect(getDocText('a')).rejects.toThrow('quota exceeded');
    expect(health.reported).toHaveLength(1);
    expect(textStore.has('a')).toBe(false);
    expect(hasDocTextSync('a')).toBe(true); // still recoverable once persistence recovers
  });
});

describe('getDocTexts', () => {
  it('mixes resident and hydrated texts, skipping ids without a record', async () => {
    textStore.set('warm', 'warm text');
    dbState.docs.set('cold', record('cold', 'cold text'));

    const out = await getDocTexts(['warm', 'cold', 'absent']);

    expect(out.get('warm')).toBe('warm text');
    expect(out.get('cold')).toBe('cold text');
    expect(out.has('absent')).toBe(false);
    expect(textStore.get('cold')).toBe('cold text');
    expect(hasDocTextSync('cold')).toBe(true);
  });

  it('throws when IndexedDB fails instead of returning a partial map', async () => {
    textStore.set('warm', 'warm text');
    markDocsPersisted(['cold']);
    dbState.error = new Error('blocked');

    await expect(getDocTexts(['warm', 'cold'])).rejects.toThrow('blocked');
    expect(health.reported).toHaveLength(1);
    expect(textStore.has('cold')).toBe(false);
  });
});

describe('evictDocTexts', () => {
  it('evicts least-recently-used texts down to the budget', async () => {
    await seedResident('old', 'x'.repeat(10));
    await seedResident('mid', 'x'.repeat(10));
    await seedResident('new', 'x'.repeat(10));

    const evicted = evictDocTexts({ keepBytes: 25 });

    expect(evicted).toEqual(['old']);
    expect(textStore.has('old')).toBe(false);
    expect(textStore.has('mid')).toBe(true);
    expect(textStore.has('new')).toBe(true);
    expect(hasDocTextSync('old')).toBe(true); // still recoverable
  });

  it('is a no-op while under the budget', async () => {
    await seedResident('a', 'x'.repeat(10));
    expect(evictDocTexts({ keepBytes: 100 })).toEqual([]);
    expect(textStore.has('a')).toBe(true);
  });

  it('never evicts dirty docs', async () => {
    await seedResident('dirty', 'x'.repeat(10));
    await seedResident('clean', 'x'.repeat(10));
    markDocsDirty(['dirty']);

    const evicted = evictDocTexts({ keepBytes: 0 });

    expect(evicted).toEqual(['clean']);
    expect(textStore.has('dirty')).toBe(true);
  });

  it('never evicts while persistence is degraded', async () => {
    await seedResident('a', 'x'.repeat(10));
    health.healthy = false;

    expect(evictDocTexts({ keepBytes: 0 })).toEqual([]);
    expect(textStore.has('a')).toBe(true);
  });

  it('never evicts a doc without a confirmed persisted record', async () => {
    textStore.set('memory-only', 'x'.repeat(10)); // e.g. an imported graph

    expect(evictDocTexts({ keepBytes: 0 })).toEqual([]);
    expect(textStore.has('memory-only')).toBe(true);
  });

  it('keeps the documents currently on screen', async () => {
    await seedResident('open', 'x'.repeat(10));
    await seedResident('other', 'x'.repeat(10));
    useUiStore.setState({ selectedId: 'open' });

    const evicted = evictDocTexts({ keepBytes: 0 });

    expect(evicted).toEqual(['other']);
    expect(textStore.has('open')).toBe(true);
  });
});

describe('generation reset', () => {
  it('a stale hydration cannot repopulate a torn-down corpus', async () => {
    dbState.docs.set('a', record('a', 'stale body'));
    let release!: () => void;
    dbState.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = getDocText('a');
    clearRuntimeStores(); // corpus reset while the DB read is in flight
    release();

    await expect(pending).resolves.toBe('stale body'); // caller still served
    expect(textStore.has('a')).toBe(false); // ...but nothing repopulated
    expect(hasDocTextSync('a')).toBe(false);
  });

  it('clears persisted-id bookkeeping on teardown', () => {
    markDocsPersisted(['a']);
    expect(hasDocTextSync('a')).toBe(true);
    clearRuntimeStores();
    expect(hasDocTextSync('a')).toBe(false);
  });

  it('a stale hydration cannot revive a removed document', async () => {
    dbState.docs.set('a', record('a', 'removed body'));
    markDocsPersisted(['a']);
    let release!: () => void;
    dbState.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = getDocText('a');
    forgetPersistedDocs(['a']);
    textStore.delete('a');
    release();

    await expect(pending).resolves.toBe('removed body'); // caller still served
    expect(textStore.has('a')).toBe(false);
    expect(hasDocTextSync('a')).toBe(false);
  });
});
