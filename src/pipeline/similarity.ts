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

interface Candidate {
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

export function semanticEdges(
  ids: string[],
  vectors: Float32Array,
  dims: number,
  params: { threshold: number; topK: number; dupThreshold?: number },
): { edges: Edge[]; duplicates: DuplicatePair[] } {
  const n = ids.length;
  const { threshold, topK } = params;
  const dupThreshold = params.dupThreshold ?? Infinity; // omitted -> never flag duplicates
  if (n < 2 || dims <= 0 || topK <= 0) return { edges: [], duplicates: [] };

  // per-doc bounded top-k candidates (sim ≥ threshold only)
  const top: Candidate[][] = Array.from({ length: n }, () => []);
  const duplicates: DuplicatePair[] = [];
  for (let i = 0; i < n; i += 1) {
    const oi = i * dims;
    for (let j = i + 1; j < n; j += 1) {
      const oj = j * dims;
      let dot = 0;
      for (let d = 0; d < dims; d += 1) {
        dot += vectors[oi + d] * vectors[oj + d]; // unit vectors: dot = cosine
      }
      if (dot >= dupThreshold) {
        const a = ids[i] < ids[j] ? ids[i] : ids[j];
        const b = ids[i] < ids[j] ? ids[j] : ids[i];
        duplicates.push({ a, b, sim: dot });
      }
      if (dot >= threshold) {
        boundedInsert(top[i], j, dot, topK);
        boundedInsert(top[j], i, dot, topK);
      }
    }
  }
  duplicates.sort((x, y) => y.sim - x.sim);

  const edges: Edge[] = [];
  const denom = 1 - threshold;
  for (let i = 0; i < n; i += 1) {
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
  return { edges, duplicates };
}
