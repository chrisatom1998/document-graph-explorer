import { useMemo, useState } from 'react';
import type { EdgeKind } from '../model/types';
import { EDGE_KIND_HEX, EDGE_KIND_LABEL } from '../scene/palette';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import {
  DOCUMENT_EDGE_KINDS,
  toggleEdgeKindVisibility,
  visibleEdgeKinds,
} from './graphReadability';

export default function SceneLegend() {
  const [open, setOpen] = useState(false);
  const edges = useGraphStore((s) => s.edges);
  const edgeKinds = useUiStore((s) => s.filter.edgeKinds);
  const setFilter = useUiStore((s) => s.setFilter);
  const visible = visibleEdgeKinds(edgeKinds);

  const counts = useMemo(() => {
    const next: Record<EdgeKind, number> = {
      reference: 0,
      semantic: 0,
      keyword: 0,
      entity: 0,
      topic: 0,
    };
    for (const edge of edges) next[edge.kind] += 1;
    return next;
  }, [edges]);

  const kindsWithEdges = DOCUMENT_EDGE_KINDS.filter((kind) => counts[kind] > 0);
  if (kindsWithEdges.length === 0) return null;

  const hiddenCount = kindsWithEdges.filter((kind) => !visible.includes(kind)).length;

  return (
    <div className="scene-legend-wrap">
      <button
        type="button"
        className={`scene-legend__toggle glass-panel${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-controls="scene-legend-panel"
        title={open ? 'Hide connection types' : 'Show connection types'}
        onClick={() => setOpen((value) => !value)}
      >
        Links
        {hiddenCount > 0 && <span className="scene-legend__badge">{hiddenCount} hidden</span>}
      </button>
      {open && (
        <div id="scene-legend-panel" className="scene-legend glass-panel" aria-label="Connection legend">
          {kindsWithEdges.map((kind) => {
            const on = visible.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                className={`scene-legend__item${on ? ' is-on' : ''}`}
                aria-pressed={on}
                title={`${on ? 'Hide' : 'Show'} ${EDGE_KIND_LABEL[kind]} connections`}
                onClick={() => setFilter({ edgeKinds: toggleEdgeKindVisibility(edgeKinds, kind) })}
              >
                <span
                  className="scene-legend__swatch"
                  style={{ background: EDGE_KIND_HEX[kind] }}
                  aria-hidden="true"
                />
                <span>{EDGE_KIND_LABEL[kind]}</span>
                <span className="scene-legend__count">{counts[kind]}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
