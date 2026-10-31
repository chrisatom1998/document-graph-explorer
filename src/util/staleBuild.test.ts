// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../store/graphStore';
import { useMusicJobs } from '../store/musicJobs';
import { useUiStore } from '../store/uiStore';
import { CHUNK_NETWORK_MESSAGE, STALE_BUILD_MESSAGE, holdReload, recoverFromChunkError } from './staleBuild';

const chunkError = new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/coordinatorLazy-old.js');

describe('stale build recovery', () => {
  let reload: ReturnType<typeof vi.fn>;
  let clock = 1_000_000;
  beforeEach(() => {
    // Each test starts well clear of the previous one's duplicate-failure window.
    clock += 10 * 60_000;
    vi.useFakeTimers({ now: clock });
    sessionStorage.clear();
    reload = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
    useGraphStore.setState({ phase: 'ready' });
    useMusicJobs.setState({ jobs: {} });
    useUiStore.setState({ toasts: [] } as never);
  });
  afterEach(() => vi.useRealTimers());

  const toasts = () => (useUiStore.getState() as unknown as { toasts: { message: string }[] }).toasts.map(t => t.message);

  it('ignores errors that are not chunk failures', () => {
    expect(recoverFromChunkError(new Error('Disk full'))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once on a chunk failure while idle, and counts the same failure only once', () => {
    expect(recoverFromChunkError(chunkError)).toBe(true);
    expect(recoverFromChunkError(chunkError)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows a network message instead of reloading again within a minute', () => {
    sessionStorage.setItem('dge-stale-build-reload', String(Date.now() - 10_000));
    expect(recoverFromChunkError(chunkError)).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(toasts()).toContain(CHUNK_NETWORK_MESSAGE);
  });

  it('never reloads during an import or analysis', () => {
    useMusicJobs.setState({ jobs: { clip: 'Analyzing' } });
    expect(recoverFromChunkError(chunkError)).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(toasts()).toContain(STALE_BUILD_MESSAGE);
  });

  it('keeps a picked selection: no reload while files are being handed to the import', () => {
    const release = holdReload();
    expect(recoverFromChunkError(chunkError)).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(toasts()).toContain(STALE_BUILD_MESSAGE);
    release();
  });

  it('does not reload when the reload guard cannot be stored', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(recoverFromChunkError(chunkError)).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
