import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Modal focus management for an `aria-modal` dialog. While `active`:
 *  - moves focus to the first focusable element inside `ref` on open,
 *  - keeps Tab / Shift+Tab cycling within the dialog (focus can't escape to
 *    the graph behind the modal),
 *  - restores focus to the previously focused element when the dialog closes.
 *
 * Call unconditionally (Rules of Hooks); pass the open flag as `active`.
 * `ref` should point at the dialog container, which is expected to mount only
 * while open.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    const container = ref.current;
    if (!active || !container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
      );

    (focusable()[0] ?? container).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || activeEl === container)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      // Restore focus to whatever had it before the dialog opened.
      previouslyFocused?.focus?.();
    };
  }, [ref, active]);
}
