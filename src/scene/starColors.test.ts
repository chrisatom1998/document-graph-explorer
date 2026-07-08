/**
 * Physical-sanity floors for the starfield's color/brightness samplers: the
 * blackbody approximation must stay warm→white→cool across the stellar range,
 * and the population samplers must keep the photographic distribution (mostly
 * modest yellow-white stars, few bright ones) that makes the field read real.
 */

import { describe, expect, it } from 'vitest';
import {
  blackbodyColor,
  sampleStarBrightness,
  sampleStarTemperature,
} from './starColors';

/** Deterministic RNG (mulberry32) so distribution tests can't flake. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('blackbodyColor', () => {
  it('stays inside [0,1] across the whole stellar range', () => {
    for (let t = 1000; t <= 40000; t += 250) {
      const [r, g, b] = blackbodyColor(t);
      for (const c of [r, g, b]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is warm (r > g > b) at 3000K and cool (b > r) at 20000K', () => {
    const [wr, wg, wb] = blackbodyColor(3000);
    expect(wr).toBeGreaterThan(wg);
    expect(wg).toBeGreaterThan(wb);
    const [cr, , cb] = blackbodyColor(20000);
    expect(cb).toBeGreaterThan(cr);
  });

  it('is near-white at ~6600K (the Planckian white point)', () => {
    const [r, g, b] = blackbodyColor(6600);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.08);
    expect(Math.min(r, g, b)).toBeGreaterThan(0.9);
  });

  it('cools monotonically: red/blue ratio falls as temperature rises', () => {
    let prevRatio = Infinity;
    for (const t of [2500, 4000, 5500, 7000, 10000, 15000, 25000]) {
      const [r, , b] = blackbodyColor(t);
      const ratio = r / Math.max(b, 1e-6);
      expect(ratio).toBeLessThanOrEqual(prevRatio);
      prevRatio = ratio;
    }
  });
});

describe('star population samplers', () => {
  const N = 10_000;

  it('temperatures stay in the visible-star band, median yellow-white', () => {
    const rand = mulberry32(42);
    const temps: number[] = [];
    for (let i = 0; i < N; i++) temps.push(sampleStarTemperature(rand));
    for (const t of temps) {
      expect(t).toBeGreaterThanOrEqual(2500);
      expect(t).toBeLessThanOrEqual(30000);
    }
    temps.sort((a, b) => a - b);
    const median = temps[N / 2];
    expect(median).toBeGreaterThan(4200);
    expect(median).toBeLessThan(7500);
  });

  it('brightness is a dim-heavy power law in (0, 1]', () => {
    const rand = mulberry32(7);
    const bs: number[] = [];
    for (let i = 0; i < N; i++) bs.push(sampleStarBrightness(rand));
    for (const b of bs) {
      expect(b).toBeGreaterThan(0);
      expect(b).toBeLessThanOrEqual(1);
    }
    bs.sort((a, b) => a - b);
    // photographic skew: the median star is far dimmer than the brightest
    expect(bs[N / 2]).toBeLessThan(0.35);
    expect(bs[N - 1]).toBeGreaterThan(0.8);
  });
});
