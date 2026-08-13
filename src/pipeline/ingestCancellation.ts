/**
 * Ingest cancellation registry — the ingest-side sibling of
 * chat/chatCancellation.ts, generalized to a set because overlapping drops
 * queue behind each other: "Cancel" means stop ingesting, so it aborts the
 * running run AND every run still queued behind it.
 *
 * Kept dependency-free (no store/worker/coordinator imports) so the
 * ProgressStrip — and its jsdom test — can import it without dragging in
 * pipeline/coordinator.ts's heavier transitive graph (which needs DOM
 * globals via pdfjs-dist).
 */

const controllers = new Set<AbortController>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function registerIngestAbort(controller: AbortController): void {
  controllers.add(controller);
  notify();
}

export function clearIngestAbort(controller: AbortController): void {
  if (controllers.delete(controller)) notify();
}

/** Abort the running ingest and any queued behind it. Safe to call when idle. */
export function cancelIngest(): void {
  for (const controller of [...controllers]) controller.abort();
}

/** True while any cancellable ingest run is live (running or queued). */
export function hasCancellableIngest(): boolean {
  return controllers.size > 0;
}

/** Change subscription for useSyncExternalStore; returns the unsubscriber. */
export function subscribeIngestCancellation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
