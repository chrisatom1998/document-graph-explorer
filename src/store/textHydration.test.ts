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
}));
vi.mock('../persistence/db', () => {
  const get = async (id: string) => {
    dbState.gets += 1;
    if (dbState.gate) await dbState.gate;
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
  chunkStore,
  clearRuntimeStores,
  markDocsDirty,
  textStore,
} from './runtimeStores';
import {
  docTextForCompute,
  evictDocTexts,
  getDocText,
  getDocTexts,
  hasDocTextSync,
  markDocsPersisted,
} from './textHydration';
import { useGraphStore } from './graphStore';
import { useUiStore } from './uiStore';

function record(id: string, text: string): { hash: string; text: string } {
  return { hash: id, text };
}

/**
 * Put ids in the corpus. Hydration only writes a fetched body back for docs
 * the graph still holds, so a doc removed mid-fetch cannot be resurrected.
 */
function joinCorpus(...ids: string[]): void {
  useGraphStore.setState({
    nodes: ids.map((id) => ({ id, kind: 'document' })) as never,
    nodeIndex: Object.fromEntries(ids.map((id, index) => [id, index])),
  });
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
    joinCorpus('a');
    dbState.docs.set('a', record('a', 'persisted body'));
    await expect(getDocText('a')).resolves.toBe('persisted body');
    expect(textStore.get('a')).toBe('persisted body');
    expect(hasDocTextSync('a')).toBe(true);
  });

  it('resolves undefined on a confirmed miss', async () => {
    await expect(getDocText('missing')).resolves.toBeUndefined();
    expect(textStore.has('missing')).toBe(false);
  });
});

describe('getDocTexts', () => {
  it('mixes resident and hydrated texts, skipping ids without a record', async () => {
    joinCorpus('warm', 'cold', 'absent');
    textStore.set('warm', 'warm text');
    dbState.docs.set('cold', record('cold', 'cold text'));

    const out = await getDocTexts(['warm', 'cold', 'absent']);

    expect(out.get('warm')).toBe('warm text');
    expect(out.get('cold')).toBe('cold text');
    expect(out.has('absent')).toBe(false);
    expect(textStore.get('cold')).toBe('cold text');
    expect(hasDocTextSync('cold')).toBe(true);
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
    joinCorpus('a');
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

  it('a hydration that lands after its doc was removed does not resurrect it', async () => {
    joinCorpus('a', 'b');
    dbState.docs.set('a', record('a', 'removed body'));
    let release!: () => void;
    dbState.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = getDocText('a');
    joinCorpus('b'); // 'a' removed from the corpus while the read is in flight
    release();

    await expect(pending).resolves.toBe('removed body'); // caller still served
    expect(textStore.has('a')).toBe(false); // ...but the corpus stays clean
    expect(hasDocTextSync('a')).toBe(false);
  });
});

describe('docTextForCompute', () => {
  it('prefers the resident full text', () => {
    textStore.set('a', 'full body');
    chunkStore.set('a', { texts: ['chunk one'], vectors: null, dims: 384 });
    expect(docTextForCompute('a')).toBe('full body');
  });

  it('falls back to chunk texts when the body is evicted and unrecoverable', () => {
    // A blank here would recompute edges/keywords — and wipe embeddings on a
    // rebuild — as though the document had no content at all.
    chunkStore.set('a', { texts: ['chunk one', 'chunk two'], vectors: null, dims: 384 });
    expect(docTextForCompute('a')).toBe('chunk one\n\nchunk two');
  });

  it('returns empty only for a genuinely textless doc', () => {
    expect(docTextForCompute('nothing')).toBe('');
  });
});
