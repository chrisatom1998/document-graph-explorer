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
import { focusNode } from './focusNode';
import CloseButton from './CloseButton';

export default function PathPanel() {
  const pathMode = useUiStore((s) => s.pathMode);
  const pathEndpoints = useUiStore((s) => s.pathEndpoints);
  const setPathMode = useUiStore((s) => s.setPathMode);
  const setSearchResults = useUiStore((s) => s.setSearchResults);
  const sendCamera = useUiStore((s) => s.sendCamera);
  const addPathEndpoint = useUiStore((s) => s.addPathEndpoint);
  const selectedId = useUiStore((s) => s.selectedId);

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

  const close = (): void => {
    setSearchResults(null);
    setPathMode(false);
  };

  // Keyboard route to an endpoint: the node currently selected (via the
  // navigator, search or the inspector) can be taken as the next endpoint
  // without a canvas click. Topic hubs are skipped, as in the canvas handler.
  const selectedNode = selectedId ? nodes[nodeIndex[selectedId]] : undefined;
  const pickable = selectedNode && selectedNode.kind === 'document' && !pathEndpoints.includes(selectedNode.id)
    ? selectedNode
    : null;
  const pickLabel = pathEndpoints.length === 0
    ? 'as the start'
    : pathEndpoints.length === 1
      ? 'as the end'
      : 'to start a new path';
  const pickButton = pickable && (
    <button
      type="button"
      className="path-panel__pick"
      onClick={() => addPathEndpoint(pickable.id)}
    >
      Use “{pickable.title}” {pickLabel}
    </button>
  );

  // Spoken confirmation of each endpoint pick, whichever control made it.
  let announcement = '';
  if (pathEndpoints.length === 1) {
    announcement = `Path start: ${titleOf(pathEndpoints[0])}. Choose an end node.`;
  } else if (pathEndpoints.length === 2) {
    const hops = path ? path.length - 1 : 0;
    announcement = path
      ? `Path end: ${titleOf(pathEndpoints[1])}. ${hops} ${hops === 1 ? 'hop' : 'hops'} from ${titleOf(pathEndpoints[0])}.`
      : `Path end: ${titleOf(pathEndpoints[1])}. No connection found.`;
  }

  let body: ReactNode;
  if (pathEndpoints.length === 0) {
    body = (
      <>
        <p className="path-panel__hint">Choose a node to start a path.</p>
        {pickButton}
      </>
    );
  } else if (pathEndpoints.length === 1) {
    body = (
      <>
        <div className="path-panel__chip-row">
          <span className="path-panel__chip">{titleOf(pathEndpoints[0])}</span>
        </div>
        <p className="path-panel__hint">Choose a second node.</p>
        {pickButton}
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
        {pickButton}
      </>
    );
  } else {
    body = (
      <>
        <p className="path-panel__hint">No connection found between these documents.</p>
        {pickButton}
      </>
    );
  }

  return (
    <div className="path-panel glass-panel" role="dialog" aria-label="Connection path finder">
      <div className="path-panel__header">
        <h2 className="path-panel__title">How are these connected?</h2>
        <CloseButton
          title="Close path finder"
          aria-label="Close path finder"
          onClick={close}
        />
      </div>
      <div className="path-panel__body">{body}</div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    </div>
  );
}
