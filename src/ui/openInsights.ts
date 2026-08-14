/**
 * Open the Insights drawer, optionally focusing a section and painting
 * those documents onto the shared graph highlight. Used by the post-ingest
 * digest card so jump links do not grow a toolbar button.
 */

import { useUiStore, type InsightsFocus } from '../store/uiStore';

export function openInsights(focus?: InsightsFocus, ids?: string[]): void {
  const ui = useUiStore.getState();
  if (ids && ids.length > 0) ui.setSearchResults(ids, 'insights');
  else if (!focus) ui.setSearchResults(null);
  ui.setInsightsOpen(true, focus ?? null);
}
