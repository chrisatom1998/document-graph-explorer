import { describe, expect, it } from 'vitest';
import { diversifyRanked, reciprocalRankFusion } from './hybridRank';

describe('hybrid ranking', () => {
  it('rewards agreement between lexical and semantic retrieval', () => {
    const ranked = reciprocalRankFusion([
      { id: 'semantic-only', semanticRank: 1 },
      { id: 'both', semanticRank: 3, lexicalRank: 1 },
    ]);
    expect(ranked[0].id).toBe('both');
  });

  it('prevents one source from crowding every result', () => {
    expect(diversifyRanked([
      { id: 'a', groupId: 'doc-1' }, { id: 'b', groupId: 'doc-1' },
      { id: 'c', groupId: 'doc-1' }, { id: 'd', groupId: 'doc-2' },
    ], 3, 2).map((item) => item.id)).toEqual(['a', 'b', 'd']);
  });
});
