/**
 * Aggregator worker — corpus-wide passes that need the whole corpus at
 * once: lexical (TF-IDF keywords, keyword edges, reference edges,
 * boilerplate detection) and semantic (mutual-top-k similarity edges +
 * Louvain community detection). Single dedicated instance owned by the
 * coordinator.
 */

import { UndirectedGraph } from 'graphology';
import louvain from 'graphology-communities-louvain';
import type { AggRequest, AggResponse, Edge } from '../model/types';
import { findBoilerplateLines } from '../pipeline/boilerplate';
import { referenceEdges } from '../pipeline/links';
import { semanticEdges } from '../pipeline/similarity';
import { computeIdf, keywordEdges, topKeywords } from '../pipeline/tfidf';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

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

  // reference first so it wins any (theoretical) id collision
  const merged = new Map<string, Edge>();
  for (const edge of [...refEdges, ...kwEdges]) {
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

function handleSemantic(req: Extract<AggRequest, { type: 'semantic' }>): void {
  const { ids, vectors, dims, existingEdges, params } = req;

  const semEdges = semanticEdges(ids, vectors, dims, params);

  // Louvain over the FULL edge set (existing lexical + new semantic).
  // Only edge endpoints enter the graph; isolated docs are handled below.
  const graph = new UndirectedGraph<Record<string, unknown>, { weight: number }>();
  const addWeightedEdge = (source: string, target: string, weight: number): void => {
    if (source === target) return;
    if (!graph.hasNode(source)) graph.addNode(source);
    if (!graph.hasNode(target)) graph.addNode(target);
    if (graph.hasEdge(source, target)) {
      const current = graph.getEdgeAttribute(source, target, 'weight');
      if (weight > current) graph.setEdgeAttribute(source, target, 'weight', weight);
    } else {
      graph.addEdge(source, target, { weight });
    }
  };
  for (const edge of existingEdges) addWeightedEdge(edge.source, edge.target, edge.weight);
  for (const edge of semEdges) addWeightedEdge(edge.source, edge.target, edge.weight);

  const clusters: Record<string, number> = {};
  let maxCluster = -1;
  if (graph.order > 0 && graph.size > 0) {
    const communities = louvain(graph, { getEdgeWeight: 'weight' });
    for (const [node, community] of Object.entries(communities)) {
      clusters[node] = community;
      if (community > maxCluster) maxCluster = community;
    }
  }
  // isolated docs (no edges at all) each get their own cluster after the max
  let nextCluster = maxCluster + 1;
  for (const id of ids) {
    if (clusters[id] === undefined) {
      clusters[id] = nextCluster;
      nextCluster += 1;
    }
  }

  ctx.postMessage({
    requestId: req.requestId,
    type: 'semantic:done',
    edges: semEdges,
    clusters,
  } satisfies AggResponse);
}

ctx.onmessage = (ev: MessageEvent<AggRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'lexical') handleLexical(req);
    else handleSemantic(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.postMessage({ requestId: req.requestId, type: 'error', message } satisfies AggResponse);
  }
};
