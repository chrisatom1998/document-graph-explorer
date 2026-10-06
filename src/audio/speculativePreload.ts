/**
 * Stop hook for the app-open audio warmup (App.tsx). Kept dependency-free so the
 * coordinator can call it on every ingest without loading the analyzeMusic chunk:
 * the hook is only set while analyzeMusic is running a warmup nobody asked for.
 */
let stop: (() => void) | null = null;

export function setSpeculativePreloadStop(next: (() => void) | null): void {
  stop = next;
}

/** A document-only ingest is starting: free the CPU, memory and bandwidth the warmup holds. */
export function stopSpeculativeAudioPreload(): void {
  const current = stop;
  stop = null;
  current?.();
}
