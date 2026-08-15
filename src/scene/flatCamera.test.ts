import { describe, expect, it } from 'vitest';
import { flattenCameraPose, MIN_FLAT_CAMERA_DISTANCE } from './flatCamera';

describe('flattenCameraPose', () => {
  it('keeps distance and target while facing the z=0 map head-on', () => {
    const result = flattenCameraPose({
      px: 120,
      py: -30,
      pz: 80,
      tx: 10,
      ty: 5,
      tz: 4,
    });
    const distance = Math.hypot(110, -35, 76);

    expect(result).toEqual({
      px: 10,
      py: 5,
      pz: distance,
      tx: 10,
      ty: 5,
      tz: 0,
    });
  });

  it('keeps a degenerate pose far enough away to navigate', () => {
    expect(
      flattenCameraPose({ px: 1, py: 2, pz: 3, tx: 1, ty: 2, tz: 3 }),
    ).toEqual({
      px: 1,
      py: 2,
      pz: MIN_FLAT_CAMERA_DISTANCE,
      tx: 1,
      ty: 2,
      tz: 0,
    });
  });
});
