/**
 * Corpus insights derived from data the graph already has — no new pipeline
 * passes, no network:
 *
 * - Orphans: document nodes with no reference/semantic/keyword edge at all.
 *   Nothing links to them, nothing resembles them — the stale-doc detector.
 * - Near-duplicates: computed in the aggregator worker's semantic pass
 *   (similarity.ts), not here — a pair can clear DUP_SIM_THRESHOLD without
 *   forming a semantic edge (crowded out of a mutual top-k list by other
 *   near-duplicates), so scanning the edge set alone would miss it. See
 *   graphStore.duplicatePairs.
 * - Bridges: highest betweenness-centrality documents — the docs shortest
 *   paths funnel through, i.e. the ones connecting otherwise-separate domains.
 * - Stale docs: documents whose file mtime is older than a threshold —
 *   candidates for review or archive. Docs with no recorded mtime are
 *   excluded: unknown age is not evidence of staleness.
 *
 * PURE functions over nodes/edges — unit-testable, no store imports. Topic
 * hub nodes and 'topic' edges are excluded everywhere: they are derived
 * groupings and would dominate centrality artificially.
 */

import type { DocNode, Edge } from '../model/types';

/**
 * The minimal node/edge shapes the insight computations actually read.
 * The insights worker ships slimmed copies over postMessage (no titles,
 * summaries, or text), so the pure functions are typed against these picks —
 * full DocNode/Edge values remain assignable for main-thread callers.
 */
export type InsightNode = Pick<DocNode, 'id' | 'kind' | 'cluster' | 'keywords'>;
export type InsightEdge = Pick<Edge, 'source' | 'target' | 'kind' | 'weight'>;

export interface BridgeDoc {
  id: string;
  /** Betweenness normalized to [0, 1] by the (n-1)(n-2)/2 pair count. */
  score: number;
}

/**
 * The "counts as a real document-to-document connection" policy, shared with
 * pathfinding.ts so route-finding and insights can never disagree on it.
 */
export function isDocEdge(e: Pick<Edge, 'kind'>): boolean {
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
 * Top bridge documents by betweenness centrality (Brandes, unweighted,
 * undirected). Above maxPivots nodes, sources are stride-sampled and the
 * result scaled — the standard approximation; ranking stays stable long
 * before exact scores do. Cost: O(pivots · E).
 */
export function computeBridges(
  nodes: InsightNode[],
  edges: InsightEdge[],
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

export interface HubDoc {
  id: string;
  /**
   * Count of distinct document-to-document connections. NOT DocNode.degree:
   * the store's degree includes topic edges, which would inflate any doc
   * carrying a popular topic without it being genuinely well-connected.
   */
  docDegree: number;
}

/**
 * Top hub documents by document-edge degree. Parallel edges of different
 * kinds between the same pair count once — a neighbor is a neighbor, however
 * many ways it is connected. Ties break by id so the ranking is stable across
 * runs. Docs with no doc-edges never appear (degree 0 is not a hub).
 */
export function computeHubs(
  nodes: InsightNode[],
  edges: InsightEdge[],
  topN: number,
): HubDoc[] {
  const docIds = new Set(
    nodes.filter((n) => n.kind === 'document').map((n) => n.id),
  );
  const neighbors = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!isDocEdge(e)) continue;
    if (e.source === e.target) continue;
    if (!docIds.has(e.source) || !docIds.has(e.target)) continue;
    let a = neighbors.get(e.source);
    if (!a) neighbors.set(e.source, (a = new Set()));
    a.add(e.target);
    let b = neighbors.get(e.target);
    if (!b) neighbors.set(e.target, (b = new Set()));
    b.add(e.source);
  }
  const out: HubDoc[] = [...neighbors.entries()].map(([id, set]) => ({
    id,
    docDegree: set.size,
  }));
  out.sort((x, y) => y.docDegree - x.docDegree || x.id.localeCompare(y.id));
  return out.slice(0, Math.max(0, topN));
}

export interface StaleDoc {
  id: string;
  /** File mtime (epoch ms) — guaranteed defined here, unlike DocNode's. */
  lastModified: number;
}

const DAY_MS = 86_400_000;

/**
 * Document nodes whose mtime is strictly more than thresholdDays before
 * nowMs, oldest first. Nodes without a lastModified never qualify — the
 * field is absent for docs cached before it existed and for sources with
 * no mtime, and unknown age is not stale.
 */
export function computeStaleDocs(
  nodes: DocNode[],
  nowMs: number,
  thresholdDays: number,
): StaleDoc[] {
  const maxAge = thresholdDays * DAY_MS;
  const out: StaleDoc[] = [];
  for (const n of nodes) {
    if (n.kind !== 'document' || n.lastModified === undefined) continue;
    if (nowMs - n.lastModified > maxAge) {
      out.push({ id: n.id, lastModified: n.lastModified });
    }
  }
  out.sort((a, b) => a.lastModified - b.lastModified);
  return out;
}
