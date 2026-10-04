import { useCallback, useEffect, useRef, type HTMLAttributes, type RefObject } from 'react';

/** Move only the dialog; its contents and in-progress requests stay mounted. */
export function useDialogDrag(dialog: RefObject<HTMLDialogElement | null>, open: boolean) {
  const drag = useRef<{ pointerId: number; dx: number; dy: number } | null>(null);
  const position = useRef<{ x: number; y: number } | null>(null);
  const place = (x: number, y: number) => {
    const el = dialog.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = {
      x: Math.max(0, Math.min(x, window.innerWidth - rect.width)),
      y: Math.max(0, Math.min(y, window.innerHeight - rect.height)),
    };
    position.current = next;
    el.dataset.positioned = 'true';
    el.style.left = `${next.x}px`;
    el.style.top = `${next.y}px`;
  };
  const reset = useCallback(() => {
    drag.current = null; position.current = null;
    const el = dialog.current;
    if (!el) return;
    delete el.dataset.positioned; delete el.dataset.dragging;
    el.style.removeProperty('left'); el.style.removeProperty('top');
  }, [dialog]);
  useEffect(() => {
    if (!open) return;
    const el = dialog.current;
    const resize = () => {
      if (!el || !position.current) return;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(position.current.x, window.innerWidth - rect.width));
      const y = Math.max(0, Math.min(position.current.y, window.innerHeight - rect.height));
      position.current = { x, y };
      el.style.left = `${x}px`; el.style.top = `${y}px`;
    };
    window.addEventListener('resize', resize);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    if (el) observer?.observe(el);
    return () => { window.removeEventListener('resize', resize); observer?.disconnect(); drag.current = null; };
  }, [dialog, open]);

  const headerProps: HTMLAttributes<HTMLElement> = {
    onPointerDown: e => {
      if (e.button !== 0 || !e.isPrimary || !dialog.current || drag.current) return;
      const control = (e.target as HTMLElement).closest('button, a, input, select, textarea');
      if (control && !control.hasAttribute('data-drag-handle')) return;
      const rect = dialog.current.getBoundingClientRect();
      drag.current = { pointerId: e.pointerId, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      e.currentTarget.setPointerCapture(e.pointerId);
      dialog.current.dataset.dragging = 'true';
      e.preventDefault();
    },
    onPointerMove: e => {
      if (drag.current?.pointerId !== e.pointerId) return;
      place(e.clientX - drag.current.dx, e.clientY - drag.current.dy);
    },
    onPointerUp: e => {
      if (drag.current?.pointerId !== e.pointerId) return;
      drag.current = null;
      if (dialog.current) delete dialog.current.dataset.dragging;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    },
    onPointerCancel: () => { drag.current = null; if (dialog.current) delete dialog.current.dataset.dragging; },
    onLostPointerCapture: () => { drag.current = null; if (dialog.current) delete dialog.current.dataset.dragging; },
    onKeyDown: e => {
      if (!(e.target as HTMLElement).hasAttribute('data-drag-handle') || !dialog.current) return;
      if (e.key === 'Home') { e.preventDefault(); reset(); return; }
      const direction: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const delta = direction[e.key];
      if (!delta) return;
      e.preventDefault();
      const rect = dialog.current.getBoundingClientRect();
      const step = e.shiftKey ? 40 : 10;
      place(rect.left + delta[0] * step, rect.top + delta[1] * step);
    },
  };
  return { headerProps, reset };
}
