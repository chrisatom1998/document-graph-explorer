/**
 * Aggregator worker — corpus-wide passes that need the whole corpus at
 * once: lexical (TF-IDF keywords, keyword edges, reference edges,
 * boilerplate detection) and semantic (mutual-top-k similarity edges +
 * Louvain community clustering). Single dedicated instance owned by the
 * coordinator.
 */

import { UndirectedGraph } from 'graphology';
import louvain from 'graphology-communities-louvain';
import type { AggRequest, AggResponse, Edge } from '../model/types';
import { findBoilerplateLines } from '../pipeline/boilerplate';
import { entityEdges } from '../pipeline/entityLinks';
import { referenceEdges } from '../pipeline/links';
import { buildSemanticIndex, edgesFromIndex } from '../pipeline/similarity';
import { computeIdf, keywordEdges, topKeywords } from '../pipeline/tfidf';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// Higher resolution -> more, smaller communities (more distinct hues). Tuned
// so a densely cross-linked corpus separates into several colored clusters
// instead of one blob.
const CLUSTER_RESOLUTION = 1.25;

/** Seeded PRNG so community ids (and thus colors) are stable across reloads. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function handleLexical(req: Extract<AggRequest, { type: 'lexical' }>): void {
  const { docs, params } = req;

  const idf = computeIdf(docs.map((d) => ({ id: d.id, tf: d.tf })));

  const keywordsByDoc: Record<string, string[]> = {};
  for (const doc of docs) {
    keywordsByDoc[doc.id] = topKeywords(doc.tf, doc.totalTerms, idf, params.tfidfTopN);
  }

  const kwEdges = keywordEdges(
    docs.map((d) => ({ id: d.id })),
    keywordsByDoc,
    idf,
    { minShared: params.minShared, edgesPerDoc: params.edgesPerDoc },
  );

  const refEdges = referenceEdges(
    docs.map((d) => ({
      id: d.id,
      title: d.title,
      fileName: d.fileName,
      textLower: d.textLower,
      mdLinkTargets: d.mdLinkTargets,
    })),
    params.minTitleLen,
  );

  const entEdges = entityEdges(
    docs.map((d) => ({ id: d.id, entities: d.entities })),
    { minShared: params.entityMinShared, edgesPerDoc: params.entityEdgesPerDoc },
  );

  // Merge all lexical edge kinds. Ids embed the kind (`:reference` / `:entity`
  // / `:keyword`), so different kinds on the same pair never collide; the
  // first-wins guard only dedupes within a kind. Order is cosmetic.
  const merged = new Map<string, Edge>();
  for (const edge of [...refEdges, ...entEdges, ...kwEdges]) {
    if (!merged.has(edge.id)) merged.set(edge.id, edge);
  }

  const boilerplate = findBoilerplateLines(docs.map((d) => d.textLower.split('\n')));

  ctx.postMessage({
    requestId: req.requestId,
    type: 'lexical:done',
    keywordsByDoc,
    edges: [...merged.values()],
    boilerplateLines: [...boilerplate],
  } satisfies AggResponse);
}

/**
 * Community detection over a caller-supplied weighted edge set. Connected-
 * components clustering collapsed the whole (densely cross-linked) corpus
 * into a single community, so every node shared one color; Louvain
 * modularity separates it into meaningful colored clusters instead.
 */
function clusterFromEdges(
  ids: string[],
  edges: { source: string; target: string; weight: number }[],
): Record<string, number> {
  const knownIds = new Set(ids);
  const graph = new UndirectedGraph();
  for (const id of ids) graph.addNode(id);
  const addWeighted = (source: string, target: string, weight: number): void => {
    if (source === target) return;
    if (!knownIds.has(source) || !knownIds.has(target)) return;
    if (graph.hasEdge(source, target)) {
      graph.updateEdgeAttribute(source, target, 'weight', (w) =>
        (typeof w === 'number' ? w : 0) + weight,
      );
    } else {
      graph.addEdge(source, target, { weight });
    }
  };
  for (const edge of edges) addWeighted(edge.source, edge.target, edge.weight ?? 0.5);

  if (graph.size > 0) {
    return louvain(graph, {
      resolution: CLUSTER_RESOLUTION,
      getEdgeWeight: 'weight',
      rng: mulberry32(0x9e3779b9),
    });
  }
  // no edges at all: each node is its own singleton community
  const clusters: Record<string, number> = {};
  ids.forEach((id, i) => {
    clusters[id] = i;
  });
  return clusters;
}

function handleSemantic(req: Extract<AggRequest, { type: 'semantic' }>): void {
  const { ids, vectors, dims, existingEdges, params } = req;

  const index = buildSemanticIndex(ids, vectors, dims, params);
  const semEdges = edgesFromIndex(index, params.threshold);

  const clusters = clusterFromEdges(ids, [
    ...existingEdges,
    ...semEdges.map((e) => ({ source: e.source, target: e.target, weight: e.weight })),
  ]);

  ctx.postMessage({
    requestId: req.requestId,
    type: 'semantic:done',
    edges: semEdges,
    clusters,
    duplicates: index.duplicates,
    top: index.top,
  } satisfies AggResponse);
}

function handleCluster(req: Extract<AggRequest, { type: 'cluster' }>): void {
  const clusters = clusterFromEdges(req.ids, req.edges);
  ctx.postMessage({
    requestId: req.requestId,
    type: 'cluster:done',
    clusters,
  } satisfies AggResponse);
}

ctx.onmessage = (ev: MessageEvent<AggRequest>) => {
  const req = ev.data;
  void (async () => {
    try {
      if (req.type === 'lexical') handleLexical(req);
      else if (req.type === 'semantic') handleSemantic(req);
      else handleCluster(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.postMessage({ requestId: req.requestId, type: 'error', message } satisfies AggResponse);
    }
  })();
};
