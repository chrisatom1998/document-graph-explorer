import { beforeEach, describe, expect, it } from 'vitest';
import type { DocNode, Edge } from '../model/types';
import { useGraphStore } from './graphStore';

function mkNode(id: string): DocNode {
  return {
    id,
    kind: 'document',
    title: id,
    fileType: 'md',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
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

describe('removeNodes', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
  });

  it('removes nodes, incident edges, and reindexes survivors', () => {
    const s = useGraphStore.getState();
    s.addNodes([mkNode('a'), mkNode('b'), mkNode('c')]);
    s.setEdges([mkEdge('a', 'b'), mkEdge('b', 'c')]);

    useGraphStore.getState().removeNodes(['b']);

    const after = useGraphStore.getState();
    expect(after.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    expect(after.edges).toEqual([]);
    expect(after.nodeIndex).toEqual({ a: 0, c: 1 });
    // survivors' ids resolve through the rebuilt index
    expect(after.nodes[after.nodeIndex.c].id).toBe('c');
  });

  it('recomputes degrees of surviving neighbors', () => {
    const s = useGraphStore.getState();
    s.addNodes([mkNode('a'), mkNode('b'), mkNode('c')]);
    s.setEdges([mkEdge('a', 'b'), mkEdge('a', 'c')]);
    expect(useGraphStore.getState().nodes[0].degree).toBe(2); // a

    useGraphStore.getState().removeNodes(['c']);

    const after = useGraphStore.getState();
    const a = after.nodes[after.nodeIndex.a];
    const b = after.nodes[after.nodeIndex.b];
    expect(a.degree).toBe(1);
    expect(b.degree).toBe(1);
    expect(after.edges.map((e) => e.id)).toEqual(['a->b:semantic']);
  });

  it('is a no-op for unknown ids', () => {
    const s = useGraphStore.getState();
    s.addNodes([mkNode('a')]);
    const before = useGraphStore.getState().nodes;

    useGraphStore.getState().removeNodes(['nope']);

    expect(useGraphStore.getState().nodes).toBe(before);
  });

  it('supports removing several nodes at once', () => {
    const s = useGraphStore.getState();
    s.addNodes([mkNode('a'), mkNode('b'), mkNode('c'), mkNode('d')]);
    s.setEdges([mkEdge('a', 'b'), mkEdge('c', 'd')]);

    useGraphStore.getState().removeNodes(['a', 'c']);

    const after = useGraphStore.getState();
    expect(after.nodes.map((n) => n.id)).toEqual(['b', 'd']);
    expect(after.edges).toEqual([]);
    expect(after.nodeIndex).toEqual({ b: 0, d: 1 });
  });
});
