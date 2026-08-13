/**
 * Rank documents by cosine similarity to a seed document's embedding.
 *
 * "More like this" is the inverse of ⌘K: instead of embedding a query, we
 * reuse the document vector the pipeline already stored. Mutual top-k semantic
 * edges are a sparse view of the same space; this scan returns a broader
 * neighborhood so the existing “Show all in graph” highlight can frame it.
 *
 * PURE when dependencies are injected — unit-testable without workers.
 */

import { SEARCH_MAX_RESULTS, SEARCH_MIN_SCORE } from '../config';
import { isDocEdge } from '../graph/insights';
import type { DocNode, Edge } from '../model/types';
import { docVectorStore } from '../store/runtimeStores';
import { useGraphStore } from '../store/graphStore';

export interface SimilarHit {
  id: string;
  score: number;
}

export interface SimilarDocumentsDependencies {
  nodes: DocNode[];
  edges: Edge[];
  vectors: ReadonlyMap<string, Float32Array>;
}

export interface SimilarDocumentsOptions {
  limit?: number;
  minScore?: number;
}

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function liveDependencies(): SimilarDocumentsDependencies {
  const graph = useGraphStore.getState();
  return { nodes: graph.nodes, edges: graph.edges, vectors: docVectorStore };
}

function fromSemanticNeighbors(
  seedId: string,
  deps: SimilarDocumentsDependencies,
  limit: number,
): SimilarHit[] {
  const hits: SimilarHit[] = [];
  for (const edge of deps.edges) {
    if (edge.kind !== 'semantic') continue;
    const other = edge.source === seedId ? edge.target : edge.target === seedId ? edge.source : null;
    if (!other) continue;
    hits.push({ id: other, score: edge.weight });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return hits.slice(0, limit);
}

function fromAnyNeighbors(
  seedId: string,
  deps: SimilarDocumentsDependencies,
  limit: number,
): SimilarHit[] {
  const hits: SimilarHit[] = [];
  for (const edge of deps.edges) {
    if (!isDocEdge(edge)) continue;
    const other = edge.source === seedId ? edge.target : edge.target === seedId ? edge.source : null;
    if (!other) continue;
    hits.push({ id: other, score: edge.weight });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const unique: SimilarHit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    unique.push(hit);
    if (unique.length >= limit) break;
  }
  return unique;
}

/**
 * Documents most similar to `seedId`, excluding the seed. Prefers embedding
 * cosine; falls back to semantic edges, then any document-to-document edge,
 * so imported graphs without vectors still have a neighborhood.
 */
export function similarDocuments(
  seedId: string,
  options: SimilarDocumentsOptions = {},
  dependencies?: SimilarDocumentsDependencies,
): SimilarHit[] {
  const deps = dependencies ?? liveDependencies();
  const limit = Math.max(1, options.limit ?? SEARCH_MAX_RESULTS);
  const minScore = options.minScore ?? SEARCH_MIN_SCORE;
  const seed = deps.vectors.get(seedId);
  if (!seed || seed.length === 0) {
    const semantic = fromSemanticNeighbors(seedId, deps, limit);
    return semantic.length > 0 ? semantic : fromAnyNeighbors(seedId, deps, limit);
  }

  const hits: SimilarHit[] = [];
  for (const node of deps.nodes) {
    if (node.id === seedId || node.kind !== 'document') continue;
    const vector = deps.vectors.get(node.id);
    if (!vector) continue;
    const score = cosine(seed, vector);
    if (score < minScore) continue;
    hits.push({ id: node.id, score });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return hits.slice(0, limit);
}
