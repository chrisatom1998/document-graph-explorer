/**
 * Shared "select this node and frame the camera on it" helper. The same
 * `setSelected(id)` + `sendCamera('frameNode', [id])` pair was duplicated
 * across every panel that lets you jump to a node from a list (Insights,
 * Path, Search, Chat, SidePanel, ...) — one place to keep them from
 * drifting apart.
 *
 * Search hits and chat citations may also pass a passage so the side-panel
 * reader can scroll to the matching chunk instead of opening at the top.
 */

import { chunkStore } from '../store/runtimeStores';
import { useUiStore } from '../store/uiStore';

export interface FocusPassage {
  /** Zero-based chunk index when the retriever scored a real passage. */
  index?: number;
  /** Snippet used when chunk text is unavailable (imported graphs). */
  text?: string;
}

export function focusNode(id: string, passage?: FocusPassage): void {
  const ui = useUiStore.getState();
  ui.setSelected(id);
  ui.sendCamera('frameNode', [id]);
  const chunkText =
    passage?.index !== undefined ? chunkStore.get(id)?.texts[passage.index] : undefined;
  const text = chunkText?.trim() || passage?.text?.trim() || '';
  if (text) {
    ui.setReaderHighlight({
      docId: id,
      text,
      ...(passage?.index === undefined ? {} : { passageIndex: passage.index }),
    });
  }
}
