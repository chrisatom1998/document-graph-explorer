import { useEffect, useRef } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { fileTypeChip } from '../pipeline/codeLanguage';

/** Tiny cluster swatch — do not import scene/palette (it pulls THREE into the entry). */
function clusterDot(cluster: number): string {
  if (cluster < 0) return '#8f9bff';
  const hue = (210 + cluster * 137.508) % 360;
  return `hsl(${hue.toFixed(1)} 72% 66%)`;
}

const OFFSET = 16;

/**
 * Hover card that tracks the cursor without triggering a React re-render
 * per mousemove: the listener writes directly to the div's transform via
 * a ref, flipping near the right/bottom viewport edges.
 */
export default function Tooltip() {
  const hoveredId = useUiStore((s) => s.hoveredId);
  const selectedId = useUiStore((s) => s.selectedId);
  const pathMode = useUiStore((s) => s.pathMode);

  const nodes = useGraphStore((s) => s.nodes);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);

  const elRef = useRef<HTMLDivElement | null>(null);

  const visible = !!hoveredId && hoveredId !== selectedId;
  const node = hoveredId ? nodes[nodeIndex[hoveredId]] : undefined;

  useEffect(() => {
    if (!visible) return;
    const el = elRef.current;
    if (!el) return;

    const move = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const flipX = e.clientX + OFFSET + rect.width > vw;
      const flipY = e.clientY + OFFSET + rect.height > vh;

      const x = flipX ? e.clientX - OFFSET - rect.width : e.clientX + OFFSET;
      const y = flipY ? e.clientY - OFFSET - rect.height : e.clientY + OFFSET;

      el.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
    };

    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, [visible]);

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
        <span className="chip">{fileTypeChip(node)}</span>
        <span className="hover-tooltip__cluster">
          <span className="chip-dot" style={{ background: clusterDot(node.cluster) }} aria-hidden="true" />
        </span>
        <span>{node.wordCount.toLocaleString()} words</span>
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
