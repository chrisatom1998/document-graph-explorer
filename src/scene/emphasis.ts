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

/** Nodes that pass the active filter facets (AND). Empty filter → every node. */
export function nodesMatchingFilter(
  nodes: DocNode[],
  edges: Edge[],
  filter: GraphFilter,
  now: number = Date.now(),
): Set<string> | null {
  if (!isFilterActive(filter)) return null;
  const byWeight = weightOk(edges, filter);
  const byKind = kindOk(edges, filter);
  const set = new Set<string>();
  for (const n of nodes) {
    if (filter.fileTypes && !filter.fileTypes.includes(n.fileType)) continue;
    if (filter.clusters && !filter.clusters.includes(n.cluster)) continue;
    if (n.degree < filter.minDegree) continue;
    if (byWeight && !byWeight.has(n.id)) continue;
    if (byKind && n.kind === 'document' && !byKind.has(n.id)) continue;
    if (!recencyOk(n, filter, now)) continue;
    set.add(n.id);
  }
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
