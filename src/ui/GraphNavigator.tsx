import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { useActiveOptionScroll } from './useActiveOptionScroll';
import { fileTypeChip, selectedDocumentTitle } from '../pipeline/codeLanguage';
import { focusNode } from './focusNode';

const SUMMARY_ID = 'graph-navigator-summary';
const INSTRUCTIONS_ID = 'graph-navigator-instructions';

function optionId(index: number): string {
  return `graph-navigator-option-${index}`;
}

/**
 * Rows rendered on each side of the active option. Corpora can reach 4096
 * nodes; rendering them all made every selectedId change a long React commit
 * that dropped frames mid camera-glide and tripped the auto-quality downgrade.
 */
const WINDOW_RADIUS = 60;

/**
 * Height of one option row, mirroring .graph-navigator__option in styles.css
 * (min-height 44px + 1px bottom border). Spacers above and below the rendered
 * window are sized with it so total scroll geometry stays put and
 * useActiveOptionScroll's scrollIntoView({ block: 'nearest' }) keeps working.
 */
const ROW_HEIGHT = 45;

/**
 * Keyboard and screen-reader companion to the WebGL scene.
 *
 * It stays out of the visual workspace until reached with Tab, then becomes a
 * compact node picker. The data comes from graphStore rather than render
 * buffers so it remains complete when the scene is collapsed or simplified.
 */
export default function GraphNavigator() {
  const nodes = useGraphStore((state) => state.nodes);
  const edgeCount = useGraphStore((state) => state.edges.length);
  const selectedId = useUiStore((state) => state.selectedId);
  const listRef = useRef<HTMLDivElement>(null);

  const orderedNodes = useMemo(
    () => [...nodes].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'document' ? -1 : 1;
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    }),
    [nodes],
  );

  const [activeId, setActiveId] = useState<string | null>(selectedId ?? orderedNodes[0]?.id ?? null);

  useEffect(() => {
    if (activeId && orderedNodes.some((node) => node.id === activeId)) return;
    setActiveId(selectedId && orderedNodes.some((node) => node.id === selectedId)
      ? selectedId
      : orderedNodes[0]?.id ?? null);
  }, [activeId, orderedNodes, selectedId]);

  const activeIndex = useMemo(
    () => Math.max(0, orderedNodes.findIndex((node) => node.id === activeId)),
    [orderedNodes, activeId],
  );
  useActiveOptionScroll(orderedNodes.length > 0 ? optionId(activeIndex) : undefined);
  const { documentCount, topicCount, clusterCount } = useMemo(() => {
    let documents = 0;
    const clusters = new Set<number>();
    for (const node of orderedNodes) {
      if (node.kind !== 'document') continue;
      documents += 1;
      if (node.cluster >= 0) clusters.add(node.cluster);
    }
    return {
      documentCount: documents,
      topicCount: orderedNodes.length - documents,
      clusterCount: clusters.size,
    };
  }, [orderedNodes]);

  // Windowed rendering: only rows near the active option exist in the DOM.
  // Ids still encode the absolute index, so aria-activedescendant and the
  // scroll-into-view hook resolve the same elements as the full list did.
  const windowStart = Math.max(0, activeIndex - WINDOW_RADIUS);
  const windowEnd = Math.min(orderedNodes.length, activeIndex + WINDOW_RADIUS + 1);
  const visibleNodes = useMemo(
    () => orderedNodes.slice(windowStart, windowEnd),
    [orderedNodes, windowStart, windowEnd],
  );
  const hiddenAbove = windowStart;
  const hiddenBelow = orderedNodes.length - windowEnd;

  const moveTo = (index: number) => {
    const node = orderedNodes[Math.max(0, Math.min(index, orderedNodes.length - 1))];
    if (node) setActiveId(node.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (orderedNodes.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      moveTo(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      moveTo(activeIndex - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      moveTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      moveTo(orderedNodes.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const node = orderedNodes[activeIndex];
      if (!node) return;
      focusNode(node.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      listRef.current?.blur();
    }
  };

  if (orderedNodes.length === 0) return null;

  return (
    <aside className="graph-navigator glass-panel" aria-label="Accessible graph navigator">
      <p className="graph-navigator__title">Graph navigator</p>
      <p className="graph-navigator__summary" id={SUMMARY_ID}>
        {documentCount} {documentCount === 1 ? 'document' : 'documents'}, {topicCount}{' '}
        {topicCount === 1 ? 'topic hub' : 'topic hubs'}, {edgeCount}{' '}
        {edgeCount === 1 ? 'connection' : 'connections'}, {clusterCount}{' '}
        {clusterCount === 1 ? 'cluster' : 'clusters'}.
      </p>
      <p className="graph-navigator__instructions" id={INSTRUCTIONS_ID}>
        Use Up and Down to browse. Press Enter to open the active node. Press Escape to leave.
      </p>
      <div
        ref={listRef}
        className="graph-navigator__list"
        role="listbox"
        tabIndex={0}
        aria-label="Graph nodes"
        aria-describedby={`${SUMMARY_ID} ${INSTRUCTIONS_ID}`}
        aria-activedescendant={optionId(activeIndex)}
        onFocus={() => {
          if (selectedId && orderedNodes.some((node) => node.id === selectedId)) setActiveId(selectedId);
        }}
        onKeyDownCapture={handleKeyDown}
      >
        {hiddenAbove > 0 && (
          <div aria-hidden="true" style={{ height: hiddenAbove * ROW_HEIGHT }} />
        )}
        {visibleNodes.map((node, offset) => {
          const index = windowStart + offset;
          return (
          <div
            id={optionId(index)}
            key={node.id}
            className={`graph-navigator__option${index === activeIndex ? ' is-active' : ''}`}
            role="option"
            aria-selected={node.id === selectedId}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setActiveId(node.id);
              focusNode(node.id);
            }}
          >
            <span>{node.id === selectedId ? selectedDocumentTitle(node) : node.title}</span>
            <span className="graph-navigator__meta">
              {node.kind === 'topic'
                ? 'Topic hub'
                : `${fileTypeChip(node).toUpperCase()} · ${node.degree} connection${node.degree === 1 ? '' : 's'}`}
            </span>
          </div>
          );
        })}
        {hiddenBelow > 0 && (
          <div aria-hidden="true" style={{ height: hiddenBelow * ROW_HEIGHT }} />
        )}
      </div>
    </aside>
  );
}
