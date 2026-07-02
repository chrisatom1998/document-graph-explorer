/**
 * Windowed text renderer for the side-panel document reader (spec §7.3:
 * "full text (virtualized)"). Splits text into fixed-height blocks and
 * renders only the visible slice + a buffer zone, preventing DOM bloat for
 * large (200 KB+) documents.
 *
 * Uses a scroll handler on the container + CSS paddingTop/paddingBottom to
 * maintain correct scroll height without rendering thousands of text nodes.
 */

import { useCallback, useRef, useState, type UIEvent } from 'react';

const BLOCK_LINES = 60;
const LINE_HEIGHT_PX = 22.2; // 13.5px font × 1.65 line-height
const BUFFER_BLOCKS = 2; // render N blocks above and below the viewport

interface VirtualTextProps {
  text: string;
  className?: string;
}

export default function VirtualText({ text, className }: VirtualTextProps) {
  const lines = useRef<string[] | null>(null);
  const blocks = useRef<string[] | null>(null);

  // Lazily split — only on first render / text change
  if (lines.current === null || blocks.current === null) {
    const ls = text.split('\n');
    lines.current = ls;
    const bs: string[] = [];
    for (let i = 0; i < ls.length; i += BLOCK_LINES) {
      bs.push(ls.slice(i, i + BLOCK_LINES).join('\n'));
    }
    blocks.current = bs;
  }

  const totalBlocks = blocks.current.length;
  const totalHeight = lines.current.length * LINE_HEIGHT_PX;

  // For small documents, skip virtualization entirely
  if (totalBlocks <= 3) {
    return (
      <div className={className}>
        {text}
      </div>
    );
  }

  const blockHeight = BLOCK_LINES * LINE_HEIGHT_PX;
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 3]);

  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const scrollTop = el.scrollTop;
      const viewportH = el.clientHeight;
      const firstVisible = Math.floor(scrollTop / blockHeight);
      const lastVisible = Math.ceil((scrollTop + viewportH) / blockHeight);
      const start = Math.max(0, firstVisible - BUFFER_BLOCKS);
      const end = Math.min(totalBlocks, lastVisible + BUFFER_BLOCKS);
      setVisibleRange((prev) =>
        prev[0] === start && prev[1] === end ? prev : [start, end],
      );
    },
    [blockHeight, totalBlocks],
  );

  const [start, end] = visibleRange;
  const paddingTop = start * blockHeight;
  const paddingBottom = Math.max(0, totalHeight - end * blockHeight);

  return (
    <div className={className} onScroll={handleScroll}>
      <div
        style={{
          paddingTop: `${paddingTop}px`,
          paddingBottom: `${paddingBottom}px`,
          willChange: 'padding',
        }}
      >
        {blocks.current.slice(start, end).map((block, i) => (
          <span key={start + i}>{block}{'\n'}</span>
        ))}
      </div>
    </div>
  );
}
