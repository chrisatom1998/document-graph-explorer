import { describe, expect, it } from 'vitest';
import { pairKey, scoreClusters, scorePairs } from './graphAccuracy';

describe('scorePairs', () => {
  it('dedupes undirected pairs and ignores self-pairs', () => {
    const expected = new Set([pairKey('a', 'b'), pairKey('c', 'd')]);
    const score = scorePairs(
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
        { source: 'a', target: 'c' },
        { source: 'a', target: 'a' },
      ],
      expected,
    );
    expect(score).toMatchObject({ predicted: 2, expected: 2, truePositives: 1, precision: 0.5, recall: 0.5 });
    expect(score.f1).toBeCloseTo(0.5);
  });

  it('treats an empty prediction as precise but recalling nothing', () => {
    expect(scorePairs([], new Set([pairKey('a', 'b')]))).toMatchObject({ precision: 1, recall: 0, f1: 0 });
  });
});

describe('scoreClusters', () => {
  const labels = new Map([
    ['a1', 'A'],
    ['a2', 'A'],
    ['b1', 'B'],
    ['b2', 'B'],
  ]);

  it('scores a perfect clustering as 1 everywhere', () => {
    const score = scoreClusters({ a1: 0, a2: 0, b1: 7, b2: 7 }, labels);
    expect(score).toMatchObject({ clusters: 2, classes: 2, purity: 1, inversePurity: 1 });
    expect(score.nmi).toBeCloseTo(1);
  });

  it('penalizes merged classes in purity and split classes in inverse purity', () => {
    const merged = scoreClusters({ a1: 0, a2: 0, b1: 0, b2: 0 }, labels);
    expect(merged).toMatchObject({ clusters: 1, purity: 0.5, inversePurity: 1 });
    expect(merged.nmi).toBeCloseTo(0);

    const split = scoreClusters({ a1: 0, a2: 1, b1: 2, b2: 3 }, labels);
    expect(split).toMatchObject({ clusters: 4, purity: 1, inversePurity: 0.5 });
  });
});
