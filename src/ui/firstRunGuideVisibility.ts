/** Whether the first-run tour is on screen, for overlays that should wait
 *  their turn (the "What we found" card). Kept in a tiny module so those
 *  overlays don't pull the lazy-loaded tour into their own chunk. */
import { useSyncExternalStore } from 'react';

let guideVisible = false;
const listeners = new Set<() => void>();

export function setFirstRunGuideVisible(visible: boolean): void {
  if (guideVisible === visible) return;
  guideVisible = visible;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useFirstRunGuideVisible(): boolean {
  return useSyncExternalStore(subscribe, () => guideVisible, () => false);
}
