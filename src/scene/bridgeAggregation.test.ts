import { describe, expect, it } from 'vitest';
import type { DocNode, Edge } from '../model/types';
import { aggregateBridges } from './bridgeAggregation';

function doc(id: string, cluster: number): DocNode {
  return {
    id,
    kind: 'document',
    title: id,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 100,
    cluster,
    degree: 1,
    status: 'ok',
  };
}

function edge(source: string, target: string, weight: number, kind: Edge['kind'] = 'semantic'): Edge {
  return { id: `${source}->${target}:${kind}`, source, target, kind, weight, evidence: [] };
}

const nodes = [doc('a1', 0), doc('a2', 0), doc('b1', 1), doc('b2', 1), doc('c1', 2), doc('u1', -1)];

describe('aggregateBridges', () => {
  it('returns empty for empty inputs', () => {
    expect(aggregateBridges([], [])).toEqual([]);
    expect(aggregateBridges(nodes, [])).toEqual([]);
  });

  it('aggregates cross-cluster edges per unordered pair and skips intra-cluster ones', () => {
    const bridges = aggregateBridges(nodes, [
      edge('a1', 'b1', 0.5),
      edge('b2', 'a2', 0.3), // reverse direction, same pair
      edge('a1', 'a2', 0.9), // intra-cluster: ignored
    ]);
    expect(bridges).toHaveLength(1);
    expect(bridges[0]).toMatchObject({ a: 0, b: 1, strength: 0.8, count: 2, norm: 1 });
  });

  it('ignores unclustered nodes, unknown ids, and topic edges', () => {
    const bridges = aggregateBridges(nodes, [
      edge('a1', 'u1', 0.9), // cluster -1
      edge('a1', 'ghost', 0.9), // unknown id
      edge('a1', 'b1', 0.9, 'topic'), // topic hub link
    ]);
    expect(bridges).toEqual([]);
  });

  it('sorts by strength and sqrt-normalizes against the strongest pair', () => {
    const bridges = aggregateBridges(nodes, [
      edge('a1', 'c1', 0.2),
      edge('a1', 'b1', 0.4),
      edge('a2', 'b2', 0.4),
    ]);
    expect(bridges.map((b) => [b.a, b.b])).toEqual([
      [0, 1],
      [0, 2],
    ]);
    expect(bridges[0].norm).toBe(1);
    expect(bridges[1].norm).toBeCloseTo(Math.sqrt(0.2 / 0.8));
  });

  it('caps the list at the strongest pairs', () => {
    const bridges = aggregateBridges(
      nodes,
      [edge('a1', 'b1', 0.9), edge('a1', 'c1', 0.5), edge('b1', 'c1', 0.1)],
      2,
    );
    expect(bridges).toHaveLength(2);
    expect(bridges.map((b) => b.strength)).toEqual([0.9, 0.5]);
  });
});
