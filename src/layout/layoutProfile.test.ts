import { describe, expect, it } from 'vitest';
import {
  clusterAnchor,
  clusterPullForDims,
  shellStrengthForDims,
} from './layoutProfile';

describe('layout profiles', () => {
  it('removes the hollow shell in 2D while retaining it in 3D', () => {
    expect(shellStrengthForDims(2)).toBe(0);
    expect(shellStrengthForDims(3)).toBeGreaterThan(0);
    expect(clusterPullForDims(2)).toBeGreaterThan(clusterPullForDims(3));
  });

  it('distributes 2D anchors through a disc on z=0', () => {
    const anchors = Array.from({ length: 12 }, (_, index) => clusterAnchor(index, 12, 100, 2));
    const radii = anchors.map(([x, y, z]) => {
      expect(z).toBe(0);
      return Math.hypot(x, y);
    });
    expect(Math.min(...radii)).toBeLessThan(25);
    expect(Math.max(...radii)).toBeGreaterThan(60);
    expect(Math.max(...radii)).toBeLessThan(100);
  });

  it('keeps 3D anchors on the requested sphere', () => {
    for (let index = 0; index < 8; index += 1) {
      const [x, y, z] = clusterAnchor(index, 8, 90, 3);
      expect(Math.hypot(x, y, z)).toBeCloseTo(90, 8);
    }
  });
});
