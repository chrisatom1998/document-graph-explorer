import type { Edge } from '../model/types';

/**
 * Edges that carry the overview structure in Balanced 2D mode. The complete
 * geometry remains mounted; non-members are merely quiet until search,
 * filtering, hover, selection, or path focus asks for them.
 */
export function balancedFlatEdgeIds(
  edges: readonly Edge[],
  nodeCount: number,
): ReadonlySet<string> {
  const cap = Math.min(edges.length, Math.max(180, Math.round(nodeCount * 2.5)));
  if (cap >= edges.length) return new Set(edges.map((edge) => edge.id));

  const ranked = [...edges].sort((a, b) => {
    // Direct references and semantic similarity are the clearest overview
    // signals; weight remains the dominant ordering within that small nudge.
    const kindBoost = (edge: Edge): number =>
      edge.kind === 'reference' ? 0.12 : edge.kind === 'semantic' ? 0.05 : 0;
    return (b.weight + kindBoost(b)) - (a.weight + kindBoost(a)) || a.id.localeCompare(b.id);
  });
  return new Set(ranked.slice(0, cap).map((edge) => edge.id));
}

/** Avoid ranking work entirely while the 3D renderer owns edge detail. */
export function balancedFlatEdgeIdsForDims(
  dims: 2 | 3,
  edges: readonly Edge[],
  nodeCount: number,
): ReadonlySet<string> | null {
  return dims === 2 ? balancedFlatEdgeIds(edges, nodeCount) : null;
}
