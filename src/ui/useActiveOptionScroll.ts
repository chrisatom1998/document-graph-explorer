import { useEffect } from 'react';

/**
 * Keeps the active option of an `aria-activedescendant` listbox in view.
 *
 * These listboxes move a highlight rather than DOM focus, so the browser does
 * no scrolling of its own: arrowing past the first screenful moved the
 * highlight out of the scroll container and left keyboard and screen-magnifier
 * users navigating blind.
 *
 * `block: 'nearest'` scrolls the minimum needed and does nothing when the
 * option is already visible. The optional call keeps this a no-op under jsdom,
 * which does not implement scrollIntoView.
 */
export function useActiveOptionScroll(activeOptionId: string | undefined): void {
  useEffect(() => {
    if (!activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOptionId]);
}
