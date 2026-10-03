import { useEffect, useRef } from 'react';

const POSITION_KEY = 'dge:sample-assistant-position';
type Position = { x: number; y: number };
function place(button: HTMLButtonElement, position: Position): Position {
  const rect = button.getBoundingClientRect();
  const next = {
    x: Math.max(0, Math.min(position.x, window.innerWidth - rect.width)),
    y: Math.max(0, Math.min(position.y, window.innerHeight - rect.height)),
  };
  button.style.left = `${next.x}px`; button.style.top = `${next.y}px`;
  button.style.bottom = 'auto';
  return next;
}
function save(position: Position) {
  try { localStorage.setItem(POSITION_KEY, JSON.stringify(position)); } catch { /* Moving still works without storage. */ }
}

export default function SampleAssistantLauncher({ count, onOpen }: { count: number; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const position = useRef<Position | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; left: number; top: number } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    const button = ref.current;
    if (!button) return;
    try {
      const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null');
      if (saved && typeof saved.x === 'number' && Number.isFinite(saved.x) && typeof saved.y === 'number' && Number.isFinite(saved.y)) position.current = place(button, saved);
    } catch { /* Ignore invalid or unavailable saved positions. */ }
    const resize = () => { if (position.current) position.current = place(button, position.current); };
    window.addEventListener('resize', resize);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(button);
    return () => { window.removeEventListener('resize', resize); observer?.disconnect(); };
  }, []);
  return <button ref={ref} type="button" className="dj-launch" aria-haspopup="dialog"
    title="Drag to move; click to open. Arrow keys move; Home resets the position."
    onPointerDown={e => {
      if (!e.isPrimary || e.button !== 0 || drag.current) return;
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      suppressClick.current = false;
      drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, left: rect.left, top: rect.top };
      e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={e => {
      const current = drag.current;
      if (!current || current.pointerId !== e.pointerId) return;
      const dx = e.clientX - current.startX; const dy = e.clientY - current.startY;
      if (!suppressClick.current && Math.hypot(dx, dy) < 6) return;
      e.stopPropagation();
      suppressClick.current = true;
      e.currentTarget.dataset.dragging = 'true';
      position.current = place(e.currentTarget, { x: current.left + dx, y: current.top + dy });
    }}
    onPointerUp={e => {
      if (drag.current?.pointerId !== e.pointerId) return;
      e.stopPropagation(); drag.current = null;
      delete e.currentTarget.dataset.dragging;
      if (suppressClick.current && position.current) save(position.current);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    }}
    onPointerCancel={e => { drag.current = null; delete e.currentTarget.dataset.dragging; }}
    onLostPointerCapture={e => { drag.current = null; delete e.currentTarget.dataset.dragging; }}
    onClick={e => {
      e.stopPropagation();
      // A completed drag also generates a click. Keyboard activation (detail 0)
      // remains available even when a prior pointer gesture was cancelled.
      if (suppressClick.current && e.detail !== 0) { suppressClick.current = false; return; }
      suppressClick.current = false; onOpen();
    }}
    onKeyDown={e => {
      e.stopPropagation();
      if (e.key === 'Home') {
        e.preventDefault(); position.current = null;
        e.currentTarget.style.removeProperty('left'); e.currentTarget.style.removeProperty('top'); e.currentTarget.style.removeProperty('bottom');
        try { localStorage.removeItem(POSITION_KEY); } catch { /* Optional storage. */ }
        return;
      }
      const step = e.shiftKey ? 40 : 10;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      if (!dx && !dy) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      position.current = place(e.currentTarget, { x: rect.left + dx, y: rect.top + dy });
      save(position.current);
    }}
  >♫ Sample assistant <span>{count}</span></button>;
}
