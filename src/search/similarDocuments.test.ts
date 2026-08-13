import { describe, expect, it } from 'vitest';
import type { DocNode, Edge } from '../model/types';
import { similarDocuments } from './similarDocuments';

function doc(id: string): DocNode {
  return {
    id,
    title: id,
    kind: 'document',
    fileType: 'txt',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
  };
}

describe('similarDocuments', () => {
  it('ranks by cosine similarity and excludes the seed', () => {
    const hits = similarDocuments('seed', { minScore: 0.3, limit: 5 }, {
      nodes: [doc('seed'), doc('near'), doc('far'), doc('topic-hub')],
      edges: [],
      vectors: new Map([
        ['seed', new Float32Array([1, 0])],
        ['near', new Float32Array([0.9, 0.435889894])],
        ['far', new Float32Array([0, 1])],
      ]),
    });
    expect(hits.map((hit) => hit.id)).toEqual(['near']);
    expect(hits[0].score).toBeGreaterThan(0.8);
  });

  it('falls back to semantic edges when the seed has no vector', () => {
    const edges: Edge[] = [
      { id: 'e1', source: 'seed', target: 'a', kind: 'semantic', weight: 0.8, evidence: ['sim'] },
      { id: 'e2', source: 'seed', target: 'b', kind: 'keyword', weight: 0.9, evidence: ['kw'] },
    ];
    const hits = similarDocuments('seed', { limit: 5 }, {
      nodes: [doc('seed'), doc('a'), doc('b')],
      edges,
      vectors: new Map(),
    });
    expect(hits.map((hit) => hit.id)).toEqual(['a']);
  });

  it('falls back to any document edge when there are no semantic neighbors', () => {
    const edges: Edge[] = [
      { id: 'e1', source: 'seed', target: 'b', kind: 'reference', weight: 0.7, evidence: ['link'] },
    ];
    const hits = similarDocuments('seed', { limit: 5 }, {
      nodes: [doc('seed'), doc('b')],
      edges,
      vectors: new Map(),
    });
    expect(hits).toEqual([{ id: 'b', score: 0.7 }]);
  });
});
