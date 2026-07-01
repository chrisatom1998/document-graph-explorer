import { useMemo } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { textStore } from '../store/runtimeStores';
import { hexFor } from '../scene/palette';
import type { DocNode, Edge, EdgeKind } from '../model/types';

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

  if (!node) return null;

  const fullText = textStore.get(node.id);
  const clusterLabel = clusterNames[node.cluster] ?? `Cluster ${node.cluster}`;
  const clusterColor = hexFor(node.cluster);
  const entities = node.entities.slice(0, 8);

  return (
    <div className="side-panel-layer">
      <div className="side-panel glass-panel">
        <div className="side-panel__scroll">
          <div className="side-panel__header">
            <h2 className="side-panel__title">{node.title}</h2>
            <button
              type="button"
              className="icon-btn-close"
              title="Close"
              onClick={() => setSelected(null)}
            >
              ✕
            </button>
          </div>

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
