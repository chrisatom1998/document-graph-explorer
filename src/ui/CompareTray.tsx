import { useMemo } from 'react';
import type { DocNode, Edge } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { focusNode } from './focusNode';
import { fileTypeChip } from '../pipeline/codeLanguage';

const SUMMARY_CHARS = 160;
const LIST_CAP = 4;

function clusterLabelFor(node: DocNode, names: Record<number, string>, local: Record<number, string>): string {
  return names[node.cluster] ?? local[node.cluster] ?? (node.cluster < 0 ? 'Unclustered' : `Cluster ${node.cluster}`);
}

function topLinks(nodeId: string, edges: Edge[], nodes: DocNode[], index: Record<string, number>) {
  const rows: { title: string; evidence: string }[] = [];
  const ranked = edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, LIST_CAP);
  for (const edge of ranked) {
    const neighborId = edge.source === nodeId ? edge.target : edge.source;
    const neighbor = nodes[index[neighborId]];
    rows.push({
      title: neighbor?.title ?? neighborId,
      evidence: edge.evidence[0] ?? edge.kind,
    });
  }
  return rows;
}

export default function CompareTray() {
  const compareIds = useUiStore((s) => s.compareIds);
  const removeCompare = useUiStore((s) => s.removeCompare);
  const clearCompare = useUiStore((s) => s.clearCompare);
  const selectedId = useUiStore((s) => s.selectedId);
  const nodes = useGraphStore((s) => s.nodes);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);
  const edges = useGraphStore((s) => s.edges);
  const clusterNames = useGraphStore((s) => s.clusterNames);
  const localClusterNames = useGraphStore((s) => s.localClusterNames);

  const columns = useMemo(
    () =>
      compareIds
        .map((id) => nodes[nodeIndex[id]])
        .filter((node): node is DocNode => Boolean(node) && node.kind === 'document'),
    [compareIds, nodeIndex, nodes],
  );

  if (columns.length === 0) return null;

  return (
    <div className={`compare-tray-layer${selectedId ? ' is-shifted' : ''}`}>
      <section className="compare-tray glass-panel" aria-label="Pinned document comparison">
        <header className="compare-tray__head">
          <h2 className="compare-tray__title">Compare</h2>
          <span className="compare-tray__meta">
            {columns.length} of 4
          </span>
          <button
            type="button"
            className="compare-tray__clear"
            title="Clear the comparison tray"
            onClick={clearCompare}
          >
            Clear
          </button>
        </header>
        <div className={`compare-tray__grid compare-tray__grid--${columns.length}`}>
          {columns.map((node) => {
            const summary = (node.summary ?? '').trim();
            const links = topLinks(node.id, edges, nodes, nodeIndex);
            return (
              <article key={node.id} className="compare-tray__col">
                <div className="compare-tray__col-head">
                  <button
                    type="button"
                    className="compare-tray__doc"
                    title="Focus this document"
                    onClick={() => focusNode(node.id)}
                  >
                    {node.title}
                  </button>
                  <button
                    type="button"
                    className="compare-tray__unpin"
                    aria-label={`Remove ${node.title} from comparison`}
                    onClick={() => removeCompare(node.id)}
                  >
                    ×
                  </button>
                </div>
                <p className="compare-tray__chips">
                  <span className="chip">{fileTypeChip(node)}</span>
                  <span className="chip">{clusterLabelFor(node, clusterNames, localClusterNames)}</span>
                  <span className="chip">{node.degree} links</span>
                </p>
                <p className="compare-tray__summary">
                  {summary
                    ? summary.length > SUMMARY_CHARS
                      ? `${summary.slice(0, SUMMARY_CHARS - 1)}…`
                      : summary
                    : 'No summary yet.'}
                </p>
                <p className="compare-tray__label">Topics</p>
                <p className="compare-tray__values">
                  {node.topics.slice(0, LIST_CAP).join(', ') || '—'}
                </p>
                <p className="compare-tray__label">Entities</p>
                <p className="compare-tray__values">
                  {node.entities.slice(0, LIST_CAP).join(', ') || '—'}
                </p>
                <p className="compare-tray__label">Links</p>
                <ul className="compare-tray__links">
                  {links.length === 0 && <li>—</li>}
                  {links.map((link) => (
                    <li key={`${node.id}-${link.title}`}>
                      <span>{link.title}</span>
                      <span className="compare-tray__evidence">{link.evidence}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
