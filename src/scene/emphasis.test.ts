/**
 * Regression coverage for the shared emphasis computation (spec §7.3),
 * extracted from Nodes.tsx into ./emphasis. Precedence is hover > selection >
 * search > filter; the filter facets (fileTypes/clusters/minDegree/
 * minEdgeWeight) compose with AND. The minEdgeWeight case is a regression
 * test: the pre-fix code omitted the edge-weight facet from `filterActive`,
 * so the link-strength slider dimmed edges (Edges.tsx's isEdgeHidden) but
 * left every node at full brightness (computeEmphasis returned null).
 */

import { describe, expect, it } from 'vitest';
import type { DocNode, Edge } from '../model/types';
import type { GraphFilter } from '../store/uiStore';
import { adjacencyFor, computeEmphasis } from './emphasis';

function mkNode(overrides: Partial<DocNode> & { id: string }): DocNode {
  return {
    kind: 'document',
    title: overrides.id,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
    ...overrides,
  };
}

function mkEdge(
  source: string,
  target: string,
  weight = 0.5,
  kind: Edge['kind'] = 'semantic',
): Edge {
  return { id: `${source}->${target}:${kind}`, source, target, kind, weight, evidence: [] };
}

const NO_FILTER: GraphFilter = {
  fileTypes: null,
  clusters: null,
  minDegree: 0,
  minEdgeWeight: 0,
};

describe('adjacencyFor', () => {
  it('builds a symmetric adjacency map from edges', () => {
    const edges = [mkEdge('a', 'b'), mkEdge('b', 'c')];
    const adj = adjacencyFor(edges);
    expect(adj.get('a')).toEqual(new Set(['b']));
    expect(adj.get('b')).toEqual(new Set(['a', 'c']));
    expect(adj.get('c')).toEqual(new Set(['b']));
  });

  it('memoizes on edges array identity', () => {
    const edges = [mkEdge('a', 'b')];
    expect(adjacencyFor(edges)).toBe(adjacencyFor(edges));
  });
});

describe('computeEmphasis', () => {
  const nodes = [mkNode({ id: 'a' }), mkNode({ id: 'b' }), mkNode({ id: 'c' })];
  const edges = [mkEdge('a', 'b'), mkEdge('b', 'c')];

  it('returns null when nothing is hovered/selected/searched/filtered', () => {
    expect(computeEmphasis(nodes, edges, null, null, null, NO_FILTER)).toBeNull();
  });

  it('hover: emphasizes the hovered node + its neighbors', () => {
    const set = computeEmphasis(nodes, edges, 'b', null, null, NO_FILTER);
    expect(set).toEqual(new Set(['b', 'a', 'c']));
  });

  it('selection: emphasizes the selected node + its neighbors when nothing is hovered', () => {
    const set = computeEmphasis(nodes, edges, null, 'a', null, NO_FILTER);
    expect(set).toEqual(new Set(['a', 'b']));
  });

  it('hover takes precedence over selection', () => {
    const set = computeEmphasis(nodes, edges, 'c', 'a', null, NO_FILTER);
    expect(set).toEqual(new Set(['c', 'b'])); // c's neighborhood, not a's
  });

  it('search: emphasizes results + their neighbors when nothing is hovered/selected', () => {
    const set = computeEmphasis(nodes, edges, null, null, ['a'], NO_FILTER);
    expect(set).toEqual(new Set(['a', 'b']));
  });

  it('search is ignored when a focus (hover/selection) is active', () => {
    const set = computeEmphasis(nodes, edges, 'a', null, ['c'], NO_FILTER);
    expect(set).toEqual(new Set(['a', 'b'])); // a's neighborhood, not c's search hit
  });

  it('filter: fileTypes facet keeps only matching nodes', () => {
    const mixed = [
      mkNode({ id: 'a', fileType: 'md' }),
      mkNode({ id: 'b', fileType: 'pdf' }),
    ];
    const set = computeEmphasis(mixed, [], null, null, null, {
      ...NO_FILTER,
      fileTypes: ['md'],
    });
    expect(set).toEqual(new Set(['a']));
  });

  it('filter: clusters facet keeps only matching nodes', () => {
    const mixed = [
      mkNode({ id: 'a', cluster: 0 }),
      mkNode({ id: 'b', cluster: 1 }),
    ];
    const set = computeEmphasis(mixed, [], null, null, null, {
      ...NO_FILTER,
      clusters: [1],
    });
    expect(set).toEqual(new Set(['b']));
  });

  it('filter: minDegree facet keeps only nodes at/above the floor', () => {
    const mixed = [
      mkNode({ id: 'a', degree: 0 }),
      mkNode({ id: 'b', degree: 3 }),
    ];
    const set = computeEmphasis(mixed, [], null, null, null, {
      ...NO_FILTER,
      minDegree: 2,
    });
    expect(set).toEqual(new Set(['b']));
  });

  // --- regression: link-strength (minEdgeWeight) filter must also dim nodes ---
  it('filter: minEdgeWeight-only filter returns a non-null set (regression)', () => {
    // a-b and c-d clear the 0.5 floor; b-c and d-e don't. e has no
    // qualifying edge at all, so it must be excluded from the emphasis set.
    const weightNodes = [
      mkNode({ id: 'a' }),
      mkNode({ id: 'b' }),
      mkNode({ id: 'c' }),
      mkNode({ id: 'd' }),
      mkNode({ id: 'e' }),
    ];
    const weightEdges = [
      mkEdge('a', 'b', 0.8),
      mkEdge('b', 'c', 0.2),
      mkEdge('c', 'd', 0.6),
      mkEdge('d', 'e', 0.1),
    ];
    const set = computeEmphasis(weightNodes, weightEdges, null, null, null, {
      ...NO_FILTER,
      minEdgeWeight: 0.5,
    });
    expect(set).not.toBeNull();
    expect(set).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('filter: minEdgeWeight boundary is inclusive (weight === floor qualifies)', () => {
    const set = computeEmphasis(
      [mkNode({ id: 'a' }), mkNode({ id: 'b' })],
      [mkEdge('a', 'b', 0.5)],
      null,
      null,
      null,
      { ...NO_FILTER, minEdgeWeight: 0.5 },
    );
    expect(set).toEqual(new Set(['a', 'b']));
  });

  it('filter: minEdgeWeight composes with other facets via AND', () => {
    const mixed = [
      mkNode({ id: 'a', fileType: 'md' }),
      mkNode({ id: 'b', fileType: 'pdf' }),
    ];
    // a-b clears the weight floor, but b fails the fileTypes facet.
    const set = computeEmphasis(mixed, [mkEdge('a', 'b', 0.9)], null, null, null, {
      ...NO_FILTER,
      fileTypes: ['md'],
      minEdgeWeight: 0.5,
    });
    expect(set).toEqual(new Set(['a']));
  });
});
