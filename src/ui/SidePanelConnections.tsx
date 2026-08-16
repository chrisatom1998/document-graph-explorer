import { type CSSProperties } from 'react';
import { EDGE_KIND_HEX, EDGE_KIND_LABEL } from '../scene/palette';
import { CONNECTIONS_COLLAPSED, EVIDENCE_COLLAPSED, type ConnectionRow } from './sidePanelModel';
import { focusNode } from './focusNode';
import { openCompare } from './openCompare';

interface SidePanelConnectionsProps {
  sourceId?: string;
  connections: ConnectionRow[];
  showAllConnections: boolean;
  expandedEvidence: ReadonlySet<string>;
  onToggleShowAll: () => void;
  onToggleEvidence: (edgeId: string) => void;
}

export default function SidePanelConnections({
  sourceId,
  connections,
  showAllConnections,
  expandedEvidence,
  onToggleShowAll,
  onToggleEvidence,
}: SidePanelConnectionsProps) {
  const visibleConnections = showAllConnections
    ? connections
    : connections.slice(0, CONNECTIONS_COLLAPSED);
  const hiddenConnections = connections.length - visibleConnections.length;

  return (
    <div className="side-panel__disclose-body">
      <div className="side-panel__connections">
        {visibleConnections.map(({ edge, neighborId, neighbor }) => {
          const evidenceOpen = expandedEvidence.has(edge.id);
          const shownEvidence = evidenceOpen
            ? edge.evidence
            : edge.evidence.slice(0, EVIDENCE_COLLAPSED);
          const hiddenEvidence = edge.evidence.length - shownEvidence.length;
          return (
            <div
              className="connection-row"
              key={edge.id}
              style={{ '--connection-kind': EDGE_KIND_HEX[edge.kind] } as CSSProperties}
            >
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
                  onClick={() => focusNode(neighborId)}
                >
                  {neighbor?.title ?? neighborId}
                </button>
                <span
                  className="connection-row__kind"
                  title={`${EDGE_KIND_LABEL[edge.kind]} connection`}
                >
                  {EDGE_KIND_LABEL[edge.kind]}
                </span>
                {sourceId !== undefined && neighbor?.kind === 'document' && (
                  <button
                    type="button"
                    className="connection-row__compare"
                    title={`Compare with ${neighbor.title}`}
                    onClick={() => openCompare(sourceId, neighborId)}
                  >
                    Compare
                  </button>
                )}
              </div>
              <div className="connection-row__weight-track">
                <div
                  className="connection-row__weight-fill"
                  style={{ width: `${Math.round(edge.weight * 100)}%` }}
                />
              </div>
              {shownEvidence.length > 0 && (
                <ul className="connection-row__evidence">
                  {shownEvidence.map((ev, i) => (
                    <li key={i}>{ev}</li>
                  ))}
                </ul>
              )}
              {(hiddenEvidence > 0 || evidenceOpen) && (
                <button
                  type="button"
                  className="connection-row__more"
                  title={
                    evidenceOpen
                      ? 'Collapse this connection’s evidence'
                      : 'Show the rest of the evidence for this connection'
                  }
                  onClick={() => onToggleEvidence(edge.id)}
                >
                  {evidenceOpen ? 'Show less evidence' : `+${hiddenEvidence} more`}
                </button>
              )}
            </div>
          );
        })}
        {connections.length === 0 && (
          <p className="side-panel__summary is-fallback">
            No connections yet.
          </p>
        )}
      </div>
      {(hiddenConnections > 0 || showAllConnections) && (
        <button
          type="button"
          className="side-panel__show-all"
          title={
            showAllConnections
              ? 'Show only the strongest connections'
              : 'Show every connection for this document'
          }
          onClick={onToggleShowAll}
        >
          {showAllConnections
            ? `Show top ${CONNECTIONS_COLLAPSED}`
            : `Show all ${connections.length} connections`}
        </button>
      )}
    </div>
  );
}
