/**
 * Shared "select this node and frame the camera on it" helper. The same
 * `setSelected(id)` + `sendCamera('frameNode', [id])` pair was duplicated
 * across every panel that lets you jump to a node from a list (Insights,
 * Path, Search, Chat, SidePanel, ...) — one place to keep them from
 * drifting apart.
 */

import { useUiStore } from '../store/uiStore';

export function focusNode(id: string): void {
  const ui = useUiStore.getState();
  ui.setSelected(id);
  ui.sendCamera('frameNode', [id]);
}
