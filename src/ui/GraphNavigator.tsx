import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { useActiveOptionScroll } from './useActiveOptionScroll';
import { fileTypeChip, selectedDocumentTitle } from '../pipeline/codeLanguage';
import { focusNode } from './focusNode';

const SUMMARY_ID = 'graph-navigator-summary';
const INSTRUCTIONS_ID = 'graph-navigator-instructions';
// Rows rendered around the highlight; navigation still spans the full list.
const NAVIGATOR_WINDOW = 60;

function optionId(index: number): string {
  return `graph-navigator-option-${index}`;
}

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

  const { orderedNodes, indexOfId, documentCount, topicCount, clusterCount } = useMemo(() => {
    const orderedNodes = [...nodes].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'document' ? -1 : 1;
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });
    const indexOfId = new Map(orderedNodes.map((node, i) => [node.id, i]));
    let documentCount = 0;
    const clusters = new Set<number>();
    for (const node of orderedNodes) {
      if (node.kind !== 'document') continue;
      documentCount++;
      if (node.cluster >= 0) clusters.add(node.cluster);
    }
    return {
      orderedNodes,
      indexOfId,
      documentCount,
      topicCount: orderedNodes.length - documentCount,
      clusterCount: clusters.size,
    };
  }, [nodes]);

  const [activeId, setActiveId] = useState<string | null>(selectedId ?? orderedNodes[0]?.id ?? null);

  useEffect(() => {
    if (activeId && indexOfId.has(activeId)) return;
    setActiveId(selectedId && indexOfId.has(selectedId) ? selectedId : orderedNodes[0]?.id ?? null);
  }, [activeId, orderedNodes, indexOfId, selectedId]);

  const activeIndex = Math.max(0, activeId ? indexOfId.get(activeId) ?? -1 : -1);
  useActiveOptionScroll(orderedNodes.length > 0 ? optionId(activeIndex) : undefined);

  // The listbox uses aria-activedescendant, so only the rows near the
  // highlight need to exist in the DOM — rendering all of them put ~12k
  // permanent elements in the page at the node cap. aria-setsize/posinset
  // keep the "item N of M" announcements correct over the full model.
  const windowStart = Math.max(
    0,
    Math.min(activeIndex - (NAVIGATOR_WINDOW >> 1), orderedNodes.length - NAVIGATOR_WINDOW),
  );
  const windowNodes = orderedNodes.slice(windowStart, windowStart + NAVIGATOR_WINDOW);

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
          if (selectedId && indexOfId.has(selectedId)) setActiveId(selectedId);
        }}
        onKeyDownCapture={handleKeyDown}
      >
        {windowNodes.map((node, windowIndex) => {
          const index = windowStart + windowIndex;
          return (
          <div
            id={optionId(index)}
            key={node.id}
            className={`graph-navigator__option${index === activeIndex ? ' is-active' : ''}`}
            role="option"
            aria-selected={node.id === selectedId}
            aria-setsize={orderedNodes.length}
            aria-posinset={index + 1}
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
      </div>
    </aside>
  );
}
