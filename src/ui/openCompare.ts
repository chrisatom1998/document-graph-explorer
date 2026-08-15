/**
 * Open or advance the side-by-side compare overlay. Graph clicks, Insights
 * duplicate rows, and side-panel actions all go through here so framing and
 * highlight ownership stay in lockstep with uiStore.compare* fields.
 */

import { useGraphStore } from '../store/graphStore';
import { useUiStore, type ComparePickSide } from '../store/uiStore';

function isDocument(id: string): boolean {
  const graph = useGraphStore.getState();
  const node = graph.nodes[graph.nodeIndex[id]];
  return node?.kind === 'document';
}

function framePair(leftId: string | null, rightId: string | null): void {
  const ui = useUiStore.getState();
  const ids = [leftId, rightId].filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  ui.setSearchResults(ids, 'compare');
  ui.sendCamera(ids.length === 1 ? 'frameNode' : 'frameSet', ids);
}

/** Seed the left pane and wait for a second document click. */
export function startCompare(seedId: string): void {
  if (!isDocument(seedId)) return;
  const ui = useUiStore.getState();
  ui.startCompare(seedId);
  framePair(seedId, null);
}

/** Open both readers immediately (duplicate chips, Insights, connections). */
export function openCompare(leftId: string, rightId: string): void {
  if (leftId === rightId || !isDocument(leftId) || !isDocument(rightId)) return;
  const ui = useUiStore.getState();
  ui.openCompare(leftId, rightId);
  framePair(leftId, rightId);
}

/** Re-enter graph-pick for one already-open pane. */
export function startComparePick(side: ComparePickSide): void {
  useUiStore.getState().startComparePick(side);
}

/**
 * Fill the waiting pane. Returns false when pick mode is off, the node is a
 * topic hub, or the click is the document already on the other side.
 */
export function applyComparePick(id: string): boolean {
  const ui = useUiStore.getState();
  if (!ui.comparePick) return false;
  if (!isDocument(id)) return false;
  const other = ui.comparePick === 'left' ? ui.compareRightId : ui.compareLeftId;
  if (other === id) return false;
  ui.applyComparePick(id);
  const next = useUiStore.getState();
  framePair(next.compareLeftId, next.compareRightId);
  return true;
}

export function closeCompare(): void {
  useUiStore.getState().clearCompare();
}

export function swapCompare(): void {
  const ui = useUiStore.getState();
  ui.swapCompare();
  const next = useUiStore.getState();
  if (next.compareLeftId && next.compareRightId) {
    framePair(next.compareLeftId, next.compareRightId);
  }
}
