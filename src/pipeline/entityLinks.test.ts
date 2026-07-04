import { describe, expect, it } from 'vitest';
import { entityEdges } from './entityLinks';

describe('entityEdges', () => {
  const params = { minShared: 2, edgesPerDoc: 5 };

  it('links two docs that share enough entities', () => {
    const edges = entityEdges(
      [
        { id: 'a', entities: ['AuthService', 'JWT', 'unique_a'] },
        { id: 'b', entities: ['AuthService', 'JWT', 'unique_b'] },
      ],
      params,
    );
    expect(edges).toHaveLength(1);
    const e = edges[0];
    expect(e.kind).toBe('entity');
    expect(e.source).toBe('a');
    expect(e.target).toBe('b');
    expect(e.id).toBe('a->b:entity');
    expect(e.evidence[0]).toContain('AuthService');
    expect(e.weight).toBeGreaterThanOrEqual(0.35);
    expect(e.weight).toBeLessThanOrEqual(0.9);
  });

  it('respects minShared (one shared entity is not enough by default)', () => {
    const edges = entityEdges(
      [
        { id: 'a', entities: ['AuthService', 'x'] },
        { id: 'b', entities: ['AuthService', 'y'] },
      ],
      params,
    );
    expect(edges).toHaveLength(0);
  });

  it('matches entities case-sensitively (IT ≠ it)', () => {
    const edges = entityEdges(
      [
        { id: 'a', entities: ['IT', 'JWT'] },
        { id: 'b', entities: ['it', 'JWT'] },
      ],
      params,
    );
    // only 'JWT' is shared -> below minShared 2
    expect(edges).toHaveLength(0);
  });

  it('weights a pair sharing rarer entities above one sharing common ones', () => {
    // 'common' appears in every doc (low idf); 'rare1/rare2' appear only in a,b
    const docs = [
      { id: 'a', entities: ['common', 'rare1', 'rare2'] },
      { id: 'b', entities: ['common', 'rare1', 'rare2'] },
      { id: 'c', entities: ['common', 'shared1', 'shared2'] },
      { id: 'd', entities: ['common', 'shared1', 'shared2'] },
    ];
    const edges = entityEdges(docs, params);
    const ab = edges.find((e) => e.id === 'a->b:entity');
    const cd = edges.find((e) => e.id === 'c->d:entity');
    expect(ab).toBeDefined();
    expect(cd).toBeDefined();
    // a-b and c-d each share two entities of equal rarity, so weights match;
    // the point is the ubiquitous 'common' never creates its own dense web
    expect(edges.some((e) => e.source === 'a' && e.target === 'c')).toBe(false);
  });

  it('caps edges per document', () => {
    // one hub doc shares 2 entities with each of 5 others; cap at 2
    const docs = [
      { id: 'hub', entities: ['E1', 'E2'] },
      { id: 'p1', entities: ['E1', 'E2'] },
      { id: 'p2', entities: ['E1', 'E2'] },
      { id: 'p3', entities: ['E1', 'E2'] },
    ];
    const edges = entityEdges(docs, { minShared: 2, edgesPerDoc: 2 });
    const hubDegree = edges.filter(
      (e) => e.source === 'hub' || e.target === 'hub',
    ).length;
    expect(hubDegree).toBeLessThanOrEqual(2);
  });

  it('returns no edges when nothing is shared', () => {
    const edges = entityEdges(
      [
        { id: 'a', entities: ['x', 'y'] },
        { id: 'b', entities: ['p', 'q'] },
      ],
      params,
    );
    expect(edges).toHaveLength(0);
  });
});
