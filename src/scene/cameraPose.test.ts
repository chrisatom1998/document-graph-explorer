import { describe, expect, it } from 'vitest';
import { faceLayoutPlane } from './cameraPose';

describe('faceLayoutPlane', () => {
  it('moves the camera onto +Z of the target at the current distance', () => {
    const next = faceLayoutPlane(10, 80, 10, 4, 5, 0);
    expect(next.tx).toBe(4);
    expect(next.ty).toBe(5);
    expect(next.tz).toBe(0);
    expect(next.px).toBe(4);
    expect(next.py).toBe(5);
    expect(next.pz).toBeCloseTo(Math.hypot(6, 75, 10), 6);
  });

  it('floors very close cameras so the graph does not fill the lens', () => {
    const next = faceLayoutPlane(0, 0, 1, 0, 0, 0, 40);
    expect(next.pz).toBe(40);
  });
});
