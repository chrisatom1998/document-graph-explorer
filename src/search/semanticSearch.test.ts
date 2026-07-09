/**
 * semanticSearch.ts imports pipeline/coordinator (for embedQuery), whose
 * transitive graph includes pdfjs-dist — needs DOM globals (DOMMatrix)
 * absent in the node test environment. Mock it the same way
 * roundTrip.test.ts does, since these tests never call embedQuery.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../pipeline/coordinator', () => ({ embedQuery: vi.fn() }));

import { mergeHit, type SearchHit } from './semanticSearch';

function hit(extra: Partial<SearchHit> = {}): SearchHit {
  return { id: 'a', score: 0.5, matchKind: 'keyword', ...extra };
}

describe('mergeHit', () => {
  it('inserts a hit for a doc id seen for the first time', () => {
    const hits = new Map<string, SearchHit>();
    mergeHit(hits, hit({ id: 'a', score: 0.7 }));
    expect(hits.get('a')).toEqual(hit({ id: 'a', score: 0.7 }));
  });

  it('a strictly higher score always wins, replacing matchKind', () => {
    const hits = new Map<string, SearchHit>();
    mergeHit(hits, hit({ id: 'a', score: 0.5, matchKind: 'keyword' }));
    mergeHit(hits, hit({ id: 'a', score: 0.9, matchKind: 'semantic' }));
    expect(hits.get('a')).toMatchObject({ score: 0.9, matchKind: 'semantic' });
  });

  it('a strictly lower score never overwrites the existing (higher-scoring) hit', () => {
    const hits = new Map<string, SearchHit>();
    mergeHit(hits, hit({ id: 'a', score: 0.9, matchKind: 'title' }));
    mergeHit(hits, hit({ id: 'a', score: 0.5, matchKind: 'semantic' }));
    expect(hits.get('a')).toMatchObject({ score: 0.9, matchKind: 'title' });
  });

  it('a higher-scoring hit keeps the previous snippet when the new one has none', () => {
    const hits = new Map<string, SearchHit>();
    mergeHit(hits, hit({ id: 'a', score: 0.5, snippet: 'old snippet' }));
    mergeHit(hits, hit({ id: 'a', score: 0.9, snippet: undefined }));
    expect(hits.get('a')).toMatchObject({ score: 0.9, snippet: 'old snippet' });
  });

  it('on a score TIE, matchKind rank (title > semantic > keyword) decides which wins', () => {
    const hits = new Map<string, SearchHit>();
    mergeHit(hits, hit({ id: 'a', score: 0.8, matchKind: 'keyword' }));
    mergeHit(hits, hit({ id: 'a', score: 0.8, matchKind: 'title' }));
    expect(hits.get('a')?.matchKind).toBe('title');
  });

  it('on a score tie, a lower-ranked matchKind never displaces a higher-ranked one', () => {
    const hits = new Map<string, SearchHit>();
    mergeHit(hits, hit({ id: 'a', score: 0.8, matchKind: 'title' }));
    mergeHit(hits, hit({ id: 'a', score: 0.8, matchKind: 'keyword' }));
    expect(hits.get('a')?.matchKind).toBe('title');
  });

  it('a rank-tiebreak keeps whichever snippet exists (the losing hit\'s, if the winner has none)', () => {
    const hits = new Map<string, SearchHit>();
    mergeHit(hits, hit({ id: 'a', score: 0.8, matchKind: 'keyword', snippet: 'kw snippet' }));
    mergeHit(hits, hit({ id: 'a', score: 0.8, matchKind: 'title', snippet: undefined }));
    expect(hits.get('a')).toMatchObject({ matchKind: 'title', snippet: 'kw snippet' });
  });

  it('an equal score AND equal rank leaves the existing hit untouched but backfills a missing snippet', () => {
    const hits = new Map<string, SearchHit>();
    mergeHit(hits, hit({ id: 'a', score: 1.0, matchKind: 'title' }));
    mergeHit(hits, hit({ id: 'a', score: 1.0, matchKind: 'title', snippet: 'from semantic pass' }));
    expect(hits.get('a')).toMatchObject({ matchKind: 'title', snippet: 'from semantic pass' });
  });

  it('different doc ids never interact', () => {
    const hits = new Map<string, SearchHit>();
    mergeHit(hits, hit({ id: 'a', score: 0.9 }));
    mergeHit(hits, hit({ id: 'b', score: 0.1 }));
    expect(hits.size).toBe(2);
    expect(hits.get('a')?.score).toBe(0.9);
    expect(hits.get('b')?.score).toBe(0.1);
  });
});
