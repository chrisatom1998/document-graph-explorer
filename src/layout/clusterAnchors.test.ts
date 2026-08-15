import { describe, expect, it } from 'vitest';
import { clusterAnchor } from './clusterAnchors';

describe('clusterAnchor', () => {
  it('places 2D anchors across the z=0 disk', () => {
    for (let id = 0; id < 16; id++) {
      const [x, y, z] = clusterAnchor(id, 100, 2);
      expect(z).toBe(0);
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(72);
    }
  });

  it('places 3D anchors on the sphere', () => {
    for (let id = 0; id < 16; id++) {
      const [x, y, z] = clusterAnchor(id, 100, 3);
      expect(Math.hypot(x, y, z)).toBeCloseTo(100, 8);
    }
  });

  it('does not collapse 2D continents onto the same projected 3D seats', () => {
    const twoD = new Set(
      Array.from({ length: 8 }, (_, id) => clusterAnchor(id, 100, 2).slice(0, 2).map((n) => n.toFixed(4)).join(',')),
    );
    expect(twoD.size).toBe(8);
  });
});
