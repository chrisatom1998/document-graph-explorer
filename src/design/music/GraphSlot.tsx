import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { DimsToggleButton } from '../../ui/DimsToggleButton';
import { fitGraph } from './player';

/**
 * Marks where the live graph belongs in a music design. The Resonance shell
 * (which owns the one WebGL canvas) is pinned over this rectangle through
 * --mx-slot-* variables, so camera, picking, 2D/3D and every graph behaviour
 * are the shipped ones; only the frame around them changes.
 */
export function useGraphSlot() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      // Clip to every scrolling ancestor and keep clear of the bottom player,
      // so a card scrolled under the player or a tab bar is not drawn over it.
      const reserve = parseFloat(getComputedStyle(root).getPropertyValue('--mx-player-h')) || 0;
      let top = 0, left = 0, right = window.innerWidth, bottom = window.innerHeight - reserve;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (!/(auto|scroll|hidden)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
        const pr = p.getBoundingClientRect();
        top = Math.max(top, pr.top); left = Math.max(left, pr.left);
        right = Math.min(right, pr.right); bottom = Math.min(bottom, pr.bottom);
      }
      const clip = [top - r.top, r.right - right, r.bottom - bottom, left - r.left].map(v => Math.max(0, v));
      root.style.setProperty('--mx-slot-x', `${r.left}px`);
      root.style.setProperty('--mx-slot-y', `${r.top}px`);
      root.style.setProperty('--mx-slot-w', `${r.width}px`);
      root.style.setProperty('--mx-slot-h', `${r.height}px`);
      root.style.setProperty('--mx-slot-clip', clip.map(v => `${v}px`).join(' '));
      const visible = r.width - clip[1] - clip[3] > 0 && r.height - clip[0] - clip[2] > 0;
      root.dataset.graphSlot = visible ? 'on' : 'off';
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    // Panels that slide or expand move the slot without resizing it.
    const timer = window.setInterval(sync, 250);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
      window.clearInterval(timer);
      root.dataset.graphSlot = 'off';
    };
  }, []);
  return ref;
}

/** A titled card holding the graph, with the real 2D/3D switch and Fit. */
export function GraphCard({ title, subtitle, className = '', actions }: { title: string; subtitle?: string; className?: string; actions?: ReactNode }) {
  const slot = useGraphSlot();
  return (
    <section className={`mx-map ${className}`} aria-label={title}>
      <header className="mx-map__head">
        <span className="mx-map__titles"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
        <span className="mx-map__tools">
          <DimsToggleButton />
          <button type="button" className="mx-map__fit" onClick={fitGraph} aria-keyshortcuts="Home">Fit</button>
          {actions}
        </span>
      </header>
      <div ref={slot} className="mx-map__slot" />
    </section>
  );
}
