/**
 * Insight-row next steps that reuse existing stores: tag a pair as
 * `duplicate`, no new chrome. Isolated so the panel stays presentational
 * and tagging is unit-testable without jsdom layout.
 */

import type { DocNode } from '../model/types';
import { annotationKey, emptyAnnotation, useAnnotationStore } from '../store/annotationStore';

export const DUPLICATE_TAG = 'duplicate';

/**
 * Add `tag` to each listed document that does not already have it.
 * Returns how many documents were newly tagged. No-op (0) when annotations
 * are not hydrated for a local corpus — the Insights row hides the button.
 */
export function addTagToDocuments(
  nodes: readonly Pick<DocNode, 'id' | 'path' | 'title'>[],
  ids: readonly string[],
  tag: string,
): number {
  const wanted = new Set(ids);
  let tagged = 0;
  for (const node of nodes) {
    if (!wanted.has(node.id)) continue;
    const state = useAnnotationStore.getState();
    if (!state.scope) return tagged;
    const key = annotationKey(node);
    const current = state.annotations[key] ?? emptyAnnotation();
    if (current.tags.includes(tag)) continue;
    state.update(key, { tags: [...current.tags, tag] });
    tagged += 1;
  }
  return tagged;
}

export function documentsAlreadyTagged(
  nodes: readonly Pick<DocNode, 'id' | 'path' | 'title'>[],
  ids: readonly string[],
  tag: string,
): boolean {
  const annotations = useAnnotationStore.getState().annotations;
  return ids.every((id) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return false;
    return (annotations[annotationKey(node)]?.tags ?? []).includes(tag);
  });
}
