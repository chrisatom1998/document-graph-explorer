/**
 * Per-cluster corpus statistics for the insights panel: how big each Louvain
 * community is, what it is about (top keywords), and how tightly knit it is
 * (internal doc-edge count + average weight).
 *
 * Keyword ranking reuses clusterNaming.ts's counting approach: per-cluster
 * document frequency damped by corpus-level distinctiveness, so a term that
 * appears in every document cannot top every cluster's list.
 *
 * PURE function over nodes/edges — unit-testable, no store imports. Runs in
 * the insights worker on slimmed node/edge copies (see InsightNode).
 */

import { isDocEdge, type InsightEdge, type InsightNode } from './insights';

/** Keywords surfaced per cluster row in the insights panel. */
const TOP_KEYWORDS_PER_CLUSTER = 3;

export interface ClusterStat {
  cluster: number;
  docCount: number;
  topKeywords: string[];
  /** Doc-to-doc edges with both endpoints inside the cluster. */
  internalEdges: number;
  /** Mean weight of those internal edges; 0 when there are none. */
  avgWeight: number;
}

/**
 * Stats for every cluster that has at least one document, largest first
 * (ties by cluster id so ordering is deterministic). Unclustered docs
 * (cluster < 0 — Louvain hasn't run yet) get no row: "cluster -1" is a
 * pipeline phase, not a community.
 */
export function computeClusterStats(
  nodes: InsightNode[],
  edges: InsightEdge[],
): ClusterStat[] {
  const docs = nodes.filter((n) => n.kind === 'document' && n.cluster >= 0);
  if (docs.length === 0) return [];
  const totalDocs = docs.length;

  // Document frequencies per keyword, corpus-wide and per cluster — deduped
  // per doc so a repeated term still counts as one document.
  const clusterOf = new Map<string, number>();
  const docCount = new Map<number, number>();
  const globalDf = new Map<string, number>();
  const clusterDf = new Map<number, Map<string, number>>();
  for (const doc of docs) {
    clusterOf.set(doc.id, doc.cluster);
    docCount.set(doc.cluster, (docCount.get(doc.cluster) ?? 0) + 1);
    const seen = new Set<string>();
    for (const raw of doc.keywords) {
      const kw = raw.trim().toLowerCase();
      if (kw) seen.add(kw);
    }
    let perCluster = clusterDf.get(doc.cluster);
    if (!perCluster) {
      perCluster = new Map();
      clusterDf.set(doc.cluster, perCluster);
    }
    for (const kw of seen) {
      globalDf.set(kw, (globalDf.get(kw) ?? 0) + 1);
      perCluster.set(kw, (perCluster.get(kw) ?? 0) + 1);
    }
  }

  // Internal doc-edges: both endpoints are documents of the same cluster.
  const edgeCount = new Map<number, number>();
  const weightSum = new Map<number, number>();
  for (const e of edges) {
    if (!isDocEdge(e)) continue;
    if (e.source === e.target) continue;
    const a = clusterOf.get(e.source);
    if (a === undefined || a !== clusterOf.get(e.target)) continue;
    edgeCount.set(a, (edgeCount.get(a) ?? 0) + 1);
    weightSum.set(a, (weightSum.get(a) ?? 0) + e.weight);
  }

  const out: ClusterStat[] = [];
  for (const [cluster, count] of docCount) {
    const df = clusterDf.get(cluster) ?? new Map<string, number>();
    const scored = [...df.entries()].map(([kw, inClusterDocFreq]) => ({
      kw,
      score:
        inClusterDocFreq * Math.log(1 + totalDocs / (1 + (globalDf.get(kw) ?? 0))),
    }));
    scored.sort((a, b) => b.score - a.score || a.kw.localeCompare(b.kw));
    const internalEdges = edgeCount.get(cluster) ?? 0;
    out.push({
      cluster,
      docCount: count,
      topKeywords: scored.slice(0, TOP_KEYWORDS_PER_CLUSTER).map((s) => s.kw),
      internalEdges,
      avgWeight: internalEdges > 0 ? (weightSum.get(cluster) ?? 0) / internalEdges : 0,
    });
  }
  out.sort((a, b) => b.docCount - a.docCount || a.cluster - b.cluster);
  return out;
}
