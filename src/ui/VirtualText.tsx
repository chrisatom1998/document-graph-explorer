/**
 * Windowed text renderer for the side-panel document reader (spec §7.3:
 * "full text (virtualized)"). Splits text into fixed-line blocks and renders
 * only the visible slice + a buffer zone, preventing DOM bloat for large
 * (200 KB+) documents.
 *
 * Uses a scroll handler on the container + CSS paddingTop/paddingBottom to
 * maintain correct scroll height without rendering thousands of text nodes.
 *
 * Height accounting: a block of BLOCK_LINES source lines does NOT reliably
 * render at BLOCK_LINES * LINE_HEIGHT_PX under `white-space: pre-wrap` — any
 * source line long enough to wrap consumes more than one visual line, so a
 * per-block estimate would under-report real height and the padding/scroll
 * math would drift (jumpy scroll, wrong end-of-document position) as more
 * wrapped blocks scroll past. Each rendered block is instead measured via
 * ResizeObserver once mounted, and those measured heights (falling back to
 * the fixed estimate for anything not yet rendered) drive the offset/height
 * calculations. Measured heights live in a plain ref — mutated from the
 * ResizeObserver callback, which never triggers a React re-render on its
 * own — with a version counter published to state so the offset recompute
 * below can safely depend on it (same ref + "version" split as
 * ClusterCollapse's centroid tracking).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';

const BLOCK_LINES = 60;
const LINE_HEIGHT_PX = 22.2; // 13.5px font × 1.65 line-height
const BUFFER_BLOCKS = 2; // render N blocks above and below the viewport
const ESTIMATED_BLOCK_HEIGHT = BLOCK_LINES * LINE_HEIGHT_PX;
// Ignore sub-pixel ResizeObserver noise — real wraps change height by a
// whole line (22px+), so this comfortably filters rounding jitter without
// missing genuine reflows.
const HEIGHT_EPSILON = 0.5;

interface VirtualTextProps {
  text: string;
  className?: string;
}

/** Index i such that offsets[i] <= target < offsets[i+1] (offsets is sorted, length >= 1). */
function blockIndexAtOffset(offsets: Float64Array, target: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export default function VirtualText({ text, className }: VirtualTextProps) {
  // Re-split whenever `text` changes; a ref cache would pin the first
  // document's text forever when this instance is reused across selections.
  const blocks = useMemo(() => {
    const ls = text.split('\n');
    const bs: string[] = [];
    for (let i = 0; i < ls.length; i += BLOCK_LINES) {
      bs.push(ls.slice(i, i + BLOCK_LINES).join('\n'));
    }
    return bs;
  }, [text]);

  const totalBlocks = blocks.length;

  // Per-block measured heights (imperative ref) + a version counter that's
  // bumped whenever a measurement actually changes, so the offsets useMemo
  // below can depend on something render-visible.
  const heightsRef = useRef<Float64Array>(new Float64Array(0));
  const [heightVersion, setHeightVersion] = useState(0);

  useEffect(() => {
    heightsRef.current = new Float64Array(totalBlocks).fill(ESTIMATED_BLOCK_HEIGHT);
    setHeightVersion((v) => v + 1);
  }, [blocks, totalBlocks]);

  // Lazily constructed exactly once (React state initializer, not an
  // effect): ref callbacks fire during the commit's layout phase, BEFORE
  // passive effects run — building the observer inside a useEffect would
  // mean it doesn't exist yet when the first batch of blocks mount, so
  // nothing would ever get observed.
  const [resizeObserver] = useState<ResizeObserver | null>(() => {
    if (typeof ResizeObserver === 'undefined') return null;
    return new ResizeObserver((entries) => {
      const heights = heightsRef.current;
      let changed = false;
      for (const entry of entries) {
        const idx = Number((entry.target as HTMLElement).dataset.blockIndex);
        if (!Number.isFinite(idx) || idx < 0 || idx >= heights.length) continue;
        const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (h > 0 && Math.abs(heights[idx] - h) > HEIGHT_EPSILON) {
          heights[idx] = h;
          changed = true;
        }
      }
      if (changed) setHeightVersion((v) => v + 1);
    });
  });

  useEffect(() => {
    return () => resizeObserver?.disconnect();
  }, [resizeObserver]);

  // React 19 ref callbacks may return a cleanup — unobserve on unmount so a
  // scrolled-away block doesn't keep a dangling ResizeObserver registration.
  const registerBlockEl = useCallback(
    (el: HTMLSpanElement | null) => {
      if (!resizeObserver || !el) return;
      resizeObserver.observe(el);
      return () => resizeObserver.unobserve(el);
    },
    [resizeObserver],
  );

  // Prefix sums over the measured (or estimated) block heights — recomputed
  // only when a measurement changes or the block list is rebuilt.
  const offsets = useMemo(() => {
    const heights = heightsRef.current;
    const out = new Float64Array(heights.length + 1);
    for (let i = 0; i < heights.length; i++) out[i + 1] = out[i] + heights[i];
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightVersion, totalBlocks]);

  const totalHeight = offsets[offsets.length - 1] ?? 0;

  // All hooks must run before any early return (Rules of Hooks).
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 3]);

  const recomputeVisibleRange = useCallback(
    (scrollTop: number, viewportH: number) => {
      const firstVisible = blockIndexAtOffset(offsets, scrollTop);
      const lastVisible = blockIndexAtOffset(offsets, scrollTop + viewportH) + 1;
      const start = Math.max(0, firstVisible - BUFFER_BLOCKS);
      const end = Math.min(totalBlocks, lastVisible + BUFFER_BLOCKS);
      setVisibleRange((prev) =>
        prev[0] === start && prev[1] === end ? prev : [start, end],
      );
    },
    [offsets, totalBlocks],
  );

  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      recomputeVisibleRange(el.scrollTop, el.clientHeight);
    },
    [recomputeVisibleRange],
  );

  // A height measurement changing the offsets (e.g. blocks that were
  // estimated now measured, or vice versa on a text change) can shift which
  // blocks should be visible even without a scroll event — re-derive from
  // the current scroll position whenever offsets are rebuilt.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    recomputeVisibleRange(el.scrollTop, el.clientHeight);
  }, [offsets, recomputeVisibleRange]);

  // For small documents, skip virtualization entirely
  if (totalBlocks <= 3) {
    return <div className={className}>{text}</div>;
  }

  const [start, end] = visibleRange;
  const clampedStart = Math.min(start, totalBlocks);
  const clampedEnd = Math.min(end, totalBlocks);
  const paddingTop = offsets[clampedStart] ?? 0;
  const paddingBottom = Math.max(0, totalHeight - (offsets[clampedEnd] ?? totalHeight));

  return (
    <div className={className} onScroll={handleScroll} ref={containerRef}>
      <div
        style={{
          paddingTop: `${paddingTop}px`,
          paddingBottom: `${paddingBottom}px`,
          willChange: 'padding',
        }}
      >
        {blocks.slice(clampedStart, clampedEnd).map((block, i) => {
          const idx = clampedStart + i;
          return (
            <span
              key={idx}
              ref={registerBlockEl}
              data-block-index={idx}
              style={{ display: 'block' }}
            >
              {block}
              {'\n'}
            </span>
          );
        })}
      </div>
    </div>
  );
}
