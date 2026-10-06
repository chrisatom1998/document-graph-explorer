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

const AUDIO_USED_KEY = 'dge-audio-analysis-used';

/** Audio has been analysed in this browser before, so the app-open warmup is likely to pay off. */
export function rememberAudioAnalysisUsed(): void {
  try { localStorage.setItem(AUDIO_USED_KEY, '1'); } catch { /* storage unavailable: no warmup next time */ }
}

export function audioAnalysisUsedBefore(): boolean {
  try { return localStorage.getItem(AUDIO_USED_KEY) === '1'; } catch { return false; }
}
