import { describe, expect, it } from 'vitest';
import type { DocNode, Edge } from '../model/types';
import { comparePair, intersectLabels } from './comparePair';

function doc(id: string, extra: Partial<DocNode> = {}): DocNode {
  return {
    id,
    kind: 'document',
    title: id,
    fileType: 'txt',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 10,
    cluster: 0,
    degree: 0,
    status: 'ok',
    ...extra,
  };
}

function unit(values: number[]): Float32Array {
  const raw = new Float32Array(values);
  let norm = 0;
  for (const v of raw) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return raw;
  return raw.map((v) => v / norm);
}

describe('intersectLabels', () => {
  it('keeps left-hand casing and ignores case on the right', () => {
    expect(intersectLabels(['Rate Limits', 'alpha'], ['rate limits', 'Beta'])).toEqual([
      'Rate Limits',
    ]);
  });

  it('skips blanks and de-dupes', () => {
    expect(intersectLabels(['A', 'a', ''], ['A', '  '])).toEqual(['A']);
  });
});

describe('comparePair', () => {
  it('reports cosine similarity and near-duplicate when vectors are present', () => {
    const left = unit([1, 0]);
    const right = unit([1, 0]);
    const summary = comparePair({
      left: doc('a'),
      right: doc('b'),
      edges: [],
      leftVector: left,
      rightVector: right,
    });
    expect(summary.similarity).toBeCloseTo(1, 5);
    expect(summary.nearDuplicate).toBe(true);
  });

  it('returns null similarity and not-duplicate when a vector is missing', () => {
    const summary = comparePair({
      left: doc('a'),
      right: doc('b'),
      edges: [],
      leftVector: unit([1, 0]),
    });
    expect(summary.similarity).toBeNull();
    expect(summary.nearDuplicate).toBe(false);
  });

  it('intersects topics, entities, and keywords', () => {
    const summary = comparePair({
      left: doc('a', {
        topics: ['Incidents', 'Billing'],
        entities: ['Acme'],
        keywords: ['outage', 'slo'],
      }),
      right: doc('b', {
        topics: ['incidents'],
        entities: ['acme', 'Other'],
        keywords: ['SLO', 'latency'],
      }),
      edges: [],
    });
    expect(summary.sharedTopics).toEqual(['Incidents']);
    expect(summary.sharedEntities).toEqual(['Acme']);
    expect(summary.sharedKeywords).toEqual(['slo']);
  });

  it('collects direct edges with evidence, strongest first', () => {
    const edges: Edge[] = [
      {
        id: 'a->b:keyword',
        source: 'a',
        target: 'b',
        kind: 'keyword',
        weight: 0.4,
        evidence: ['shared term "quota"'],
      },
      {
        id: 'b->a:reference',
        source: 'b',
        target: 'a',
        kind: 'reference',
        weight: 0.9,
        evidence: ['mentions a.md'],
      },
      {
        id: 'a->c:semantic',
        source: 'a',
        target: 'c',
        kind: 'semantic',
        weight: 0.99,
        evidence: ['unrelated'],
      },
    ];
    const summary = comparePair({ left: doc('a'), right: doc('b'), edges });
    expect(summary.edges).toEqual([
      { kind: 'reference', weight: 0.9, evidence: ['mentions a.md'] },
      { kind: 'keyword', weight: 0.4, evidence: ['shared term "quota"'] },
    ]);
  });

  it('respects a custom duplicate threshold', () => {
    const summary = comparePair({
      left: doc('a'),
      right: doc('b'),
      edges: [],
      leftVector: unit([1, 0]),
      rightVector: unit([0.8, 0.6]),
      dupThreshold: 0.99,
    });
    expect(summary.similarity).toBeGreaterThan(0.7);
    expect(summary.nearDuplicate).toBe(false);
  });
});
