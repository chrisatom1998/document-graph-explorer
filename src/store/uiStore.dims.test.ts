// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DIMS_KEY = 'knowledge-nebula-dims';

/** Fresh module instance so the load-on-create path runs against this storage. */
async function loadStore() {
  vi.resetModules();
  const mod = await import('./uiStore');
  return mod.useUiStore;
}

describe('uiStore dims persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    // The private-mode test spies on Storage.prototype; without restoreMocks
    // in the vitest config the throwing impl would leak into later tests.
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('defaults to 3D when nothing is stored', async () => {
    const useUiStore = await loadStore();
    expect(useUiStore.getState().dims).toBe(3);
  });

  it('restores a stored 2D choice', async () => {
    localStorage.setItem(DIMS_KEY, '2');
    const useUiStore = await loadStore();
    expect(useUiStore.getState().dims).toBe(2);
  });

  it('falls back to 3D on a garbage value', async () => {
    localStorage.setItem(DIMS_KEY, 'flat-ish');
    const useUiStore = await loadStore();
    expect(useUiStore.getState().dims).toBe(3);
  });

  it('writes through on every dims change, whatever triggered it', async () => {
    const useUiStore = await loadStore();

    useUiStore.getState().setDims(2);
    expect(localStorage.getItem(DIMS_KEY)).toBe('2');

    useUiStore.getState().setDims(3);
    expect(localStorage.getItem(DIMS_KEY)).toBe('3');
  });

  it('leaves storage alone when an unrelated slice changes', async () => {
    const useUiStore = await loadStore();
    useUiStore.getState().setHovered('doc-1');
    expect(localStorage.getItem(DIMS_KEY)).toBeNull();
  });

  it('survives storage that throws (private mode)', async () => {
    const useUiStore = await loadStore();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => useUiStore.getState().setDims(2)).not.toThrow();
    expect(useUiStore.getState().dims).toBe(2);
  });
});
