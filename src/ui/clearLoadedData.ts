import { clearAllCaches } from '../persistence/cache';
import { resetCorpus } from '../pipeline/coordinator';
import { useCorpusStore } from '../store/corpusStore';

/** Clear the live graph and corpus catalog that otherwise survive the IndexedDB wipe. */
export function resetClearedDataState(): void {
  resetCorpus();
  useCorpusStore.getState().reset();
}

/**
 * Full start-over: empties the live graph immediately, then wipes every locally
 * cached document, embedding, graph, and snapshot. API keys and other settings
 * live in localStorage and are kept. Returns whether the cache wipe succeeded.
 */
export async function clearLoadedData(): Promise<boolean> {
  resetClearedDataState();
  return clearAllCaches();
}
