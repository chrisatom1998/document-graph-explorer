import type { DocNode } from '../model/types';

// One id→cluster Map per store `nodes` array identity. The store treats the
// array as immutable (every mutation swaps it), so a WeakMap keyed on the
// array itself is a safe cache — Edges recolors on every hover change and was
// rebuilding this map over all nodes each time.
const cache = new WeakMap<readonly DocNode[], Map<string, number>>();

export function clusterOfNodes(nodes: readonly DocNode[]): Map<string, number> {
  let map = cache.get(nodes);
  if (!map) {
    map = new Map<string, number>();
    for (const n of nodes) map.set(n.id, n.cluster);
    cache.set(nodes, map);
  }
  return map;
}
