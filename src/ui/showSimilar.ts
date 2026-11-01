/**
 * Frame the documents most similar to a seed node using the existing
 * “Show all in graph” highlight (golden pulse + camera frameSet).
 */

import { soundsLike } from '../audio/musicLinks';
import { similarDocuments } from '../search/similarDocuments';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

function frame(seedId: string, hitIds: string[]): void {
  const ids = [seedId, ...hitIds];
  const ui = useUiStore.getState();
  ui.setSearchResults(ids, 'showMe');
  ui.sendCamera('frameSet', ids);
}

/**
 * Returns how many neighbors were framed (not counting the seed). Zero means
 * nothing similar enough was in the corpus — callers can toast.
 */
export function showSimilarTo(seedId: string): number {
  const hits = similarDocuments(seedId);
  if (hits.length === 0) return 0;
  frame(seedId, hits.map((hit) => hit.id));
  return hits.length;
}

/**
 * Same highlight for a clip, ranked by the stored sound fingerprints.
 * Returns the number framed, or undefined when the clip has no fingerprint yet.
 */
export function showSoundsLike(seedId: string): number | undefined {
  const hits = soundsLike(seedId, useGraphStore.getState().nodes);
  if (!hits) return undefined;
  if (hits.length > 0) frame(seedId, hits.map((hit) => hit.id));
  return hits.length;
}
