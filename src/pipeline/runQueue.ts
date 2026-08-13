/**
 * FIFO run-queue: serializes ingest/mutation operations (ingest, removal,
 * import, snapshot restore) against each other so two can never interleave
 * and corrupt shared state (graph store, runtime stores, layout, IndexedDB).
 *
 * Kept dependency-free (no store/worker/DOM imports) so it can be unit
 * tested directly without dragging in pipeline/coordinator.ts's heavier
 * transitive graph (which needs DOM globals via pdfjs-dist).
 */

let tail: Promise<unknown> = Promise.resolve();

/**
 * Queues `fn` behind whatever is already queued: it starts only after every
 * previously-enqueued run has settled (resolved OR rejected), then runs, and
 * lets the next queued item start the moment it settles. One run's failure
 * never wedges the queue for the next.
 *
 * An `options.signal` aborted before the run's turn arrives skips `fn`
 * entirely and rejects with the abort reason (mid-run cancellation is the
 * run's own job — it closes over the same signal). AbortSignal/DOMException
 * are platform globals, so this stays dependency-free.
 */
export function enqueueRun<T>(
  fn: () => Promise<T>,
  options?: { signal?: AbortSignal },
): Promise<T> {
  const signal = options?.signal;
  const start = (): Promise<T> =>
    signal?.aborted
      ? Promise.reject(
          (signal.reason as Error | undefined) ??
            new DOMException('The operation was aborted.', 'AbortError'),
        )
      : fn();
  const run = tail.then(start, start);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
