import { describe, expect, it } from 'vitest';
import { SIM_THRESHOLD } from '../config';
import { nearestOrphanNeighbors, ORPHAN_NEIGHBOR_MIN_SIM } from './orphanNeighbors';

describe('nearestOrphanNeighbors', () => {
  it('returns the closest other document above the noise floor', () => {
    const hints = nearestOrphanNeighbors(
      ['orphan'],
      [{ id: 'orphan', neighborId: 'near', sim: 0.8 }],
    );
    expect(hints).toHaveLength(1);
    expect(hints[0].orphanId).toBe('orphan');
    expect(hints[0].neighborId).toBe('near');
    expect(hints[0].sim).toBeCloseTo(0.8, 5);
    expect(hints[0].sim).toBeGreaterThan(SIM_THRESHOLD);
  });

  it('keeps a below-threshold neighbor as a suggested link', () => {
    const hints = nearestOrphanNeighbors(
      ['orphan'],
      [{ id: 'orphan', neighborId: 'almost', sim: 0.58 }],
    );
    expect(hints).toHaveLength(1);
    expect(hints[0].neighborId).toBe('almost');
    expect(hints[0].sim).toBeGreaterThan(ORPHAN_NEIGHBOR_MIN_SIM);
    expect(hints[0].sim).toBeLessThan(SIM_THRESHOLD);
  });

  it('skips missing candidates and neighbors below the floor', () => {
    expect(
      nearestOrphanNeighbors(
        ['orphan', 'ghost'],
        [{ id: 'orphan', neighborId: 'noise', sim: 0.05 }],
      ),
    ).toEqual([]);
  });
});
