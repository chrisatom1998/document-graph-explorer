/**
 * Semantic edges from unit-norm document vectors (spec §5.2).
 * Edge rule: cosine sim ≥ threshold AND mutual top-k — the top-k constraint
 * is what keeps a large corpus from becoming a hairball.
 *
 * Also collects near-duplicate pairs (cosine ≥ dupThreshold) as a side
 * channel, independent of the mutual-top-k edge rule: a doc with many
 * near-duplicates can crowd a genuine ≥dupThreshold pair out of its
 * bounded top-k list, so that pair would never become a semantic edge and
 * would be invisible to anything that only scans the edge set. Piggybacking
 * on this pass reuses the dot product already computed for every pair
 * instead of a second O(n²) scan.
 *
 * PURE — imported by the aggregator worker and unit-testable. The dense
 * n×n similarity set is never materialized; only per-doc bounded top-k
 * candidate lists are kept.
 */

import type { DuplicatePair, Edge } from '../model/types';

const SEMANTIC_WEIGHT_FLOOR = 0.25;
const SEMANTIC_WEIGHT_SPAN = 0.75;

/**
 * Reported duplicate pairs are bounded: a corpus of near-identical docs
 * (e.g. templated pages) otherwise yields O(n²) pairs. The bounded insert
 * keeps the highest-similarity pairs — the ones worth surfacing in the UI.
 */
export const MAX_DUPLICATE_PAIRS = 512;

export interface Candidate {
  j: number;
  sim: number;
}

/** Insert into a descending-by-sim list bounded at topK. */
function boundedInsert(list: Candidate[], j: number, sim: number, topK: number): void {
  if (list.length === topK && list[list.length - 1].sim >= sim) return;
  let idx = list.length;
  while (idx > 0 && list[idx - 1].sim < sim) idx -= 1;
  list.splice(idx, 0, { j, sim });
  if (list.length > topK) list.pop();
}

/** Same bounded-descending insert, for the duplicate-pair side channel. */
function boundedDupInsert(list: DuplicatePair[], pair: DuplicatePair): void {
  if (list.length === MAX_DUPLICATE_PAIRS && list[list.length - 1].sim >= pair.sim) return;
  let idx = list.length;
  while (idx > 0 && list[idx - 1].sim < pair.sim) idx -= 1;
  list.splice(idx, 0, pair);
  if (list.length > MAX_DUPLICATE_PAIRS) list.pop();
}

/**
 * Bounded per-doc top-k candidates + duplicate pairs, plus the ids/vectors
 * they were computed over. This is the mutable state an incremental caller
 * (pipeline/coordinator.ts) keeps between ingest runs so that adding new
 * documents only has to compute NEW pairs (see `addToSemanticIndex`)
 * instead of rescanning the whole corpus every time.
 */
export interface SemanticIndex {
  ids: string[];
  vectors: Float32Array; // flattened [n * dims], unit vectors
  dims: number;
  top: Candidate[][]; // per-doc bounded top-k candidates (indices into `ids`)
  duplicates: DuplicatePair[];
}

interface SemanticParams {
  threshold: number;
  topK: number;
  dupThreshold?: number;
}

function dot(vectors: Float32Array, dims: number, i: number, j: number): number {
  const oi = i * dims;
  const oj = j * dims;
  let d = 0;
  for (let k = 0; k < dims; k += 1) d += vectors[oi + k] * vectors[oj + k]; // unit vectors: dot = cosine
  return d;
}

/** Records pair (i, j)'s similarity into `top`/`duplicates` per the params' thresholds. */
function considerPair(
  ids: string[],
  vectors: Float32Array,
  dims: number,
  top: Candidate[][],
  duplicates: DuplicatePair[],
  params: SemanticParams,
  i: number,
  j: number,
): void {
  const { threshold, topK } = params;
  const dupThreshold = params.dupThreshold ?? Infinity;
  const sim = dot(vectors, dims, i, j);
  if (sim >= dupThreshold) {
    const a = ids[i] < ids[j] ? ids[i] : ids[j];
    const b = ids[i] < ids[j] ? ids[j] : ids[i];
    boundedDupInsert(duplicates, { a, b, sim });
  }
  if (sim >= threshold) {
    boundedInsert(top[i], j, sim, topK);
    boundedInsert(top[j], i, sim, topK);
  }
}

/** Full O(n²) pairwise pass — every document against every other. */
export function buildSemanticIndex(
  ids: string[],
  vectors: Float32Array,
  dims: number,
  params: SemanticParams,
): SemanticIndex {
  const n = ids.length;
  const top: Candidate[][] = Array.from({ length: n }, () => []);
  const duplicates: DuplicatePair[] = [];
  if (n >= 2 && dims > 0 && params.topK > 0) {
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        considerPair(ids, vectors, dims, top, duplicates, params, i, j);
      }
    }
  }
  return { ids, vectors, dims, top, duplicates };
}

/**
 * Extend an existing index with newly-added documents WITHOUT recomputing
 * pairs between documents already in the index — those similarities are
 * unchanged (embeddings are immutable once computed), so only new×existing
 * and new×new pairs are scanned. O(m·(n+m)) instead of O((n+m)²) for a
 * corpus of n existing docs and m new ones.
 *
 * Bounded-insert order doesn't affect the final top-k/duplicate contents
 * (ties aside), so the result is identical to a full `buildSemanticIndex`
 * rebuild over the combined ids/vectors — this is what lets the caller
 * treat the incremental and full-rebuild paths as interchangeable.
 */
export function addToSemanticIndex(
  index: SemanticIndex,
  newIds: string[],
  newVectors: Float32Array,
  params: SemanticParams,
): SemanticIndex {
  const { dims } = index;
  const n0 = index.ids.length;
  const m = newIds.length;
  if (m === 0) return index;

  const ids = [...index.ids, ...newIds];
  const vectors = new Float32Array((n0 + m) * dims);
  vectors.set(index.vectors);
  vectors.set(newVectors.subarray(0, m * dims), n0 * dims);

  const top: Candidate[][] = [
    ...index.top.map((candidates) => [...candidates]),
    ...Array.from({ length: m }, () => []),
  ];
  const duplicates: DuplicatePair[] = [...index.duplicates];

  if (dims > 0 && params.topK > 0) {
    // new × existing
    for (let ni = 0; ni < m; ni += 1) {
      const j = n0 + ni;
      for (let i = 0; i < n0; i += 1) {
        considerPair(ids, vectors, dims, top, duplicates, params, i, j);
      }
    }
    // new × new
    for (let a = 0; a < m; a += 1) {
      for (let b = a + 1; b < m; b += 1) {
        considerPair(ids, vectors, dims, top, duplicates, params, n0 + a, n0 + b);
      }
    }
  }

  return { ids, vectors, dims, top, duplicates };
}

/** Derive mutual-top-k semantic edges (spec §5.2) from a bounded top-k index. */
export function edgesFromIndex(index: SemanticIndex, threshold: number): Edge[] {
  const { ids, top } = index;
  const edges: Edge[] = [];
  const denom = 1 - threshold;
  for (let i = 0; i < ids.length; i += 1) {
    for (const cand of top[i]) {
      const j = cand.j;
      if (j <= i) continue; // emit each pair once
      let mutual = false;
      for (const back of top[j]) {
        if (back.j === i) {
          mutual = true;
          break;
        }
      }
      if (!mutual) continue; // edge iff each is in the other's top-k
      const a = ids[i] < ids[j] ? ids[i] : ids[j];
      const b = ids[i] < ids[j] ? ids[j] : ids[i];
      const ratio = denom > 0 ? (cand.sim - threshold) / denom : 1;
      edges.push({
        id: `${a}->${b}:semantic`,
        source: a,
        target: b,
        kind: 'semantic',
        weight: Math.min(1, SEMANTIC_WEIGHT_FLOOR + SEMANTIC_WEIGHT_SPAN * ratio),
        evidence: [`semantic similarity ${cand.sim.toFixed(2)}`],
      });
    }
  }
  return edges;
}

export function semanticEdges(
  ids: string[],
  vectors: Float32Array,
  dims: number,
  params: { threshold: number; topK: number; dupThreshold?: number },
): { edges: Edge[]; duplicates: DuplicatePair[] } {
  if (ids.length < 2 || dims <= 0 || params.topK <= 0) return { edges: [], duplicates: [] };
  const index = buildSemanticIndex(ids, vectors, dims, params);
  // duplicates is already sorted descending by the bounded insert
  return { edges: edgesFromIndex(index, params.threshold), duplicates: index.duplicates };
}
