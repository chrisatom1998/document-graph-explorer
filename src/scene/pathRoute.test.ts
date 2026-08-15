import { describe, expect, it } from 'vitest';
import { isPathHop, pathHopPairs, pathHopSet, undirectedHopKey } from './pathRouteHelpers';

describe('pathRoute helpers', () => {
  it('orders hop keys independently of direction', () => {
    expect(undirectedHopKey('b', 'a')).toBe(undirectedHopKey('a', 'b'));
  });

  it('builds consecutive pairs and ignores short lists', () => {
    expect(pathHopPairs(null)).toEqual([]);
    expect(pathHopPairs(['only'])).toEqual([]);
    expect(pathHopPairs(['a', 'b', 'c'])).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ]);
  });

  it('matches edges in either stored direction', () => {
    const hops = pathHopSet(['a', 'b', 'c']);
    expect(isPathHop('a', 'b', hops)).toBe(true);
    expect(isPathHop('b', 'a', hops)).toBe(true);
    expect(isPathHop('a', 'c', hops)).toBe(false);
  });
});
