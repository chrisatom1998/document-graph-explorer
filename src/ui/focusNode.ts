/**
 * Shared "frame the camera on this node, then open the side panel" helper.
 * Search, Insights, Path, Chat, SidePanel neighbor jumps, and the graph
 * navigator all go through here so the camera-then-panel order cannot drift.
 *
 * Search hits and chat citations may also pass a passage so the side-panel
 * reader can scroll to the matching chunk instead of opening at the top.
 * The highlight is applied at commit time, when the panel actually mounts.
 */

import { chunkStore } from '../store/runtimeStores';
import { useUiStore, type FocusPassage, type ReaderHighlight } from '../store/uiStore';

export type { FocusPassage };

function resolveHighlight(id: string, passage?: FocusPassage): ReaderHighlight | null {
  const chunkIndex = passage?.index !== undefined && passage.index >= 0 ? passage.index : undefined;
  const chunkText = chunkIndex !== undefined ? chunkStore.get(id)?.texts[chunkIndex] : undefined;
  const text = chunkText?.trim() || passage?.text?.trim() || '';
  if (!text) return null;
  return {
    docId: id,
    text,
    ...(chunkIndex === undefined ? {} : { passageIndex: chunkIndex }),
  };
}

/** Start a camera-first focus. The side panel stays closed until commit. */
export function focusNode(id: string, passage?: FocusPassage): void {
  const ui = useUiStore.getState();
  ui.sendCamera('frameNode', [id]);
  ui.setPendingFocus({ id, ...(passage ? { passage } : {}) });
}

/**
 * Open the side panel for the in-flight focus. No-ops if the pending
 * focus was cancelled (empty-space click, a later setSelected, …).
 * Returns true when a selection was applied.
 */
export function commitPendingFocus(): boolean {
  const pending = useUiStore.getState().pendingFocus;
  if (!pending) return false;
  useUiStore.setState({
    selectedId: pending.id,
    readerHighlight: resolveHighlight(pending.id, pending.passage),
    pendingFocus: null,
  });
  return true;
}

/** Commit only when the arrived/cancelled frame matches the pending node. */
export function commitPendingFocusIf(id: string | undefined): boolean {
  const pending = useUiStore.getState().pendingFocus;
  if (!pending || !id || pending.id !== id) return false;
  return commitPendingFocus();
}
