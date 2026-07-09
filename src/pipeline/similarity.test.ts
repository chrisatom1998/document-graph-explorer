/**
 * Incremental semantic index (pipeline/coordinator.ts's incremental
 * similarity pass): addToSemanticIndex must (a) only touch pairs that
 * involve a newly-added document, and (b) produce results identical to a
 * full buildSemanticIndex rebuild over the combined corpus — the whole
 * point of treating the incremental and full-rebuild paths as
 * interchangeable. The existing full-scan `semanticEdges` behavior (spec
 * §5.2 mutual top-k) is covered by pipeline.test.ts; this file focuses on
 * the incremental-vs-full equivalence.
 */
import { describe, expect, it } from 'vitest';
import {
  addToSemanticIndex,
  buildSemanticIndex,
  edgesFromIndex,
  semanticEdges,
  type SemanticIndex,
} from './similarity';

const dims = 4;
const params = { threshold: 0.62, topK: 5, dupThreshold: 0.93 };

function unit(v: number[]): number[] {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

function pack(vecs: number[][]): Float32Array {
  const out = new Float32Array(vecs.length * dims);
  vecs.forEach((v, i) => out.set(unit(v), i * dims));
  return out;
}

function sortEdges(edges: { id: string }[]): string[] {
  return edges.map((e) => e.id).sort();
}

function sortDuplicates(dups: { a: string; b: string }[]): string[] {
  return dups.map((d) => `${d.a}|${d.b}`).sort();
}

describe('addToSemanticIndex — incremental vs. full rebuild', () => {
  const existingIds = ['a', 'b', 'c'];
  const existingVecs = pack([
    [1, 0, 0, 0],
    [0.98, 0.2, 0, 0],
    [0, 0, 1, 0.05],
  ]);
  const newIds = ['d'];
  // 'd' is close to 'a' — should form a new mutual pair and pick up a
  // duplicate-pair candidate depending on threshold; also near 'b'.
  const newVecs = pack([[0.99, 0.14, 0, 0]]);

  it('adding one doc to an existing corpus only computes the new pairs (existing pairs carried over unchanged)', () => {
    const existingIndex = buildSemanticIndex(existingIds, existingVecs, dims, params);
    const grown = addToSemanticIndex(existingIndex, newIds, newVecs, params);

    // The original 3 docs' mutual candidates among THEMSELVES are exactly
    // what a fresh 3-doc build produces — addToSemanticIndex never
    // recomputes or perturbs those existing pairs.
    for (let i = 0; i < existingIds.length; i++) {
      const untouchedCandidates = grown.top[i].filter((c) => c.j < existingIds.length);
      expect(untouchedCandidates).toEqual(existingIndex.top[i]);
    }

    // The new doc's index (3) has candidates, proving new×existing pairs
    // WERE computed.
    expect(grown.top[3].length).toBeGreaterThan(0);
    expect(grown.ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a full rebuild over the combined corpus produces the same edges and duplicates as the incremental path', () => {
    const existingIndex = buildSemanticIndex(existingIds, existingVecs, dims, params);
    const incremental = addToSemanticIndex(existingIndex, newIds, newVecs, params);

    const combinedIds = [...existingIds, ...newIds];
    const combinedVectors = new Float32Array(combinedIds.length * dims);
    combinedVectors.set(existingVecs);
    combinedVectors.set(newVecs, existingIds.length * dims);
    const fullRebuild = buildSemanticIndex(combinedIds, combinedVectors, dims, params);

    const incrementalEdges = edgesFromIndex(incremental, params.threshold);
    const fullEdges = edgesFromIndex(fullRebuild, params.threshold);
    expect(sortEdges(incrementalEdges)).toEqual(sortEdges(fullEdges));
    expect(sortDuplicates(incremental.duplicates)).toEqual(sortDuplicates(fullRebuild.duplicates));
  });

  it('adding several docs across multiple incremental calls matches one full rebuild over all of them', () => {
    const ids1 = ['a', 'b'];
    const vecs1 = pack([
      [1, 0, 0, 0],
      [0.99, 0.1, 0, 0],
    ]);
    let index: SemanticIndex = buildSemanticIndex(ids1, vecs1, dims, params);

    index = addToSemanticIndex(index, ['c'], pack([[0.97, 0.24, 0, 0]]), params);
    index = addToSemanticIndex(index, ['d', 'e'], pack([
      [0, 1, 0, 0],
      [0, 0.98, 0.15, 0],
    ]), params);

    const allIds = ['a', 'b', 'c', 'd', 'e'];
    const allVectors = pack([
      [1, 0, 0, 0],
      [0.99, 0.1, 0, 0],
      [0.97, 0.24, 0, 0],
      [0, 1, 0, 0],
      [0, 0.98, 0.15, 0],
    ]);
    const fullRebuild = buildSemanticIndex(allIds, allVectors, dims, params);

    expect(sortEdges(edgesFromIndex(index, params.threshold))).toEqual(
      sortEdges(edgesFromIndex(fullRebuild, params.threshold)),
    );
    expect(index.ids).toEqual(allIds);
  });

  it('adding zero new docs is a no-op that returns the same index', () => {
    const existingIndex = buildSemanticIndex(existingIds, existingVecs, dims, params);
    const result = addToSemanticIndex(existingIndex, [], new Float32Array(0), params);
    expect(result).toBe(existingIndex);
  });

  it('semanticEdges (full one-shot API) still matches buildSemanticIndex + edgesFromIndex', () => {
    const ids = ['a', 'b', 'c'];
    const vectors = pack([
      [1, 0.05, 0, 0],
      [1, 0.1, 0, 0],
      [0, 0, 1, 0],
    ]);
    const { edges, duplicates } = semanticEdges(ids, vectors, dims, params);
    const index = buildSemanticIndex(ids, vectors, dims, params);
    expect(sortEdges(edges)).toEqual(sortEdges(edgesFromIndex(index, params.threshold)));
    expect(sortDuplicates(duplicates)).toEqual(sortDuplicates(index.duplicates));
  });
});
