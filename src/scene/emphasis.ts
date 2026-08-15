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

// WeakMap keyed on the edges array (immutable in the store): several live
// consumers may pass different array identities per frame, and a single-entry
// cache made them evict each other (one hover rebuilt adjacency 2-3x).
// Entries are released with the arrays themselves.
const adjacencyCache = new WeakMap<Edge[], Map<string, Set<string>>>();

/** buildAdjacency memoized on edges identity (edges array is immutable in the store). */
export function adjacencyFor(edges: Edge[]): Map<string, Set<string>> {
  let adjacency = adjacencyCache.get(edges);
  if (!adjacency) {
    adjacency = buildAdjacency(edges);
    adjacencyCache.set(edges, adjacency);
  }
  return adjacency;
}

export function isFilterActive(filter: GraphFilter): boolean {
  return (
    filter.fileTypes !== null ||
    filter.clusters !== null ||
    filter.minDegree > 0 ||
    filter.minEdgeWeight > 0 ||
    (filter.edgeKinds !== null && filter.edgeKinds.length > 0) ||
    (filter.modifiedWithinDays !== null && filter.modifiedWithinDays > 0)
  );
}

function kindOk(edges: Edge[], filter: GraphFilter): Set<string> | null {
  const kinds = filter.edgeKinds;
  if (!kinds || kinds.length === 0) return null;
  const allowed = new Set(kinds);
  const ok = new Set<string>();
  for (const e of edges) {
    if (e.kind === 'topic') continue;
    if (!allowed.has(e.kind)) continue;
    ok.add(e.source);
    ok.add(e.target);
  }
  return ok;
}

function weightOk(edges: Edge[], filter: GraphFilter): Set<string> | null {
  if (filter.minEdgeWeight <= 0) return null;
  const ok = new Set<string>();
  for (const e of edges) {
    if (e.weight >= filter.minEdgeWeight) {
      ok.add(e.source);
      ok.add(e.target);
    }
  }
  return ok;
}

function recencyOk(node: DocNode, filter: GraphFilter, now: number): boolean {
  const days = filter.modifiedWithinDays;
  if (days === null || days <= 0) return true;
  if (node.lastModified === undefined) return false;
  return now - node.lastModified <= days * 86_400_000;
}

// nodesMatchingFilter memoized the same way adjacencyFor is: WeakMap keyed on
// the nodes array, validated against the edges/filter identities. Several
// consumers run per frame (Nodes/Edges/ClusterBridges via computeEmphasis,
// SearchOverlay, collab anchors) with the same store triple, so they share one
// computation. `now` only matters at day granularity (modifiedWithinDays), so
// a small tolerance keeps default-`Date.now()` callers on the cached result.
interface FilterMemo {
  edges: Edge[];
  filter: GraphFilter;
  now: number;
  result: Set<string>;
}
const filterCache = new WeakMap<DocNode[], FilterMemo>();
const FILTER_NOW_TOLERANCE_MS = 1000;

/** Nodes that pass the active filter facets (AND). Empty filter → every node.
 * The returned Set is shared via the memo above — treat it as read-only. */
export function nodesMatchingFilter(
  nodes: DocNode[],
  edges: Edge[],
  filter: GraphFilter,
  now: number = Date.now(),
): Set<string> | null {
  if (!isFilterActive(filter)) return null;
  const memo = filterCache.get(nodes);
  if (
    memo &&
    memo.edges === edges &&
    memo.filter === filter &&
    Math.abs(now - memo.now) <= FILTER_NOW_TOLERANCE_MS
  ) {
    return memo.result;
  }
  const byWeight = weightOk(edges, filter);
  const byKind = kindOk(edges, filter);
  const topicDegree = new Map<string, number>();
  if (filter.minDegree > 0) {
    for (const edge of edges) {
      if (edge.kind !== 'topic') continue;
      topicDegree.set(edge.source, (topicDegree.get(edge.source) ?? 0) + 1);
      topicDegree.set(edge.target, (topicDegree.get(edge.target) ?? 0) + 1);
    }
  }
  const set = new Set<string>();
  for (const n of nodes) {
    if (filter.fileTypes && !filter.fileTypes.includes(n.fileType)) continue;
    if (filter.clusters && !filter.clusters.includes(n.cluster)) continue;
    // Node.degree intentionally includes topic-hub edges for sizing and hub
    // displays. The filter is labelled "connections to other documents", so
    // subtract those synthetic edges rather than letting hidden hubs inflate
    // a document past the selected floor.
    const documentDegree = n.degree - (topicDegree.get(n.id) ?? 0);
    if (documentDegree < filter.minDegree) continue;
    if (byWeight && !byWeight.has(n.id)) continue;
    if (byKind && n.kind === 'document' && !byKind.has(n.id)) continue;
    if (!recencyOk(n, filter, now)) continue;
    set.add(n.id);
  }
  filterCache.set(nodes, { edges, filter, now, result: set });
  return set;
}

/**
 * The emphasis set for the active dim trigger, or null when nothing dims.
 * Precedence: hover > selection > (search ∩ filter) > filter (spec §7.3).
 * Search and filters compose: search hits that fail the active filter drop
 * out, then neighbors of the remaining hits are added for context.
 */
export function computeEmphasis(
  nodes: DocNode[],
  edges: Edge[],
  hoveredId: string | null,
  selectedId: string | null,
  searchResults: string[] | null,
  filter: GraphFilter,
  now: number = Date.now(),
): Set<string> | null {
  const focusId = hoveredId ?? selectedId;
  if (focusId) {
    const set = new Set<string>([focusId]);
    const neighbors = adjacencyFor(edges).get(focusId);
    if (neighbors) for (const id of neighbors) set.add(id);
    return set;
  }
  const allowed = nodesMatchingFilter(nodes, edges, filter, now);
  if (searchResults) {
    const hits = allowed ? searchResults.filter((id) => allowed.has(id)) : searchResults;
    const set = new Set<string>();
    const adjacency = adjacencyFor(edges);
    for (const id of hits) {
      set.add(id);
      const neighbors = adjacency.get(id);
      if (neighbors) for (const n of neighbors) set.add(n);
    }
    return set;
  }
  return allowed;
}
