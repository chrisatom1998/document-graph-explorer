import { describe, expect, it } from 'vitest';
import { computeClusterFields } from './clusterFields';

describe('computeClusterFields', () => {
  it('computes a centroid and bounded radius for populated clusters', () => {
    const [field] = computeClusterFields(
      [
        { cluster: 3, x: -10, y: 0, z: 0 },
        { cluster: 3, x: 10, y: 0, z: 0 },
      ],
      8,
    );

    expect(field).toMatchObject({ cluster: 3, count: 2, x: 0, y: 0, z: 0 });
    expect(field?.radius).toBeGreaterThanOrEqual(14);
    expect(field?.radius).toBeLessThanOrEqual(92);
  });

  it('ignores unclustered and singleton nodes', () => {
    expect(
      computeClusterFields(
        [
          { cluster: -1, x: 0, y: 0, z: 0 },
          { cluster: 2, x: 4, y: 5, z: 6 },
        ],
        8,
      ),
    ).toEqual([]);
  });

  it('prioritizes larger communities and respects the draw budget', () => {
    const fields = computeClusterFields(
      [
        { cluster: 1, x: 0, y: 0, z: 0 },
        { cluster: 1, x: 1, y: 0, z: 0 },
        { cluster: 2, x: 0, y: 0, z: 0 },
        { cluster: 2, x: 1, y: 0, z: 0 },
        { cluster: 2, x: 2, y: 0, z: 0 },
      ],
      1,
    );

    expect(fields).toHaveLength(1);
    expect(fields[0]?.cluster).toBe(2);
  });

  it('emits the chosen clusters in stable cluster-id order, not count rank', () => {
    const points = [
      // cluster 7 is the largest, cluster 2 the smallest that still fits
      { cluster: 7, x: 0, y: 0, z: 0 },
      { cluster: 7, x: 1, y: 0, z: 0 },
      { cluster: 7, x: 2, y: 0, z: 0 },
      { cluster: 2, x: 0, y: 0, z: 0 },
      { cluster: 2, x: 1, y: 0, z: 0 },
      { cluster: 5, x: 0, y: 0, z: 0 },
      { cluster: 5, x: 1, y: 0, z: 0 },
      { cluster: 5, x: 2, y: 0, z: 0 },
    ];

    expect(computeClusterFields(points, 8).map((f) => f.cluster)).toEqual([2, 5, 7]);
  });

  it('keeps instance order stable when similar-size clusters trade count ranks', () => {
    const base = [
      { cluster: 3, x: 0, y: 0, z: 0 },
      { cluster: 3, x: 1, y: 0, z: 0 },
      { cluster: 9, x: 0, y: 0, z: 0 },
      { cluster: 9, x: 1, y: 0, z: 0 },
    ];
    const before = computeClusterFields(base, 8).map((f) => f.cluster);
    // cluster 9 gains a member and overtakes cluster 3 in count rank
    const after = computeClusterFields(
      [...base, { cluster: 9, x: 2, y: 0, z: 0 }],
      8,
    ).map((f) => f.cluster);

    expect(before).toEqual([3, 9]);
    expect(after).toEqual([3, 9]);
  });
});
