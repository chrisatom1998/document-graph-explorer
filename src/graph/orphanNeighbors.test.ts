import { describe, expect, it } from 'vitest';
import { SIM_THRESHOLD } from '../config';
import { nearestOrphanNeighbors, ORPHAN_NEIGHBOR_MIN_SIM } from './orphanNeighbors';

function vec(...values: number[]): Float32Array {
  return new Float32Array(values);
}

describe('nearestOrphanNeighbors', () => {
  it('returns the closest other document above the noise floor', () => {
    const vectors = new Map<string, Float32Array>([
      ['orphan', vec(1, 0)],
      ['near', vec(0.8, 0.6)], // cosine 0.8
      ['far', vec(0, 1)], // cosine 0
    ]);
    const hints = nearestOrphanNeighbors(['orphan'], vectors, ['orphan', 'near', 'far']);
    expect(hints).toEqual([{ orphanId: 'orphan', neighborId: 'near', sim: 0.8 }]);
    expect(hints[0].sim).toBeGreaterThan(SIM_THRESHOLD);
  });

  it('keeps a below-threshold neighbor as a suggested link', () => {
    const vectors = new Map<string, Float32Array>([
      ['orphan', vec(1, 0)],
      ['almost', vec(0.58, Math.sqrt(1 - 0.58 ** 2))],
    ]);
    const hints = nearestOrphanNeighbors(['orphan'], vectors, ['orphan', 'almost']);
    expect(hints).toHaveLength(1);
    expect(hints[0].neighborId).toBe('almost');
    expect(hints[0].sim).toBeGreaterThan(ORPHAN_NEIGHBOR_MIN_SIM);
    expect(hints[0].sim).toBeLessThan(SIM_THRESHOLD);
  });

  it('skips orphans without a vector and neighbors below the floor', () => {
    const vectors = new Map<string, Float32Array>([
      ['orphan', vec(1, 0)],
      ['noise', vec(0.05, Math.sqrt(1 - 0.05 ** 2))],
    ]);
    expect(nearestOrphanNeighbors(['orphan', 'ghost'], vectors, ['orphan', 'noise', 'ghost'])).toEqual(
      [],
    );
  });
});
