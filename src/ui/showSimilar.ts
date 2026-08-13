/**
 * Frame the documents most similar to a seed node using the existing
 * “Show all in graph” highlight (golden pulse + camera frameSet).
 */

import { similarDocuments } from '../search/similarDocuments';
import { useUiStore } from '../store/uiStore';

/**
 * Returns how many neighbors were framed (not counting the seed). Zero means
 * nothing similar enough was in the corpus — callers can toast.
 */
export function showSimilarTo(seedId: string): number {
  const hits = similarDocuments(seedId);
  if (hits.length === 0) return 0;
  const ids = [seedId, ...hits.map((hit) => hit.id)];
  const ui = useUiStore.getState();
  ui.setSearchResults(ids, 'showMe');
  ui.sendCamera('frameSet', ids);
  return hits.length;
}
