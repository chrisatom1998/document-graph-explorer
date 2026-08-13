import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomSpherePoint } from './spawnPosition';

describe('randomSpherePoint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates points on a spherical shell of exact radius when jitter is 0', () => {
    const radius = 100;
    for (let i = 0; i < 50; i++) {
      const [x, y, z] = randomSpherePoint(radius, 0);
      const dist = Math.hypot(x, y, z);
      expect(dist).toBeCloseTo(radius, 5);
    }
  });

  it('defaults jitter to 0 when omitted', () => {
    const radius = 75;
    const [x, y, z] = randomSpherePoint(radius);
    const dist = Math.hypot(x, y, z);
    expect(dist).toBeCloseTo(radius, 5);
  });

  it('places points within [radius - jitter, radius + jitter] when jitter is positive', () => {
    const radius = 100;
    const jitter = 25;
    const minExpected = radius - jitter;
    const maxExpected = radius + jitter;

    for (let i = 0; i < 100; i++) {
      const [x, y, z] = randomSpherePoint(radius, jitter);
      const dist = Math.hypot(x, y, z);
      expect(dist).toBeGreaterThanOrEqual(minExpected - 1e-6);
      expect(dist).toBeLessThanOrEqual(maxExpected + 1e-6);
    }
  });

  it('returns [0, 0, 0] when radius is 0 and jitter is 0', () => {
    const [x, y, z] = randomSpherePoint(0, 0);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(0, 5);
  });

  it('produces deterministic spherical coordinates when Math.random is mocked', () => {
    // Math.random calls in order: u_rand, phi_rand, r_rand
    // 1. u_rand = 0.5 => u = 2*(0.5)-1 = 0 (equatorial plane z=0)
    // 2. phi_rand = 0 => phi = 0 (positive x axis)
    // 3. r_rand = 0.5 => r = 100 + 2*(0.5-0.5)*10 = 100
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.5)  // u = 0
      .mockReturnValueOnce(0)    // phi = 0
      .mockReturnValueOnce(0.5);  // jitter offset = 0

    const [x, y, z] = randomSpherePoint(100, 10);
    expect(x).toBeCloseTo(100, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(0, 5);
  });

  it('correctly calculates north pole coordinate when u = 1 (cos theta = 1)', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(1.0)  // u = 2*(1)-1 = 1 (z = radius)
      .mockReturnValueOnce(0.25) // phi (irrelevant when s = 0)
      .mockReturnValueOnce(0.5);  // jitter offset = 0

    const [x, y, z] = randomSpherePoint(50, 0);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(50, 5);
  });

  it('returns valid 3D tuple structure with finite numeric values', () => {
    const pt = randomSpherePoint(10, 2);
    expect(pt).toHaveLength(3);
    expect(Number.isFinite(pt[0])).toBe(true);
    expect(Number.isFinite(pt[1])).toBe(true);
    expect(Number.isFinite(pt[2])).toBe(true);
  });
});
