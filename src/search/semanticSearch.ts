/**
 * Hybrid corpus search (spec §7.3 ⌘K):
 * 1. Lexical pass — instant: title substring (1.0), keyword/topic/entity
 *    exact-ish token match (0.8).
 * 2. Semantic pass — embed the query (15s guard), dot-product against every
 *    chunk vector (vectors are unit-norm, so dot == cosine), max per doc.
 *    Imported graphs without chunk vectors fall back to doc vectors when
 *    present, else lexical-only.
 * Acceptance §11: returns relevant docs for terms appearing in zero titles.
 */

import { EMBED_DIMS, SEARCH_MAX_RESULTS, SEARCH_MIN_SCORE } from '../config';
import type { DocNode } from '../model/types';
import { embedQuery } from '../pipeline/coordinator';
import { useGraphStore } from '../store/graphStore';
import { chunkStore, docVectorStore } from '../store/runtimeStores';

export interface SearchHit {
  id: string;
  score: number;
  matchKind: 'title' | 'keyword' | 'semantic';
  snippet?: string;
}

const EMBED_TIMEOUT_MS = 15_000;

/** Label preference when scores tie: title > semantic > keyword. */
const KIND_RANK: Record<SearchHit['matchKind'], number> = {
  title: 0,
  semantic: 1,
  keyword: 2,
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`embedQuery timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9+#.\-_]+/)
    .filter((t) => t.length > 1);
}

/** Cheap "exact-ish" normalization: trailing-s plural fold. */
function normalizeToken(t: string): string {
  return t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t;
}

function lexicalLabelMatch(node: DocNode, queryLower: string, queryTokens: string[]): boolean {
  const labels: string[] = [];
  for (const t of node.topics ?? []) labels.push(t.toLowerCase());
  for (const k of node.keywords ?? []) labels.push(k.toLowerCase());
  for (const e of node.entities ?? []) labels.push(e.toLowerCase());
  for (const label of labels) {
    if (label === queryLower) return true; // multi-word label == full query
    const labelNorm = normalizeToken(label);
    for (const tok of queryTokens) {
      if (label === tok || labelNorm === normalizeToken(tok)) return true;
    }
  }
  return false;
}

function mergeHit(hits: Map<string, SearchHit>, hit: SearchHit): void {
  const prev = hits.get(hit.id);
  if (!prev) {
    hits.set(hit.id, hit);
    return;
  }
  if (hit.score > prev.score) {
    // max score wins; keep whichever snippet exists
    hits.set(hit.id, { ...hit, snippet: hit.snippet ?? prev.snippet });
  } else if (hit.score === prev.score && KIND_RANK[hit.matchKind] < KIND_RANK[prev.matchKind]) {
    hits.set(hit.id, { ...prev, matchKind: hit.matchKind, snippet: prev.snippet ?? hit.snippet });
  } else if (!prev.snippet && hit.snippet) {
    // e.g. title hit (1.0) picks up the semantic pass's snippet
    hits.set(hit.id, { ...prev, snippet: hit.snippet });
  }
}

export async function searchCorpus(query: string): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const nodes = useGraphStore.getState().nodes;
  if (nodes.length === 0) return [];

  const hits = new Map<string, SearchHit>();
  const qLower = q.toLowerCase();
  const qTokens = tokenize(qLower);

  // ---- Pass 1: lexical (instant) ----
  for (const n of nodes) {
    if (n.title.toLowerCase().includes(qLower)) {
      mergeHit(hits, { id: n.id, score: 1.0, matchKind: 'title' });
    } else if (lexicalLabelMatch(n, qLower, qTokens)) {
      mergeHit(hits, { id: n.id, score: 0.8, matchKind: 'keyword' });
    }
  }

  // ---- Pass 2: semantic (guarded — degrade to lexical-only) ----
  try {
    const qVec = await withTimeout(embedQuery(q), EMBED_TIMEOUT_MS);
    const hasChunkVectors = new Set<string>();

    for (const [docId, chunks] of chunkStore) {
      const vectors = chunks.vectors;
      if (!vectors || vectors.length === 0) continue;
      const dims = chunks.dims > 0 ? chunks.dims : EMBED_DIMS;
      if (qVec.length < dims) break; // dims mismatch — semantic pass unusable
      hasChunkVectors.add(docId);

      // Flat [n * dims] loop over typed arrays — zero allocation per chunk.
      const nChunks = Math.floor(vectors.length / dims);
      let best = -Infinity;
      let bestChunk = -1;
      for (let c = 0; c < nChunks; c++) {
        const off = c * dims;
        let dot = 0;
        for (let d = 0; d < dims; d++) dot += vectors[off + d] * qVec[d];
        if (dot > best) {
          best = dot;
          bestChunk = c;
        }
      }
      if (bestChunk >= 0 && best >= SEARCH_MIN_SCORE) {
        const text = bestChunk < chunks.texts.length ? chunks.texts[bestChunk] : '';
        const snippet = text ? text.replace(/\s+/g, ' ').trim().slice(0, 140) : undefined;
        mergeHit(hits, { id: docId, score: best, matchKind: 'semantic', snippet });
      }
    }

    // Imported graphs carry doc-level vectors only.
    for (const [docId, vec] of docVectorStore) {
      if (hasChunkVectors.has(docId) || vec.length !== qVec.length) continue;
      let dot = 0;
      for (let d = 0; d < vec.length; d++) dot += vec[d] * qVec[d];
      if (dot >= SEARCH_MIN_SCORE) {
        mergeHit(hits, { id: docId, score: dot, matchKind: 'semantic' });
      }
    }
  } catch (err) {
    console.warn('[knowledge-nebula] semantic search unavailable — lexical results only', err);
  }

  return [...hits.values()]
    .sort((a, b) => b.score - a.score || KIND_RANK[a.matchKind] - KIND_RANK[b.matchKind])
    .slice(0, SEARCH_MAX_RESULTS);
}
