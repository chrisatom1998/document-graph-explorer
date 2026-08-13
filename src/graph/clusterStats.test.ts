import { describe, expect, it } from 'vitest';
import type { InsightEdge, InsightNode } from './insights';
import { computeClusterStats } from './clusterStats';

function mkNode(
  id: string,
  cluster: number,
  keywords: string[] = [],
  kind: InsightNode['kind'] = 'document',
): InsightNode {
  return { id, kind, cluster, keywords };
}

function mkEdge(
  source: string,
  target: string,
  weight = 0.5,
  kind: InsightEdge['kind'] = 'semantic',
): InsightEdge {
  return { source, target, weight, kind };
}

describe('computeClusterStats', () => {
  it('computes counts, internal edges, and avgWeight on a 2-cluster fixture', () => {
    const nodes = [
      mkNode('a1', 0, ['auth', 'shared']),
      mkNode('a2', 0, ['auth', 'shared']),
      mkNode('a3', 0, ['tokens']),
      mkNode('b1', 1, ['billing']),
      mkNode('b2', 1, ['billing']),
    ];
    const edges = [
      mkEdge('a1', 'a2', 0.8),
      mkEdge('a2', 'a3', 0.6),
      mkEdge('b1', 'b2', 0.4),
      mkEdge('a1', 'b1', 0.9), // cross-cluster: not internal to either
    ];
    const stats = computeClusterStats(nodes, edges);
    expect(stats.map((s) => s.cluster)).toEqual([0, 1]); // largest first
    expect(stats[0]).toMatchObject({ cluster: 0, docCount: 3, internalEdges: 2 });
    expect(stats[0].avgWeight).toBeCloseTo(0.7, 6);
    expect(stats[1]).toMatchObject({ cluster: 1, docCount: 2, internalEdges: 1 });
    expect(stats[1].avgWeight).toBeCloseTo(0.4, 6);
  });

  it('ranks distinctive in-cluster keywords above corpus-wide ones', () => {
    // "common" appears in every doc corpus-wide; "auth" only in cluster 0 —
    // distinctiveness damping must put auth first despite equal in-cluster
    // frequency.
    const nodes = [
      mkNode('a1', 0, ['common', 'auth']),
      mkNode('a2', 0, ['common', 'auth']),
      mkNode('b1', 1, ['common', 'billing']),
      mkNode('b2', 1, ['common', 'billing']),
    ];
    const stats = computeClusterStats(nodes, []);
    const cluster0 = stats.find((s) => s.cluster === 0)!;
    expect(cluster0.topKeywords[0]).toBe('auth');
    const cluster1 = stats.find((s) => s.cluster === 1)!;
    expect(cluster1.topKeywords[0]).toBe('billing');
  });

  it('ignores topic edges and topic nodes', () => {
    const nodes = [
      mkNode('a1', 0),
      mkNode('a2', 0),
      mkNode('t', 0, [], 'topic'),
    ];
    const edges = [
      mkEdge('a1', 't', 1, 'topic'),
      mkEdge('a2', 't', 1, 'topic'),
    ];
    const stats = computeClusterStats(nodes, edges);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ cluster: 0, docCount: 2, internalEdges: 0, avgWeight: 0 });
  });

  it('skips unclustered docs (cluster < 0) and returns [] pre-Louvain', () => {
    expect(computeClusterStats([mkNode('a', -1), mkNode('b', -1)], [])).toEqual([]);
    const mixed = [mkNode('a', -1), mkNode('b', 2)];
    const stats = computeClusterStats(mixed, []);
    expect(stats).toEqual([
      { cluster: 2, docCount: 1, topKeywords: [], internalEdges: 0, avgWeight: 0 },
    ]);
  });

  it('breaks equal-size ties by cluster id', () => {
    const nodes = [mkNode('a', 5), mkNode('b', 2)];
    expect(computeClusterStats(nodes, []).map((s) => s.cluster)).toEqual([2, 5]);
  });
});
