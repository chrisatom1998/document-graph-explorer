import { beforeEach, describe, expect, it, vi } from 'vitest';

const coordinator = vi.hoisted(() => ({ resetCorpus: vi.fn() }));
const cache = vi.hoisted(() => ({ clearAllCaches: vi.fn(async () => true) }));
vi.mock('../pipeline/coordinator', () => coordinator);
vi.mock('../persistence/cache', () => cache);

import { useCorpusStore } from '../store/corpusStore';
import { clearLoadedData } from './clearLoadedData';

describe('clearLoadedData', () => {
  beforeEach(() => {
    coordinator.resetCorpus.mockClear();
    cache.clearAllCaches.mockReset();
    cache.clearAllCaches.mockResolvedValue(true);
    useCorpusStore.setState({
      initialized: true,
      switching: false,
      activeCorpusId: 'ghost',
      activeName: 'Ghost workspace',
      mode: 'local',
      corpora: [
        {
          id: 'ghost',
          name: 'Ghost workspace',
          updatedAt: 1,
          documentCount: 4,
          watching: false,
        },
      ],
    });
  });

  it('resets the live graph and corpus catalog, then wipes cached data', async () => {
    await expect(clearLoadedData()).resolves.toBe(true);

    expect(coordinator.resetCorpus).toHaveBeenCalledOnce();
    expect(cache.clearAllCaches).toHaveBeenCalledOnce();
    expect(useCorpusStore.getState()).toMatchObject({
      initialized: false,
      activeCorpusId: null,
      activeName: 'My corpus',
      corpora: [],
    });
  });

  it('keeps the graph cleared when the cache wipe fails', async () => {
    cache.clearAllCaches.mockResolvedValueOnce(false);

    await expect(clearLoadedData()).resolves.toBe(false);
    expect(coordinator.resetCorpus).toHaveBeenCalledOnce();
    expect(useCorpusStore.getState().corpora).toEqual([]);
  });
});
