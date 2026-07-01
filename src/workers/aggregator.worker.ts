/**
 * Aggregator worker — corpus-wide passes that need the whole corpus at
 * once: lexical (TF-IDF keywords, keyword edges, reference edges,
 * boilerplate detection) and semantic (mutual-top-k similarity edges +
 * connected-component clustering). Single dedicated instance owned by the
 * coordinator.
 */

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

  // Cluster over the FULL edge set (existing lexical + new semantic). Keeping
  // this local avoids pulling graphology's CJS bundle into the worker's hot path.
  const knownIds = new Set(ids);
  const adj = new Map<string, Set<string>>();
  for (const id of ids) adj.set(id, new Set());
  const addEdge = (source: string, target: string): void => {
    if (source === target) return;
    if (!knownIds.has(source) || !knownIds.has(target)) return;
    adj.get(source)!.add(target);
    adj.get(target)!.add(source);
  };
  for (const edge of existingEdges) addEdge(edge.source, edge.target);
  for (const edge of semEdges) addEdge(edge.source, edge.target);

  const clusters: Record<string, number> = {};
  let nextCluster = 0;
  for (const id of ids) {
    if (clusters[id] !== undefined) continue;
    const stack = [id];
    clusters[id] = nextCluster;
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const neighbor of adj.get(current) ?? []) {
        if (clusters[neighbor] !== undefined) continue;
        clusters[neighbor] = nextCluster;
        stack.push(neighbor);
      }
    }
    nextCluster += 1;
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
  void (async () => {
    try {
      if (req.type === 'lexical') handleLexical(req);
      else handleSemantic(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.postMessage({ requestId: req.requestId, type: 'error', message } satisfies AggResponse);
    }
  })();
};
