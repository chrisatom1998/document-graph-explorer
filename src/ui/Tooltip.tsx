import { useEffect, useLayoutEffect, useRef } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { fileTypeChip } from '../pipeline/codeLanguage';

const OFFSET = 16;

// Last cursor position, tracked by the persistent listener below so the card
// can be placed the moment it appears — waiting for the next mousemove used to
// leave the first paint sitting at the viewport origin (styles.css pins
// .hover-tooltip at top/left 0).
const cursor = { x: -9999, y: -9999 };

/**
 * Hover card that tracks the cursor without triggering a React re-render
 * per mousemove: the listener writes directly to the div's transform via
 * a ref, flipping near the right/bottom viewport edges. The card's size is
 * measured once per content change — measuring inside the mousemove handler
 * would force a synchronous layout on every mouse event.
 */
export default function Tooltip() {
  const hoveredId = useUiStore((s) => s.hoveredId);
  const selectedId = useUiStore((s) => s.selectedId);
  const pathMode = useUiStore((s) => s.pathMode);

  const node = useGraphStore((s) => (hoveredId ? s.nodes[s.nodeIndex[hoveredId]] : undefined));

  const elRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  const visible = !!hoveredId && hoveredId !== selectedId;

  const place = (el: HTMLDivElement) => {
    const { width, height } = sizeRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const flipX = cursor.x + OFFSET + width > vw;
    const flipY = cursor.y + OFFSET + height > vh;

    const x = flipX ? cursor.x - OFFSET - width : cursor.x + OFFSET;
    const y = flipY ? cursor.y - OFFSET - height : cursor.y + OFFSET;

    el.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
  };

  // One persistent tracker: keeps `cursor` current while the card is hidden
  // (so it mounts in place) and steers the transform while it shows.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      cursor.x = e.clientX;
      cursor.y = e.clientY;
      const el = elRef.current;
      if (el) place(el);
    };
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);

  // Measure once per content change, then position before the browser paints —
  // the card must never be visible at its un-translated origin.
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    sizeRef.current = { width: rect.width, height: rect.height };
    place(el);
  });

  if (!visible || !node) return null;

  const topTopics = node.topics.slice(0, 3);
  // Surface the otherwise-invisible scene gestures (drag-to-pin, path picking).
  const hint = pathMode
    ? node.kind === 'topic'
      ? 'topic hub — pick documents for a path'
      : 'click to add to path'
    : 'click to read · drag to pin · double-click to release';

  return (
    <div
      ref={elRef}
      className={`hover-tooltip glass-panel${visible ? ' is-visible' : ''}`}
    >
      <p className="hover-tooltip__title">{node.title}</p>
      <p className="hover-tooltip__meta">
        {fileTypeChip(node)} · {node.wordCount.toLocaleString()} words
      </p>
      {topTopics.length > 0 && (
        <div className="hover-tooltip__topics">
          {topTopics.map((t) => (
            <span key={t} className="chip chip-muted">
              {t}
            </span>
          ))}
        </div>
      )}
      <p className="hover-tooltip__hint">{hint}</p>
    </div>
  );
}
