import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { useActiveOptionScroll } from './useActiveOptionScroll';
import { fileTypeChip, selectedDocumentTitle } from '../pipeline/codeLanguage';
import { focusNode } from './focusNode';
import { applyComparePick } from './openCompare';

const SUMMARY_ID = 'graph-navigator-summary';
const INSTRUCTIONS_ID = 'graph-navigator-instructions';

function optionId(index: number): string {
  return `graph-navigator-option-${index}`;
}

/**
 * Keyboard and screen-reader companion to the WebGL scene.
 *
 * A compact overview expands into a node picker for mouse and keyboard users.
 * The data comes from graphStore rather than render
 * buffers so it remains complete when the scene is collapsed or simplified.
 */
export default function GraphNavigator() {
  const nodes = useGraphStore((state) => state.nodes);
  const edgeCount = useGraphStore((state) => state.edges.length);
  const selectedId = useUiStore((state) => state.selectedId);
  const comparePick = useUiStore((state) => state.comparePick);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setExpanded(false);
    };
    window.addEventListener('pointerdown', closeOutside);
    return () => window.removeEventListener('pointerdown', closeOutside);
  }, [expanded]);

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

  const activeIndex = Math.max(0, orderedNodes.findIndex((node) => node.id === activeId));
  useActiveOptionScroll(orderedNodes.length > 0 ? optionId(activeIndex) : undefined);
  const documentCount = orderedNodes.filter((node) => node.kind === 'document').length;
  const topicCount = orderedNodes.length - documentCount;
  const clusterCount = new Set(
    orderedNodes.filter((node) => node.kind === 'document' && node.cluster >= 0).map((node) => node.cluster),
  ).size;

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
      if (useUiStore.getState().comparePick) {
        if (node.kind === 'document') applyComparePick(node.id);
        return;
      }
      focusNode(node.id);
    }
  };

  if (orderedNodes.length === 0) return null;

  return (
    <aside
      ref={rootRef}
      className={`graph-navigator glass-panel${expanded ? ' is-expanded' : ''}${comparePick ? ' is-picking' : ''}`}
      aria-label="Accessible graph navigator"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expanded) {
          event.preventDefault();
          event.stopPropagation();
          setExpanded(false);
          toggleRef.current?.focus();
        }
      }}
    >
      <button
        ref={toggleRef}
        type="button"
        className="graph-navigator__toggle"
        aria-label="Browse documents"
        aria-expanded={expanded}
        aria-controls="graph-navigator-content"
        onClick={() => setExpanded((value) => !value)}
      >
        <span><strong>{documentCount}</strong> {documentCount === 1 ? 'document' : 'documents'}</span>
        <span className="graph-navigator__chevron" aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>
      <p className="graph-navigator__overview">{clusterCount} {clusterCount === 1 ? 'cluster' : 'clusters'} · {edgeCount} {edgeCount === 1 ? 'connection' : 'connections'}</p>
      <p className="sr-only graph-navigator__summary" id={SUMMARY_ID}>
        {documentCount} {documentCount === 1 ? 'document' : 'documents'}, {topicCount}{' '}
        {topicCount === 1 ? 'topic hub' : 'topic hubs'}, {edgeCount}{' '}
        {edgeCount === 1 ? 'connection' : 'connections'}, {clusterCount}{' '}
        {clusterCount === 1 ? 'cluster' : 'clusters'}.
      </p>
      <div id="graph-navigator-content" hidden={!expanded}>
        <p className="graph-navigator__instructions" id={INSTRUCTIONS_ID}>
          Choose a document to explore its connections.
          <span> ↑ ↓ to browse · Enter to open · Esc to close</span>
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
          {orderedNodes.map((node, index) => (
            <div
              id={optionId(index)}
              key={node.id}
              className={`graph-navigator__option${index === activeIndex ? ' is-active' : ''}`}
              role="option"
              aria-selected={node.id === selectedId}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                listRef.current?.focus();
                setActiveId(node.id);
                if (useUiStore.getState().comparePick) {
                  if (node.kind === 'document') applyComparePick(node.id);
                  return;
                }
                focusNode(node.id);
              }}
            >
              <span className="graph-navigator__name">{node.id === selectedId ? selectedDocumentTitle(node) : node.title}</span>
              <span className="graph-navigator__meta">
                {node.kind === 'topic'
                  ? 'Topic hub'
                  : `${fileTypeChip(node).toUpperCase()} · ${node.degree} connection${node.degree === 1 ? '' : 's'}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
