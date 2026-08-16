/**
 * Side-by-side document comparison. A slim pick banner while the second
 * document is still being chosen; a wide reader overlay once both sides
 * are set. Relationship chips are local (embeddings, topics, edges) — no LLM.
 */

import { useEffect, useMemo, useState } from 'react';
import { comparePair } from '../graph/comparePair';
import { EDGE_KIND_LABEL } from '../scene/palette';
import { codeLanguageForNode, fileTypeLabel } from '../pipeline/codeLanguage';
import { docVectorStore } from '../store/runtimeStores';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import {
  closeCompare,
  startComparePick,
  swapCompare,
} from './openCompare';
import CloseButton from './CloseButton';
import { focusNode } from './focusNode';
import SidePanelReader from './SidePanelReader';

function titleOf(
  id: string | null,
  nodes: ReturnType<typeof useGraphStore.getState>['nodes'],
  nodeIndex: Record<string, number>,
): string {
  if (!id) return 'Choose a document';
  return nodes[nodeIndex[id]]?.title ?? id;
}

export default function ComparePanel() {
  const leftId = useUiStore((s) => s.compareLeftId);
  const rightId = useUiStore((s) => s.compareRightId);
  const comparePick = useUiStore((s) => s.comparePick);
  const [needles, setNeedles] = useState<{ left?: string; right?: string } | null>(null);

  const nodes = useGraphStore((s) => s.nodes);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);
  const edges = useGraphStore((s) => s.edges);

  const left = leftId ? nodes[nodeIndex[leftId]] : undefined;
  const right = rightId ? nodes[nodeIndex[rightId]] : undefined;
  const leftVector = left ? docVectorStore.get(left.id) : undefined;
  const rightVector = right ? docVectorStore.get(right.id) : undefined;
  const complete = leftId !== null && rightId !== null;

  useEffect(() => {
    if (!leftId && !rightId && !comparePick) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeCompare();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [leftId, rightId, comparePick]);

  const summary = useMemo(() => {
    if (!left || !right || left.kind !== 'document' || right.kind !== 'document') return null;
    return comparePair({
      left,
      right,
      edges,
      leftVector,
      rightVector,
    });
  }, [left, right, edges, leftVector, rightVector]);

  if (!leftId && !rightId && !comparePick) return null;

  if (!complete) {
    const seedTitle = titleOf(leftId ?? rightId, nodes, nodeIndex);
    return (
      <div className="path-panel glass-panel" role="status" aria-label="Compare documents">
        <div className="path-panel__header">
          <h2 className="path-panel__title">Compare documents</h2>
          <CloseButton
            title="Cancel compare"
            aria-label="Cancel compare"
            onClick={() => closeCompare()}
          />
        </div>
        <div className="path-panel__body">
          <div className="path-panel__chip-row">
            <span className="path-panel__chip">{seedTitle}</span>
          </div>
          <p className="path-panel__hint">Click another document to compare.</p>
        </div>
      </div>
    );
  }

  if (!left || !right) return null;

  const leftLang = codeLanguageForNode(left);
  const rightLang = codeLanguageForNode(right);
  const highlightTerm = (term: string) => {
    setNeedles({ left: term, right: term });
  };
  const navigateFromCompare = (id: string) => {
    closeCompare();
    focusNode(id);
  };

  return (
    <div className="compare-panel-layer">
      <div className="compare-panel glass-panel" role="dialog" aria-label="Compare documents">
        <div className="compare-panel__header">
          <div className="compare-panel__titles">
            <div className="compare-panel__side-head">
              <h2 className="compare-panel__title">{left.title}</h2>
              <button
                type="button"
                className="compare-panel__text-btn"
                title="Click a document in the graph to replace the left pane"
                onClick={() => startComparePick('left')}
              >
                Change
              </button>
            </div>
            <button
              type="button"
              className="compare-panel__swap"
              title="Swap left and right"
              aria-label="Swap left and right"
              onClick={() => {
                setNeedles((prev) => (prev ? { left: prev.right, right: prev.left } : null));
                swapCompare();
              }}
            >
              ⇄
            </button>
            <div className="compare-panel__side-head">
              <h2 className="compare-panel__title">{right.title}</h2>
              <button
                type="button"
                className="compare-panel__text-btn"
                title="Click a document in the graph to replace the right pane"
                onClick={() => startComparePick('right')}
              >
                Change
              </button>
            </div>
          </div>
          <CloseButton
            title="Close compare"
            aria-label="Close compare"
            onClick={() => closeCompare()}
          />
        </div>

        {comparePick && (
          <p className="compare-panel__pick-hint" role="status">
            Click a document in the graph to replace the {comparePick} side.
          </p>
        )}

        {summary && (
          <div className="compare-panel__strip">
            {summary.similarity !== null && (
              <span
                className={`chip${summary.nearDuplicate ? ' side-panel__badge-warning' : ''}`}
                title={
                  summary.nearDuplicate
                    ? 'These documents are near-duplicates by embedding similarity'
                    : 'Embedding cosine similarity'
                }
              >
                {Math.round(summary.similarity * 1000) / 10}% similar
                {summary.nearDuplicate ? ' · near-duplicate' : ''}
              </span>
            )}
            {summary.edges.map((edge) => (
              <span
                key={edge.id}
                className="chip"
                title={
                  edge.evidence.length > 0
                    ? edge.evidence.join(' · ')
                    : `${EDGE_KIND_LABEL[edge.kind]} connection`
                }
              >
                {EDGE_KIND_LABEL[edge.kind]} · {Math.round(edge.weight * 100)}%
              </span>
            ))}
            {summary.sharedTopics.map((term) => (
              <button
                key={`topic:${term}`}
                type="button"
                className="chip chip-selectable"
                title="Highlight this shared topic in both readers"
                onClick={() => highlightTerm(term)}
              >
                Topic · {term}
              </button>
            ))}
            {summary.sharedEntities.map((term) => (
              <button
                key={`entity:${term}`}
                type="button"
                className="chip chip-selectable"
                title="Highlight this shared entity in both readers"
                onClick={() => highlightTerm(term)}
              >
                Entity · {term}
              </button>
            ))}
            {summary.sharedKeywords.map((term) => (
              <button
                key={`kw:${term}`}
                type="button"
                className="chip chip-selectable"
                title="Highlight this shared keyword in both readers"
                onClick={() => highlightTerm(term)}
              >
                {term}
              </button>
            ))}
            {summary.similarity === null &&
              summary.edges.length === 0 &&
              summary.sharedTopics.length === 0 &&
              summary.sharedEntities.length === 0 &&
              summary.sharedKeywords.length === 0 && (
                <span className="compare-panel__strip-empty">
                  No shared topics, keywords, or direct connection in the graph.
                </span>
              )}
          </div>
        )}

        {summary && summary.edges.some((edge) => edge.evidence.length > 0) && (
          <ul className="compare-panel__evidence">
            {summary.edges.flatMap((edge) =>
              edge.evidence.slice(0, 3).map((line, i) => (
                <li key={`${edge.id}:${i}`}>{line}</li>
              )),
            )}
          </ul>
        )}

        <div className="compare-panel__panes">
          <div className="compare-panel__pane">
            <SidePanelReader
              node={left}
              nodes={nodes}
              readerHighlight={
                needles?.left ? { docId: left.id, text: needles.left } : null
              }
              readerLabel={leftLang?.label ?? fileTypeLabel(left)}
              codeLang={leftLang}
              onNavigate={navigateFromCompare}
            />
          </div>
          <div className="compare-panel__pane">
            <SidePanelReader
              node={right}
              nodes={nodes}
              readerHighlight={
                needles?.right ? { docId: right.id, text: needles.right } : null
              }
              readerLabel={rightLang?.label ?? fileTypeLabel(right)}
              codeLang={rightLang}
              onNavigate={navigateFromCompare}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
