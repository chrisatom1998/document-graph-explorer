import { describe, expect, it } from 'vitest';
import type { Edge } from '../model/types';
import { shortestPath } from './pathfinding';

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

describe('shortestPath', () => {
  it('returns the direct hop when two docs share an edge', () => {
    const edges = [mkEdge('a', 'b')];
    expect(shortestPath(edges, 'a', 'b')).toEqual(['a', 'b']);
  });

  it('prefers the fewest-hop route over a longer alternative', () => {
    // a-b-c-d is 3 hops; a-e-d is 2 hops — BFS must pick the latter
    const edges = [
      mkEdge('a', 'b'),
      mkEdge('b', 'c'),
      mkEdge('c', 'd'),
      mkEdge('a', 'e'),
      mkEdge('e', 'd'),
    ];
    expect(shortestPath(edges, 'a', 'd')).toEqual(['a', 'e', 'd']);
  });

  it('returns null when the two documents are disconnected', () => {
    const edges = [mkEdge('a', 'b'), mkEdge('c', 'd')];
    expect(shortestPath(edges, 'a', 'd')).toBeNull();
  });

  it('ignores topic edges — a topic-only bridge must not connect two docs', () => {
    const edges = [mkEdge('a', 't', 'topic'), mkEdge('b', 't', 'topic')];
    expect(shortestPath(edges, 'a', 'b')).toBeNull();
  });

  it('returns a single-node path when from === to', () => {
    const edges = [mkEdge('a', 'b')];
    expect(shortestPath(edges, 'a', 'a')).toEqual(['a']);
  });
});
