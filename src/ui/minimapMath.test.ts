import { describe, expect, it } from 'vitest';
import {
  arrowVertices,
  boxCorners,
  clampToRect,
  headingOnMap,
  projU,
  projV,
  viewportHalfExtents,
} from './minimapMath';

const ASPECT = 16 / 9;

const pose = (over: Partial<Record<string, number>> = {}) => ({
  px: 0,
  py: 0,
  pz: 100,
  tx: 0,
  ty: 0,
  tz: 0,
  fov: 55,
  aspect: ASPECT,
  ...over,
});

describe('projU / projV', () => {
  it('maps world x to u in both modes', () => {
    expect(projU(3, 9, -7)).toBe(3);
  });

  it('maps world z to v top-down in 3D', () => {
    expect(projV(2, 7, 3)).toBe(7);
  });

  it('maps world -y to v in 2D so +y is map-up', () => {
    expect(projV(2, 7, 2)).toBe(-2);
  });
});

describe('headingOnMap', () => {
  it('projects the camera->target direction onto the x/z plane in 3D', () => {
    // camera south of the target (behind on z): looking toward +z = map-down
    const h = headingOnMap(pose({ pz: -10, py: 50 }), 3);
    expect(h.hu).toBeCloseTo(0, 6);
    expect(h.hv).toBeCloseTo(1, 6);
  });

  it('normalizes diagonal headings', () => {
    const h = headingOnMap(pose({ px: -3, pz: -4, py: 20 }), 3);
    expect(h.hu).toBeCloseTo(0.6, 6);
    expect(h.hv).toBeCloseTo(0.8, 6);
    expect(Math.hypot(h.hu, h.hv)).toBeCloseTo(1, 6);
  });

  it('falls back to map-up for a straight-down 3D view', () => {
    const h = headingOnMap(pose({ px: 0, py: 100, pz: 0 }), 3);
    expect(h).toEqual({ hu: 0, hv: -1 });
  });

  it('falls back to map-up in 2D when facing the layout plane head-on', () => {
    const h = headingOnMap(pose(), 2);
    expect(h).toEqual({ hu: 0, hv: -1 });
  });

  it('uses x/-y components in 2D mode', () => {
    // camera above the target in world y, looking down: map-down heading
    const h = headingOnMap(pose({ py: 5, pz: 100 }), 2);
    expect(h.hu).toBeCloseTo(0, 6);
    expect(h.hv).toBeCloseTo(1, 6);
  });
});

describe('viewportHalfExtents', () => {
  it('sizes the box from the frustum at target distance', () => {
    const { halfU, halfV } = viewportHalfExtents(pose(), 0.5, 200, 148);
    // dist=100, fov 55 => halfV = 100 * tan(27.5deg) * 0.5
    expect(halfV).toBeCloseTo(100 * Math.tan((55 * Math.PI) / 360) * 0.5, 3);
    expect(halfU / halfV).toBeCloseTo(ASPECT, 6);
  });

  it('keeps the camera aspect when flooring a tiny box', () => {
    const { halfU, halfV } = viewportHalfExtents(pose({ pz: 1 }), 0.1, 200, 148);
    expect(Math.min(halfU, halfV)).toBeCloseTo(4, 6);
    expect(halfU / halfV).toBeCloseTo(ASPECT, 6);
  });

  it('keeps the camera aspect when capping a huge box', () => {
    const { halfU, halfV } = viewportHalfExtents(
      pose({ pz: 10_000 }),
      1,
      200,
      148,
    );
    expect(halfU).toBeLessThanOrEqual(200 + 1e-6);
    expect(halfV).toBeLessThanOrEqual(148 + 1e-6);
    expect(halfU / halfV).toBeCloseTo(ASPECT, 6);
  });

  it('degrades to the floor box when camera and target coincide', () => {
    const { halfU, halfV } = viewportHalfExtents(pose({ pz: 0 }), 1, 200, 148);
    expect(Number.isFinite(halfU)).toBe(true);
    expect(Number.isFinite(halfV)).toBe(true);
    expect(Math.min(halfU, halfV)).toBeCloseTo(4, 6);
    expect(halfU / halfV).toBeCloseTo(ASPECT, 6);
  });
});

describe('boxCorners', () => {
  it('is axis-aligned for a map-up heading', () => {
    const c = boxCorners(100, 74, 0, -1, 10, 20);
    expect(c[0][0]).toBeCloseTo(90, 6);
    expect(c[0][1]).toBeCloseTo(54, 6);
    expect(c[1][0]).toBeCloseTo(110, 6);
    expect(c[1][1]).toBeCloseTo(54, 6);
    expect(c[2][0]).toBeCloseTo(110, 6);
    expect(c[2][1]).toBeCloseTo(94, 6);
    expect(c[3][0]).toBeCloseTo(90, 6);
    expect(c[3][1]).toBeCloseTo(94, 6);
  });

  it('rotates with the heading (extents swap at 90 degrees)', () => {
    const c = boxCorners(100, 74, 1, 0, 10, 20);
    expect(c[0][0]).toBeCloseTo(120, 6);
    expect(c[0][1]).toBeCloseTo(64, 6);
    expect(c[1][0]).toBeCloseTo(120, 6);
    expect(c[1][1]).toBeCloseTo(84, 6);
    expect(c[2][0]).toBeCloseTo(80, 6);
    expect(c[2][1]).toBeCloseTo(84, 6);
    expect(c[3][0]).toBeCloseTo(80, 6);
    expect(c[3][1]).toBeCloseTo(64, 6);
  });
});

describe('clampToRect', () => {
  it('leaves interior points untouched', () => {
    expect(clampToRect(50, 60, 6, 194, 6, 142)).toEqual({
      x: 50,
      y: 60,
      clamped: false,
    });
  });

  it('pins exterior points to the border and reports it', () => {
    expect(clampToRect(-5, 300, 6, 194, 6, 142)).toEqual({
      x: 6,
      y: 142,
      clamped: true,
    });
  });
});

describe('arrowVertices', () => {
  it('puts the tip along the heading and the base behind it', () => {
    const [tip, baseL, baseR] = arrowVertices(50, 50, 0, -1, 6);
    expect(tip[0]).toBeCloseTo(50, 6);
    expect(tip[1]).toBeCloseTo(44, 6);
    // base corners sit behind the anchor, symmetric across the heading axis
    expect(baseL[1]).toBeCloseTo(53, 6);
    expect(baseR[1]).toBeCloseTo(53, 6);
    expect(baseL[0] + baseR[0]).toBeCloseTo(100, 6);
    expect(baseL[0]).toBeGreaterThan(baseR[0]);
  });

  it('rotates rigidly with the heading', () => {
    const up = arrowVertices(0, 0, 0, -1, 6);
    const right = arrowVertices(0, 0, 1, 0, 6);
    // 90deg rotation: (x, y) -> (-y, x)
    for (let i = 0; i < 3; i++) {
      expect(right[i][0]).toBeCloseTo(-up[i][1], 6);
      expect(right[i][1]).toBeCloseTo(up[i][0], 6);
    }
  });
});
