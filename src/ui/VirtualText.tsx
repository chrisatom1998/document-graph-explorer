/**
 * Windowed text renderer for the side-panel document reader (spec §7.3:
 * "full text (virtualized)"). Splits text into fixed-height blocks and
 * renders only the visible slice + a buffer zone, preventing DOM bloat for
 * large (200 KB+) documents.
 *
 * Uses a scroll handler on the container + CSS paddingTop/paddingBottom to
 * maintain correct scroll height without rendering thousands of text nodes.
 */

import { useCallback, useMemo, useState, type UIEvent } from 'react';

const BLOCK_LINES = 60;
const LINE_HEIGHT_PX = 22.2; // 13.5px font × 1.65 line-height
const BUFFER_BLOCKS = 2; // render N blocks above and below the viewport
const blockHeight = BLOCK_LINES * LINE_HEIGHT_PX;

interface VirtualTextProps {
  text: string;
  className?: string;
}

export default function VirtualText({ text, className }: VirtualTextProps) {
  // Re-split whenever `text` changes; a ref cache would pin the first
  // document's text forever when this instance is reused across selections.
  const { lines, blocks } = useMemo(() => {
    const ls = text.split('\n');
    const bs: string[] = [];
    for (let i = 0; i < ls.length; i += BLOCK_LINES) {
      bs.push(ls.slice(i, i + BLOCK_LINES).join('\n'));
    }
    return { lines: ls, blocks: bs };
  }, [text]);

  const totalBlocks = blocks.length;
  const totalHeight = lines.length * LINE_HEIGHT_PX;

  // All hooks must run before any early return (Rules of Hooks).
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
    [totalBlocks],
  );

  // For small documents, skip virtualization entirely
  if (totalBlocks <= 3) {
    return <div className={className}>{text}</div>;
  }

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
        {blocks.slice(start, end).map((block, i) => (
          <span key={start + i}>{block}{'\n'}</span>
        ))}
      </div>
    </div>
  );
}
