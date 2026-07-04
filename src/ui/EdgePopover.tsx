import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { EDGE_KIND_HEX, EDGE_KIND_LABEL } from '../scene/palette';

/** Bottom-center popover for a clicked edge (spec §7.3 "Click edge"). */
export default function EdgePopover() {
  const selectedEdgeId = useUiStore((s) => s.selectedEdgeId);
  const setSelectedEdge = useUiStore((s) => s.setSelectedEdge);
  const setSelected = useUiStore((s) => s.setSelected);

  const edges = useGraphStore((s) => s.edges);
  const nodes = useGraphStore((s) => s.nodes);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);

  if (!selectedEdgeId) return null;
  const edge = edges.find((e) => e.id === selectedEdgeId);
  if (!edge) return null;

  const source = nodes[nodeIndex[edge.source]];
  const target = nodes[nodeIndex[edge.target]];
  const color = EDGE_KIND_HEX[edge.kind];

  return (
    <div className="edge-popover-layer">
      <div className="edge-popover glass-panel">
        <div className="edge-popover__header">
          <p className="edge-popover__label">Connection</p>
          <span
            className="edge-kind-badge"
            style={{ color, borderColor: color }}
          >
            <span className="chip-dot" style={{ background: color }} aria-hidden="true" />
            {EDGE_KIND_LABEL[edge.kind]}
          </span>
          <button
            type="button"
            className="icon-btn-close"
            title="Close"
            onClick={() => setSelectedEdge(null)}
          >
            ✕
          </button>
        </div>

        <div className="edge-popover__pair">
          <button
            type="button"
            className="edge-popover__doc-btn"
            title={source?.title ?? edge.source}
            onClick={() => setSelected(edge.source)}
          >
            {source?.title ?? edge.source}
          </button>
          <span className="edge-popover__arrow">↔</span>
          <button
            type="button"
            className="edge-popover__doc-btn"
            title={target?.title ?? edge.target}
            onClick={() => setSelected(edge.target)}
          >
            {target?.title ?? edge.target}
          </button>
        </div>

        <div className="edge-popover__weight-track">
          <div
            className="edge-popover__weight-fill"
            style={{ width: `${Math.round(edge.weight * 100)}%` }}
          />
        </div>

        <p className="edge-popover__label" style={{ marginTop: 14 }}>
          Why
        </p>
        <ul className="edge-popover__why">
          {edge.evidence.map((ev, i) => (
            <li key={i}>{ev}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
