/**
 * "How are these connected?" panel — top-center, under the toolbar. Only
 * rendered while uiStore.pathMode is on; the toolbar toggle and the 3D
 * node-click handler (which appends picked endpoints) already exist
 * elsewhere. This component owns just the two-endpoint → route pipeline:
 * BFS the shortest path (pathfinding.ts), feed it into the scene's existing
 * search-emphasis dimming (uiStore.searchResults) and frame it, then render
 * the hop-by-hop route.
 */

import { useEffect, useMemo, type ReactNode } from 'react';
import { shortestPath } from '../graph/pathfinding';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

export default function PathPanel() {
  const pathMode = useUiStore((s) => s.pathMode);
  const pathEndpoints = useUiStore((s) => s.pathEndpoints);
  const setPathMode = useUiStore((s) => s.setPathMode);
  const setSearchResults = useUiStore((s) => s.setSearchResults);
  const sendCamera = useUiStore((s) => s.sendCamera);
  const setSelected = useUiStore((s) => s.setSelected);

  const nodes = useGraphStore((s) => s.nodes);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);
  const edges = useGraphStore((s) => s.edges);

  const path = useMemo(() => {
    if (pathEndpoints.length !== 2) return null;
    return shortestPath(edges, pathEndpoints[0], pathEndpoints[1]);
  }, [pathEndpoints, edges]);

  // Feed the route (or the two endpoints, if none) into the scene's dimming
  // mechanism and frame it. Re-runs only when the route itself changes —
  // i.e. once per new pair of endpoints (or when the graph reshapes under
  // an already-picked pair).
  useEffect(() => {
    if (pathEndpoints.length < 2) {
      setSearchResults(null); // dropped back below 2 picks — clear the old highlight
      return;
    }
    if (path) {
      setSearchResults(path, 'path');
      sendCamera('frameSet', path);
    } else {
      setSearchResults(pathEndpoints, 'path');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, pathEndpoints.length]);

  if (!pathMode) return null;

  const titleOf = (id: string): string => nodes[nodeIndex[id]]?.title ?? id;

  const focusNode = (id: string): void => {
    setSelected(id);
    sendCamera('frameNode', [id]);
  };

  const close = (): void => {
    setSearchResults(null);
    setPathMode(false);
  };

  let body: ReactNode;
  if (pathEndpoints.length === 0) {
    body = <p className="path-panel__hint">Click a node to start a path.</p>;
  } else if (pathEndpoints.length === 1) {
    body = (
      <>
        <div className="path-panel__chip-row">
          <span className="path-panel__chip">{titleOf(pathEndpoints[0])}</span>
        </div>
        <p className="path-panel__hint">Click a second node.</p>
      </>
    );
  } else if (path) {
    const hops = path.length - 1;
    body = (
      <>
        <p className="path-panel__hop-count">
          {hops} {hops === 1 ? 'hop' : 'hops'}
        </p>
        <div className="path-panel__route">
          {path.map((id, i) => (
            <div className="path-panel__route-item" key={id}>
              {i > 0 && (
                <div className="path-panel__connector" aria-hidden="true">
                  ⌄
                </div>
              )}
              <button
                type="button"
                className="path-panel__row"
                title={`${titleOf(id)} — click to focus in the graph`}
                onClick={() => focusNode(id)}
              >
                {titleOf(id)}
              </button>
            </div>
          ))}
        </div>
      </>
    );
  } else {
    body = (
      <p className="path-panel__hint">No connection found between these documents.</p>
    );
  }

  return (
    <div className="path-panel glass-panel">
      <div className="path-panel__header">
        <h2 className="path-panel__title">How are these connected?</h2>
        <button
          type="button"
          className="icon-btn-close"
          title="Close path finder"
          aria-label="Close path finder"
          onClick={close}
        >
          ✕
        </button>
      </div>
      <div className="path-panel__body">{body}</div>
    </div>
  );
}
