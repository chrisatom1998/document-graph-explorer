import { describe, expect, it } from 'vitest';
import type { DocNode, Edge } from '../model/types';
import { computeBridges, computeOrphans, computeStaleDocs } from './insights';

function mkNode(
  id: string,
  kind: DocNode['kind'] = 'document',
  lastModified?: number,
): DocNode {
  return {
    id,
    kind,
    title: id,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
    lastModified,
  };
}

function mkEdge(source: string, target: string, kind: Edge['kind'] = 'semantic'): Edge {
  return {
    id: `${source}->${target}:${kind}`,
    source,
    target,
    kind,
    weight: 0.5,
    evidence: [],
  };
}

describe('computeOrphans', () => {
  it('flags document nodes with no doc-to-doc edges', () => {
    const nodes = [mkNode('a'), mkNode('b'), mkNode('c')];
    const edges = [mkEdge('a', 'b')];
    expect(computeOrphans(nodes, edges)).toEqual(['c']);
  });

  it('ignores topic edges and topic nodes', () => {
    const nodes = [mkNode('a'), mkNode('t', 'topic')];
    const edges = [mkEdge('a', 't', 'topic')];
    // a's only connection is a topic hub — still an orphan; t is not a document
    expect(computeOrphans(nodes, edges)).toEqual(['a']);
  });
});

describe('computeBridges', () => {
  const opts = { topN: 8, minScore: 0.01, maxPivots: 512 };

  it('ranks the articulation node of a barbell graph first', () => {
    // two triangles (a,b,c) and (d,e,f) joined through m
    const ids = ['a', 'b', 'c', 'm', 'd', 'e', 'f'];
    const nodes = ids.map((id) => mkNode(id));
    const edges = [
      mkEdge('a', 'b'),
      mkEdge('b', 'c'),
      mkEdge('a', 'c'),
      mkEdge('c', 'm'),
      mkEdge('m', 'd'),
      mkEdge('d', 'e'),
      mkEdge('e', 'f'),
      mkEdge('d', 'f'),
    ];
    const bridges = computeBridges(nodes, edges, opts);
    expect(bridges[0].id).toBe('m');
    // m sits on every one of the 3x3 cross-triangle shortest paths
    expect(bridges[0].score).toBeGreaterThan(0.5);
  });

  it('does not double-count parallel edges of different kinds', () => {
    const nodes = ['a', 'b', 'c'].map((id) => mkNode(id));
    const edges = [
      mkEdge('a', 'b'),
      mkEdge('a', 'b', 'reference'),
      mkEdge('b', 'c'),
    ];
    const bridges = computeBridges(nodes, edges, opts);
    expect(bridges).toHaveLength(1);
    expect(bridges[0].id).toBe('b');
    expect(bridges[0].score).toBeCloseTo(1, 5); // b is on the only a↔c path
  });

  it('returns [] for graphs too small for betweenness', () => {
    const nodes = [mkNode('a'), mkNode('b')];
    expect(computeBridges(nodes, [mkEdge('a', 'b')], opts)).toEqual([]);
  });

  it('still surfaces the articulation node under pivot sampling', () => {
    const ids = ['a', 'b', 'c', 'm', 'd', 'e', 'f'];
    const nodes = ids.map((id) => mkNode(id));
    const edges = [
      mkEdge('a', 'b'),
      mkEdge('b', 'c'),
      mkEdge('a', 'c'),
      mkEdge('c', 'm'),
      mkEdge('m', 'd'),
      mkEdge('d', 'e'),
      mkEdge('e', 'f'),
      mkEdge('d', 'f'),
    ];
    // sampling is an approximation: exact ordering between m and its two
    // gateway neighbors (c, d) can flip on tiny pivot sets, but the
    // articulation trio must dominate the ranking
    const bridges = computeBridges(nodes, edges, { ...opts, maxPivots: 4 });
    expect(bridges.length).toBeGreaterThan(0);
    expect(['c', 'm', 'd']).toContain(bridges[0].id);
    expect(bridges.map((b) => b.id).slice(0, 3)).toContain('m');
  });
});

describe('computeStaleDocs', () => {
  const DAY = 86_400_000;
  const NOW = 1_750_000_000_000;
  const THRESHOLD = 180;

  it('flags docs strictly older than the threshold, not those exactly at it', () => {
    const nodes = [
      mkNode('exact', 'document', NOW - THRESHOLD * DAY), // exactly 180 days old
      mkNode('over', 'document', NOW - THRESHOLD * DAY - 1), // one ms past
      mkNode('fresh', 'document', NOW - DAY),
    ];
    const stale = computeStaleDocs(nodes, NOW, THRESHOLD);
    expect(stale.map((d) => d.id)).toEqual(['over']);
    expect(stale[0].lastModified).toBe(NOW - THRESHOLD * DAY - 1);
  });

  it('sorts oldest first', () => {
    const nodes = [
      mkNode('middle', 'document', NOW - 200 * DAY),
      mkNode('oldest', 'document', NOW - 400 * DAY),
      mkNode('newest-stale', 'document', NOW - 181 * DAY),
    ];
    expect(computeStaleDocs(nodes, NOW, THRESHOLD).map((d) => d.id)).toEqual([
      'oldest',
      'middle',
      'newest-stale',
    ]);
  });

  it('excludes docs without a lastModified — unknown age is not stale', () => {
    const nodes = [mkNode('unknown'), mkNode('old', 'document', NOW - 365 * DAY)];
    expect(computeStaleDocs(nodes, NOW, THRESHOLD).map((d) => d.id)).toEqual(['old']);
  });

  it('excludes topic nodes even when they carry an old timestamp', () => {
    const nodes = [
      mkNode('t', 'topic', NOW - 365 * DAY),
      mkNode('doc', 'document', NOW - 365 * DAY),
    ];
    expect(computeStaleDocs(nodes, NOW, THRESHOLD).map((d) => d.id)).toEqual(['doc']);
  });
});
