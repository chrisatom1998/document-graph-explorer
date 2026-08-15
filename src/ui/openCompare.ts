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
  useUiStore.setState((s) => ({
    pathMode: false,
    pathEndpoints: [],
    compareLeftId: seedId,
    compareRightId: null,
    comparePick: 'right' as const,
    ...(s.highlightOwner === 'path' ? { searchResults: null, highlightOwner: null } : {}),
  }));
  framePair(seedId, null);
}

/** Open both readers immediately (duplicate chips, Insights, connections). */
export function openCompare(leftId: string, rightId: string): void {
  if (leftId === rightId || !isDocument(leftId) || !isDocument(rightId)) return;
  useUiStore.setState({
    pathMode: false,
    pathEndpoints: [],
    selectedId: null,
    pendingFocus: null,
    readerHighlight: null,
    compareLeftId: leftId,
    compareRightId: rightId,
    comparePick: null,
  });
  framePair(leftId, rightId);
}

/** Re-enter graph-pick for one already-open pane. */
export function startComparePick(side: ComparePickSide): void {
  useUiStore.setState({ comparePick: side });
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
  useUiStore.setState(
    ui.comparePick === 'left'
      ? { compareLeftId: id, comparePick: null }
      : { compareRightId: id, comparePick: null },
  );
  const next = useUiStore.getState();
  framePair(next.compareLeftId, next.compareRightId);
  return true;
}

export function closeCompare(): void {
  useUiStore.getState().clearCompare();
}

export function swapCompare(): void {
  useUiStore.setState((s) => ({
    compareLeftId: s.compareRightId,
    compareRightId: s.compareLeftId,
    comparePick: s.comparePick === 'left' ? 'right' : s.comparePick === 'right' ? 'left' : null,
  }));
  const next = useUiStore.getState();
  if (next.compareLeftId && next.compareRightId) {
    framePair(next.compareLeftId, next.compareRightId);
  }
}
