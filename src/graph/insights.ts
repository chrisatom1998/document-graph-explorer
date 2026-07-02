/**
 * Corpus insights derived from data the graph already has — no new pipeline
 * passes, no network:
 *
 * - Orphans: document nodes with no reference/semantic/keyword edge at all.
 *   Nothing links to them, nothing resembles them — the stale-doc detector.
 * - Near-duplicates: semantic-edge pairs whose doc vectors' cosine similarity
 *   clears DUP_SIM_THRESHOLD. (A ≥0.93 pair is always each other's nearest
 *   neighbor, so the mutual-top-k semantic edge for it exists.)
 * - Bridges: highest betweenness-centrality documents — the docs shortest
 *   paths funnel through, i.e. the ones connecting otherwise-separate domains.
 *
 * PURE functions over nodes/edges (+ an injected vector lookup) — unit-testable,
 * no store imports. Topic hub nodes and 'topic' edges are excluded everywhere:
 * they are derived groupings and would dominate centrality artificially.
 */

import type { DocNode, Edge } from '../model/types';

export interface DuplicatePair {
  a: string;
  b: string;
  sim: number;
}

export interface BridgeDoc {
  id: string;
  /** Betweenness normalized to [0, 1] by the (n-1)(n-2)/2 pair count. */
  score: number;
}

function isDocEdge(e: Edge): boolean {
  return e.kind !== 'topic';
}

/** Document nodes with no document-to-document edge of any kind. */
export function computeOrphans(nodes: DocNode[], edges: Edge[]): string[] {
  const connected = new Set<string>();
  for (const e of edges) {
    if (!isDocEdge(e)) continue;
    connected.add(e.source);
    connected.add(e.target);
  }
  return nodes
    .filter((n) => n.kind === 'document' && !connected.has(n.id))
    .map((n) => n.id);
}

/**
 * Semantic-edge pairs whose exact vector cosine ≥ threshold, best-first.
 * Pairs whose vectors are unavailable (e.g. unreadable docs) are skipped.
 */
export function computeDuplicates(
  edges: Edge[],
  getVector: (id: string) => Float32Array | undefined,
  threshold: number,
): DuplicatePair[] {
  const out: DuplicatePair[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (e.kind !== 'semantic') continue;
    const key = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const va = getVector(e.source);
    const vb = getVector(e.target);
    if (!va || !vb || va.length !== vb.length) continue;
    let dot = 0;
    for (let d = 0; d < va.length; d += 1) dot += va[d] * vb[d]; // unit vectors
    if (dot >= threshold) out.push({ a: e.source, b: e.target, sim: dot });
  }
  out.sort((x, y) => y.sim - x.sim);
  return out;
}

/**
 * Top bridge documents by betweenness centrality (Brandes, unweighted,
 * undirected). Above maxPivots nodes, sources are stride-sampled and the
 * result scaled — the standard approximation; ranking stays stable long
 * before exact scores do. Cost: O(pivots · E).
 */
export function computeBridges(
  nodes: DocNode[],
  edges: Edge[],
  opts: { topN: number; minScore: number; maxPivots: number },
): BridgeDoc[] {
  const ids = nodes.filter((n) => n.kind === 'document').map((n) => n.id);
  const n = ids.length;
  if (n < 3) return []; // betweenness is degenerate below 3 nodes

  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));

  // adjacency, deduped: a reference AND a semantic edge between the same pair
  // must not double-count shortest paths
  const adj: number[][] = Array.from({ length: n }, () => []);
  const pairSeen = new Set<number>();
  for (const e of edges) {
    if (!isDocEdge(e)) continue;
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? a * n + b : b * n + a;
    if (pairSeen.has(key)) continue;
    pairSeen.add(key);
    adj[a].push(b);
    adj[b].push(a);
  }

  const pivotCount = Math.min(n, opts.maxPivots);
  const bc = new Float64Array(n);
  const dist = new Int32Array(n);
  const sigma = new Float64Array(n);
  const delta = new Float64Array(n);

  for (let p = 0; p < pivotCount; p += 1) {
    const s = Math.floor((p * n) / pivotCount); // deterministic stride sample
    dist.fill(-1);
    sigma.fill(0);
    delta.fill(0);
    const preds: number[][] = Array.from({ length: n }, () => []);
    const order: number[] = [s];
    dist[s] = 0;
    sigma[s] = 1;
    for (let qi = 0; qi < order.length; qi += 1) {
      const v = order[qi];
      for (const w of adj[v]) {
        if (dist[w] < 0) {
          dist[w] = dist[v] + 1;
          order.push(w);
        }
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v];
          preds[w].push(v);
        }
      }
    }
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const w = order[i];
      for (const v of preds[w]) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      if (w !== s) bc[w] += delta[w];
    }
  }

  // undirected double-count → /2; pivot sampling → ×(n/pivots); then normalize
  const norm = ((n - 1) * (n - 2)) / 2;
  const scale = (n / pivotCount / 2) / norm;
  const out: BridgeDoc[] = [];
  for (let i = 0; i < n; i += 1) {
    if (adj[i].length < 2) continue; // a leaf can't be a bridge
    const score = bc[i] * scale;
    if (score >= opts.minScore) out.push({ id: ids[i], score });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, opts.topN);
}
