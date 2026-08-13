import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelIngest,
  clearIngestAbort,
  hasCancellableIngest,
  registerIngestAbort,
  subscribeIngestCancellation,
} from './ingestCancellation';

describe('ingestCancellation', () => {
  const live: AbortController[] = [];
  const track = (c: AbortController): AbortController => {
    live.push(c);
    return c;
  };

  afterEach(() => {
    // the registry is module-level state — leave it empty for the next test
    for (const c of live.splice(0)) clearIngestAbort(c);
  });

  it('cancelIngest aborts every live run — the running one and those queued behind it', () => {
    const running = track(new AbortController());
    const queued = track(new AbortController());
    registerIngestAbort(running);
    registerIngestAbort(queued);

    cancelIngest();

    expect(running.signal.aborted).toBe(true);
    expect(queued.signal.aborted).toBe(true);
  });

  it('is safe to call when idle and reports cancellability transitions to subscribers', () => {
    expect(hasCancellableIngest()).toBe(false);
    expect(() => cancelIngest()).not.toThrow();

    const listener = vi.fn();
    const unsubscribe = subscribeIngestCancellation(listener);
    const controller = track(new AbortController());

    registerIngestAbort(controller);
    expect(hasCancellableIngest()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    clearIngestAbort(controller);
    expect(hasCancellableIngest()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    // clearing an unknown controller is a no-op, not a spurious notification
    clearIngestAbort(controller);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
