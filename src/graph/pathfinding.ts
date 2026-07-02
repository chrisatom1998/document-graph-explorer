/**
 * Shortest path between two documents — the "how are these connected?"
 * answer. BFS over an undirected, unweighted view of the edge graph: fewest
 * hops is the most legible route to hand a user, and edge weight/kind mixing
 * (reference vs semantic vs keyword) has no principled common scale to
 * shortest-path over anyway.
 *
 * 'topic' edges are excluded — same exclusion insights.ts uses: they're
 * derived groupings, not real document-to-document connections, and would
 * let two unrelated docs "connect" for no better reason than sharing a topic
 * hub.
 *
 * PURE — no store/DOM imports, unit-testable in isolation.
 */

import type { Edge } from '../model/types';
import { isDocEdge } from './insights';

/**
 * Fewest-hop path from `from` to `to`, inclusive of both endpoints. Returns
 * null when the two are disconnected (or either id has no document edges at
 * all). `from === to` short-circuits to a single-node path.
 */
export function shortestPath(edges: Edge[], from: string, to: string): string[] | null {
  if (from === to) return [from];

  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!isDocEdge(e)) continue;
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    if (!adj.has(e.target)) adj.set(e.target, new Set());
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }

  if (!adj.has(from) || !adj.has(to)) return null;

  // Plain BFS, tracking a predecessor per discovered node so the path can be
  // rebuilt by walking backward from `to` once found.
  const prev = new Map<string, string>();
  const visited = new Set<string>([from]);
  const queue: string[] = [from];

  for (let qi = 0; qi < queue.length; qi += 1) {
    const cur = queue[qi];
    if (cur === to) break; // BFS level order guarantees this is already shortest
    for (const next of adj.get(cur) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      prev.set(next, cur);
      queue.push(next);
    }
  }

  if (!visited.has(to)) return null;

  const path: string[] = [to];
  let node = to;
  while (node !== from) {
    const p = prev.get(node);
    if (p === undefined) return null; // unreachable in practice given the visited check above
    path.push(p);
    node = p;
  }
  path.reverse();
  return path;
}
