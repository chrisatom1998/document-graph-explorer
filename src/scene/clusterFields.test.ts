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
});
