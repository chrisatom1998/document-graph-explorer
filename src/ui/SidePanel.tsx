import { useEffect, useMemo, useState } from 'react';
import { DUP_SIM_THRESHOLD } from '../config';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { docVectorStore, textStore } from '../store/runtimeStores';
import { EDGE_KIND_HEX, EDGE_KIND_LABEL, hexFor } from '../scene/palette';
import { canonicalizeTopic } from '../pipeline/topics';
import { removeDocuments } from '../pipeline/coordinator';
import { timeAgo } from '../util/relativeTime';
import DocAiSection from './DocAiSection';
import { AIRGAP } from '../airgap';
import { openDocument } from './openDocument';
import VirtualText from './VirtualText';
import { useSettingsStore } from '../store/settingsStore';
import type { DocNode, Edge } from '../model/types';

interface ConnectionRow {
  edge: Edge;
  neighborId: string;
  neighbor: DocNode | undefined;
}

function isMonoFileType(fileType: DocNode['fileType']): boolean {
  return fileType === 'txt' || fileType === 'json' || fileType === 'yaml' || fileType === 'csv' || fileType === 'other';
}

export default function SidePanel() {
  const selectedId = useUiStore((s) => s.selectedId);
  const setSelected = useUiStore((s) => s.setSelected);
  const sendCamera = useUiStore((s) => s.sendCamera);
  const offlineMode = useSettingsStore((s) => s.offlineMode);

  const nodes = useGraphStore((s) => s.nodes);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);
  const edges = useGraphStore((s) => s.edges);
  const clusterNames = useGraphStore((s) => s.clusterNames);
  const localClusterNames = useGraphStore((s) => s.localClusterNames);

  const node = selectedId !== null ? nodes[nodeIndex[selectedId]] : undefined;

  // Two-step inline confirm for the destructive Remove action. Reset whenever
  // the selection changes so an armed confirm never lingers onto a different
  // document (or survives the panel closing and reopening).
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    setConfirmRemove(false);
  }, [selectedId]);

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

  // Near-duplicates of THIS doc: exact vector cosine against every other
  // document, not just existing semantic-edge neighbors — a genuine
  // duplicate can be crowded out of the mutual-top-k edge rule by other
  // near-duplicates (see similarity.ts), so scanning edges alone would miss
  // it. O(n) for the selected node only, cheap enough for the main thread.
  const duplicatesOf = useMemo<{ id: string; sim: number }[]>(() => {
    if (!node) return [];
    const va = docVectorStore.get(node.id);
    if (!va) return [];
    const out: { id: string; sim: number }[] = [];
    for (const other of nodes) {
      if (other.id === node.id || other.kind !== 'document') continue;
      const vb = docVectorStore.get(other.id);
      if (!vb || vb.length !== va.length) continue;
      let dot = 0;
      for (let d = 0; d < va.length; d += 1) dot += va[d] * vb[d];
      if (dot >= DUP_SIM_THRESHOLD) out.push({ id: other.id, sim: dot });
    }
    out.sort((x, y) => y.sim - x.sim);
    return out;
  }, [node, nodes]);

  if (!node) return null;

  const fullText = textStore.get(node.id);
  const clusterLabel =
    clusterNames[node.cluster] ?? localClusterNames[node.cluster] ?? `Cluster ${node.cluster}`;
  const clusterColor = hexFor(node.cluster);
  const entities = node.entities.slice(0, 8);

  return (
    <div className="side-panel-layer">
      <div className="side-panel glass-panel">
        <div className="side-panel__header">
          <h2 className="side-panel__title">{node.title}</h2>
          {node.kind === 'document' && (
            <button
              type="button"
              className="side-panel__open-btn"
              title="Open the original file — opens with your default app for this type"
              onClick={() => void openDocument(node.id)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <path d="M9 2h5v5" />
                <path d="M14 2 L7 9" />
                <path d="M12 9v4.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5H7" />
              </svg>
              Open
            </button>
          )}
          {node.kind === 'document' && !confirmRemove && (
            <button
              type="button"
              className="side-panel__open-btn side-panel__remove-btn"
              title="Remove this document from the graph and delete its cached data — the file on disk is untouched"
              onClick={() => setConfirmRemove(true)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <path d="M3 4.5h10" />
                <path d="M6 4.5V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v2" />
                <path d="M4.5 4.5l.6 8.6a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.6" />
              </svg>
              Remove
            </button>
          )}
          {node.kind === 'document' && confirmRemove && (
            <div className="side-panel__remove-confirm">
              <span className="side-panel__remove-confirm-text">
                Remove from graph? This also deletes its cached data — the
                file on disk is untouched.
              </span>
              <button
                type="button"
                className="side-panel__open-btn side-panel__remove-btn side-panel__remove-confirm-btn"
                title="Permanently remove this document and its cached data"
                onClick={() => {
                  void removeDocuments([node.id]);
                  setSelected(null);
                }}
              >
                Confirm
              </button>
              <button
                type="button"
                className="side-panel__open-btn"
                title="Keep this document"
                onClick={() => setConfirmRemove(false)}
              >
                Cancel
              </button>
            </div>
          )}
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
            {node.lastModified !== undefined && (
              <span title={new Date(node.lastModified).toLocaleString()}>
                updated {timeAgo(node.lastModified)}
              </span>
            )}
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
                {node.topics.map((t) => {
                  // A topic becomes a hub node when ≥2 docs share it. When one
                  // exists, the chip jumps to that hub — where the Connections
                  // list shows every document carrying the topic — and shows
                  // how many docs that is. Otherwise it's a plain label.
                  const hub = nodes[nodeIndex[`topic:${canonicalizeTopic(t)}`]];
                  if (!hub || hub.id === node.id) {
                    return (
                      <span key={t} className="chip">
                        {t}
                      </span>
                    );
                  }
                  return (
                    <button
                      key={t}
                      type="button"
                      className="chip chip-selectable side-panel__topic-chip"
                      title={`${hub.degree} document${hub.degree === 1 ? '' : 's'} share this topic — open the topic hub`}
                      onClick={() => {
                        setSelected(hub.id);
                        sendCamera('frameNode', [hub.id]);
                      }}
                    >
                      {t}
                      <span className="side-panel__topic-count">{hub.degree}</span>
                    </button>
                  );
                })}
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

          {!(AIRGAP || offlineMode) && fullText && (
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
                      style={{ background: EDGE_KIND_HEX[edge.kind] }}
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
                    <span
                      className="connection-row__kind"
                      title={`${EDGE_KIND_LABEL[edge.kind]} connection`}
                    >
                      {EDGE_KIND_LABEL[edge.kind]}
                    </span>
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
              <VirtualText
                key={node.id}
                text={fullText}
                className={`side-panel__reader${
                  isMonoFileType(node.fileType) ? ' is-mono' : ''
                }`}
              />
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
