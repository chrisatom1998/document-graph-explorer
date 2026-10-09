import { useGraphStore } from '../store/graphStore';
import { useMusicJobs } from '../store/musicJobs';
import { useUiStore } from '../store/uiStore';

/**
 * Every deploy renames the hashed script chunks, so a tab opened before it
 * fails the next lazy import ("Failed to fetch dynamically imported module").
 * The page reloads once to pick up the new build; a second failure within a
 * minute is a real network problem, so it gets a plain message instead of
 * another reload. A reload never interrupts an import or an analysis.
 */
const RELOAD_KEY = 'dge-stale-build-reload';
const RELOAD_WINDOW_MS = 60_000;

export const STALE_BUILD_MESSAGE = 'Resonance was updated. Reload the page to continue.';
export const CHUNK_NETWORK_MESSAGE = 'Part of the app could not be downloaded. Check your connection and try again.';

/** Messages Chromium, Firefox and Safari use when a dynamic import or its preload fails. */
const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return CHUNK_ERROR.test(message);
}

let held = 0;

/**
 * Block the automatic reload while the caller holds files the user picked
 * (before the import pipeline has them), so a failed chunk shows a message
 * instead of discarding the selection. Call the returned function when done.
 */
export function holdReload(): () => void {
  held += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held -= 1;
  };
}

function busy(): boolean {
  const phase = useGraphStore.getState().phase;
  return held > 0 || (phase !== 'idle' && phase !== 'ready') || Object.keys(useMusicJobs.getState().jobs).length > 0;
}

function recentlyReloaded(now: number): boolean {
  try {
    const at = Number(sessionStorage.getItem(RELOAD_KEY));
    return Number.isFinite(at) && now - at < RELOAD_WINDOW_MS;
  } catch {
    return true; // No storage: never risk a reload loop.
  }
}

let lastHandledAt = 0;

/**
 * Handle a failed chunk load. Returns true when the error was a chunk failure
 * and has been dealt with (reload started or message shown), so the caller can
 * skip its generic error toast.
 */
export function recoverFromChunkError(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false;
  const now = Date.now();
  // One failure surfaces twice (the preload event, then the caller's catch).
  if (now - lastHandledAt < 2_000) return true;
  lastHandledAt = now;
  if (!busy() && !recentlyReloaded(now)) {
    let marked = false;
    try {
      sessionStorage.setItem(RELOAD_KEY, String(now));
      marked = sessionStorage.getItem(RELOAD_KEY) === String(now);
    } catch { /* storage unavailable */ }
    // Without the marker the next failure could reload again, so only reload
    // when the guard is actually stored.
    if (marked) {
      window.location.reload();
      return true;
    }
  }
  useUiStore.getState().pushToast(recentlyReloaded(now) ? CHUNK_NETWORK_MESSAGE : STALE_BUILD_MESSAGE, 'warning');
  return true;
}

/** Vite raises `vite:preloadError` for failed lazy chunks and their CSS. */
export function installStaleBuildRecovery(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', (event) => {
    recoverFromChunkError((event as Event & { payload?: unknown }).payload);
  });
}
