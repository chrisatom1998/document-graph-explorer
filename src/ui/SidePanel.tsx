import { useMemo, useState } from 'react';
import { DUP_SIM_THRESHOLD } from '../config';
import { removeDocuments } from '../pipeline/coordinator';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { docVectorStore, textStore } from '../store/runtimeStores';
import { hexFor } from '../scene/palette';
import DocAiSection from './DocAiSection';
import type { DocNode, Edge, EdgeKind } from '../model/types';

function IconTrash() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

const KIND_COLOR: Record<EdgeKind, string> = {
  reference: '#ffb36b',
  semantic: '#7fb4ff',
  keyword: '#6f86e8',
  topic: '#7ee8c4',
};

interface ConnectionRow {
  edge: Edge;
  neighborId: string;
  neighbor: DocNode | undefined;
}

function isMonoFileType(fileType: DocNode['fileType']): boolean {
  return fileType === 'txt' || fileType === 'other';
}

export default function SidePanel() {
  const selectedId = useUiStore((s) => s.selectedId);
  const setSelected = useUiStore((s) => s.setSelected);
  const sendCamera = useUiStore((s) => s.sendCamera);

  const nodes = useGraphStore((s) => s.nodes);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);
  const edges = useGraphStore((s) => s.edges);
  const clusterNames = useGraphStore((s) => s.clusterNames);
  const phase = useGraphStore((s) => s.phase);

  // node.id must match for the strip to show, so switching nodes dismisses it
  const [confirmRemoveFor, setConfirmRemoveFor] = useState<string | null>(null);

  const node = selectedId !== null ? nodes[nodeIndex[selectedId]] : undefined;

  const connections = useMemo<ConnectionRow[]>(() => {
    if (!node) return [];
    const rows: ConnectionRow[] = [];
    for (const edge of edges) {
      let neighborId: string | null = null;
      if (edge.source === node.id) neighborId = edge.target;
      else if (edge.target === node.id) neighborId = edge.source;
      if (!neighborId) continue;
      const neighbor = nodes[nodeIndex[neighborId]];
      rows.push({ edge, neighborId, neighbor });
    }
    rows.sort((a, b) => b.edge.weight - a.edge.weight);
    return rows;
  }, [node, edges, nodes, nodeIndex]);

  // Near-duplicates of THIS doc: semantic neighbors whose exact vector cosine
  // clears DUP_SIM_THRESHOLD (same rule as the insights panel).
  const duplicatesOf = useMemo<{ id: string; sim: number }[]>(() => {
    if (!node) return [];
    const va = docVectorStore.get(node.id);
    if (!va) return [];
    const out: { id: string; sim: number }[] = [];
    for (const edge of edges) {
      if (edge.kind !== 'semantic') continue;
      const otherId =
        edge.source === node.id ? edge.target : edge.target === node.id ? edge.source : null;
      if (!otherId) continue;
      const vb = docVectorStore.get(otherId);
      if (!vb || vb.length !== va.length) continue;
      let dot = 0;
      for (let d = 0; d < va.length; d += 1) dot += va[d] * vb[d];
      if (dot >= DUP_SIM_THRESHOLD) out.push({ id: otherId, sim: dot });
    }
    out.sort((x, y) => y.sim - x.sim);
    return out;
  }, [node, edges]);

  if (!node) return null;

  const fullText = textStore.get(node.id);
  const clusterLabel = clusterNames[node.cluster] ?? `Cluster ${node.cluster}`;
  const clusterColor = hexFor(node.cluster);
  const entities = node.entities.slice(0, 8);

  return (
    <div className="side-panel-layer">
      <div className="side-panel glass-panel">
        <div className="side-panel__header">
          <h2 className="side-panel__title">{node.title}</h2>
          <button
            type="button"
            className="icon-btn-close"
            title={
              phase === 'ready'
                ? 'Remove from knowledge bank'
                : 'Wait for processing to finish'
            }
            aria-label="Remove document from knowledge bank"
            disabled={phase !== 'ready'}
            onClick={() => setConfirmRemoveFor(node.id)}
          >
            <IconTrash />
          </button>
          <button
            type="button"
            className="icon-btn-close"
            title="Back to graph"
            aria-label="Back to graph"
            onClick={() => setSelected(null)}
          >
            ✕
          </button>
        </div>
        {confirmRemoveFor === node.id && (
          <div className="side-panel__remove-confirm">
            <p className="side-panel__remove-confirm-text">
              Remove “{node.title}” from the knowledge bank? Its text and
              embeddings are deleted from this browser; re-drop the file to add
              it back.
            </p>
            <div className="side-panel__remove-confirm-actions">
              <button
                type="button"
                className="btn-pill danger"
                onClick={() => {
                  setConfirmRemoveFor(null);
                  setSelected(null);
                  void removeDocuments([node.id]);
                }}
              >
                Remove
              </button>
              <button
                type="button"
                className="btn-pill secondary"
                onClick={() => setConfirmRemoveFor(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        <div className="side-panel__scroll">
          <div className="side-panel__badges">
            <span className="chip">{node.fileType}</span>
            <span className="chip">
              <span
                className="chip-dot"
                style={{ background: clusterColor }}
                aria-hidden="true"
              />
              {clusterLabel}
            </span>
            {node.status !== 'ok' && (
              <span className="chip side-panel__badge-warning">
                ⚠ {node.warning ?? node.status}
              </span>
            )}
            {duplicatesOf.map((d) => (
              <button
                key={d.id}
                type="button"
                className="chip chip-selectable side-panel__badge-warning side-panel__dup-chip"
                title={`${(d.sim * 100).toFixed(1)}% similar — these might be the same doc`}
                onClick={() => {
                  setSelected(d.id);
                  sendCamera('frameNode', [d.id]);
                }}
              >
                ≈ duplicate of {nodes[nodeIndex[d.id]]?.title ?? d.id}
              </button>
            ))}
          </div>

          <div className="side-panel__stats">
            <span>{node.wordCount.toLocaleString()} words</span>
            <span>{node.degree} connection{node.degree === 1 ? '' : 's'}</span>
          </div>

          <div className="side-panel__section">
            <p className="side-panel__section-label">Summary</p>
            <p
              className={`side-panel__summary${node.summary ? '' : ' is-fallback'}`}
            >
              {node.summary || 'No summary available yet.'}
            </p>
          </div>

          {node.topics.length > 0 && (
            <div className="side-panel__section">
              <p className="side-panel__section-label">Topics</p>
              <div className="side-panel__chip-row">
                {node.topics.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {entities.length > 0 && (
            <div className="side-panel__section">
              <p className="side-panel__section-label">Entities</p>
              <div className="side-panel__chip-row">
                {entities.map((e) => (
                  <span key={e} className="chip chip-muted">
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}

          {fullText && (
            <>
              <hr className="hairline" />
              {/* key resets the Q&A state when the selection changes */}
              <DocAiSection key={node.id} docId={node.id} title={node.title} />
            </>
          )}

          <hr className="hairline" />

          <div className="side-panel__section">
            <p className="side-panel__section-label">
              Connections ({connections.length})
            </p>
            <div className="side-panel__connections">
              {connections.map(({ edge, neighborId, neighbor }) => (
                <div className="connection-row" key={edge.id}>
                  <div className="connection-row__main">
                    <span
                      className="chip-dot"
                      style={{ background: KIND_COLOR[edge.kind] }}
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      className="connection-row__title"
                      title={neighbor?.title ?? neighborId}
                      onClick={() => {
                        setSelected(neighborId);
                        sendCamera('frameNode', [neighborId]);
                      }}
                    >
                      {neighbor?.title ?? neighborId}
                    </button>
                  </div>
                  <div className="connection-row__weight-track">
                    <div
                      className="connection-row__weight-fill"
                      style={{ width: `${Math.round(edge.weight * 100)}%` }}
                    />
                  </div>
                  {edge.evidence.length > 0 && (
                    <ul className="connection-row__evidence">
                      {edge.evidence.map((ev, i) => (
                        <li key={i}>{ev}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {connections.length === 0 && (
                <p className="side-panel__summary is-fallback">
                  No connections yet.
                </p>
              )}
            </div>
          </div>

          <hr className="hairline" />

          <div className="side-panel__section">
            <p className="side-panel__section-label">Document</p>
            {fullText ? (
              <div
                className={`side-panel__reader${
                  isMonoFileType(node.fileType) ? ' is-mono' : ''
                }`}
              >
                {fullText}
              </div>
            ) : (
              <div className="side-panel__reader is-unavailable">
                text unavailable
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
