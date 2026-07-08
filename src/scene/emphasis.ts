/**
 * Shared node/edge emphasis helpers (spec §7.3): the single source of truth
 * for hover/selection/search/filter dimming so Nodes, Edges, EdgePulses, and
 * Labels cannot diverge on which slots are "emphasized" this frame. Extracted
 * out of Nodes.tsx so Edges.tsx (and any future consumer) doesn't have to
 * import a component module just to reach the pure computation.
 */

import type { DocNode, Edge } from '../model/types';
import { buildAdjacency } from '../store/graphStore';
import type { GraphFilter } from '../store/uiStore';

let adjacencySource: Edge[] | null = null;
let adjacencyCache = new Map<string, Set<string>>();

/** buildAdjacency memoized on edges identity (edges array is immutable in the store). */
export function adjacencyFor(edges: Edge[]): Map<string, Set<string>> {
  if (adjacencySource !== edges) {
    adjacencySource = edges;
    adjacencyCache = buildAdjacency(edges);
  }
  return adjacencyCache;
}

/**
 * The emphasis set for the active dim trigger, or null when nothing dims.
 * Precedence: hover > selection > search > filter (spec §7.3).
 *  - hover: node + adjacency neighbors
 *  - selection (focus mode): selected node + neighbors — clicking a node
 *    dims everything not directly connected until it's deselected
 *  - search: results + their neighbors
 *  - filter: matching nodes only. fileTypes/clusters/minDegree/minEdgeWeight
 *    all compose with AND. minEdgeWeight keeps a node only if it is incident
 *    to at least one edge that clears the floor — the same floor Edges.tsx's
 *    isEdgeHidden applies (`e.weight < filter.minEdgeWeight` hides an edge,
 *    so `>=` is what keeps it, and its endpoints, visible), so the
 *    link-strength slider dims nodes and edges in agreement.
 */
export function computeEmphasis(
  nodes: DocNode[],
  edges: Edge[],
  hoveredId: string | null,
  selectedId: string | null,
  searchResults: string[] | null,
  filter: GraphFilter,
): Set<string> | null {
  const focusId = hoveredId ?? selectedId;
  if (focusId) {
    const set = new Set<string>([focusId]);
    const neighbors = adjacencyFor(edges).get(focusId);
    if (neighbors) for (const id of neighbors) set.add(id);
    return set;
  }
  if (searchResults) {
    const set = new Set<string>();
    const adjacency = adjacencyFor(edges);
    for (const id of searchResults) {
      set.add(id);
      const neighbors = adjacency.get(id);
      if (neighbors) for (const n of neighbors) set.add(n);
    }
    return set;
  }
  const filterActive =
    filter.fileTypes !== null ||
    filter.clusters !== null ||
    filter.minDegree > 0 ||
    filter.minEdgeWeight > 0;
  if (filterActive) {
    let weightOk: Set<string> | null = null;
    if (filter.minEdgeWeight > 0) {
      weightOk = new Set<string>();
      for (const e of edges) {
        if (e.weight >= filter.minEdgeWeight) {
          weightOk.add(e.source);
          weightOk.add(e.target);
        }
      }
    }
    const set = new Set<string>();
    for (const n of nodes) {
      if (filter.fileTypes && !filter.fileTypes.includes(n.fileType)) continue;
      if (filter.clusters && !filter.clusters.includes(n.cluster)) continue;
      if (n.degree < filter.minDegree) continue;
      if (weightOk && !weightOk.has(n.id)) continue;
      set.add(n.id);
    }
    return set;
  }
  return null;
}
