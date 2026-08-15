import { describe, expect, it } from 'vitest';
import type { Edge, EdgeKind } from '../model/types';
import { balancedFlatEdgeIds } from './flatEdgeDetail';

function edge(index: number, weight: number, kind: EdgeKind = 'keyword'): Edge {
  return {
    id: `e-${index}`,
    source: `a-${index}`,
    target: `b-${index}`,
    kind,
    weight,
    evidence: [],
  };
}

describe('balancedFlatEdgeIds', () => {
  it('keeps every edge when the map is already sparse', () => {
    const edges = [edge(1, 0.2), edge(2, 0.8)];
    expect([...balancedFlatEdgeIds(edges, 20)]).toEqual(['e-1', 'e-2']);
  });

  it('caps a dense overview while retaining its strongest signals', () => {
    const edges = Array.from({ length: 600 }, (_, index) => edge(index, index / 600));
    const kept = balancedFlatEdgeIds(edges, 100);
    expect(kept.size).toBe(250);
    expect(kept.has('e-599')).toBe(true);
    expect(kept.has('e-0')).toBe(false);
  });

  it('gives explicit references a small overview preference', () => {
    const edges = Array.from({ length: 200 }, (_, index) => edge(index, 0.6));
    edges.push(edge(999, 0.5, 'reference'));
    const kept = balancedFlatEdgeIds(edges, 1);
    expect(kept.has('e-999')).toBe(true);
  });
});
