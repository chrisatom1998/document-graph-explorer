/**
 * Inter-cluster bridge aggregation: every cross-community edge collapses into
 * one record per unordered cluster pair, so ClusterBridges can draw a single
 * trunk filament where dozens of individual cross-cluster edges would each be
 * too faint to read (density fade + mid-curve taper + aerial perspective all
 * stack against long edges at overview distance).
 *
 * Structural only — no positions. Pure so the Node test suite can cover it;
 * the live-centroid geometry lives in ClusterBridges.tsx.
 *
 * Topic edges are excluded: they join documents to topic-hub octahedra, not
 * documents to documents, and the hubs are hidden unless topicNodesEnabled —
 * counting them would fatten bridges with links the user may not even render.
 */

import type { DocNode, Edge } from '../model/types';

export interface ClusterBridge {
  /** Lower cluster id of the pair. */
  a: number;
  /** Higher cluster id of the pair. */
  b: number;
  /** Sum of the underlying cross-cluster edge weights. */
  strength: number;
  /** Number of underlying edges. */
  count: number;
  /**
   * sqrt(strength / strongest pair's strength) in (0, 1] — perceptually
   * compressed so a 4x stronger bridge reads 2x brighter, not 4x (additive
   * blending already exaggerates linear differences).
   */
  norm: number;
}

/** Bridges beyond this cap are dropped (weakest first) — a messy corpus with
 *  every cluster touching every other must not become a woven basket. */
export const MAX_BRIDGES = 64;

export function aggregateBridges(
  nodes: DocNode[],
  edges: Edge[],
  cap: number = MAX_BRIDGES,
): ClusterBridge[] {
  if (nodes.length === 0 || edges.length === 0) return [];
  const clusterOf = new Map<string, number>();
  for (const n of nodes) clusterOf.set(n.id, n.cluster);

  const pairs = new Map<string, ClusterBridge>();
  for (const e of edges) {
    if (e.kind === 'topic') continue;
    const ca = clusterOf.get(e.source);
    const cb = clusterOf.get(e.target);
    if (ca === undefined || cb === undefined || ca === cb || ca < 0 || cb < 0) continue;
    const [lo, hi] = ca < cb ? [ca, cb] : [cb, ca];
    const key = `${lo}-${hi}`;
    const existing = pairs.get(key);
    if (existing) {
      existing.strength += e.weight;
      existing.count++;
    } else {
      pairs.set(key, { a: lo, b: hi, strength: e.weight, count: 1, norm: 0 });
    }
  }
  if (pairs.size === 0) return [];

  // Deterministic order: strength desc, then count desc, then ids asc.
  const bridges = [...pairs.values()].sort(
    (x, y) => y.strength - x.strength || y.count - x.count || x.a - y.a || x.b - y.b,
  );
  if (bridges.length > cap) bridges.length = cap;

  const max = bridges[0].strength;
  for (const bridge of bridges) {
    bridge.norm = max > 0 ? Math.sqrt(bridge.strength / max) : 1;
  }
  return bridges;
}
