/**
 * Regression floors for the cluster palette, mirroring the dataviz checks it
 * was validated against (dark surface #050510). Floors sit below the measured
 * values at authoring time (adjacent ΔEok 0.204, all-pairs 0.041, contrast
 * > 3:1) so a formula tweak that erodes separation fails loudly.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clusterColor, hexFor, oklabLightness } from './palette';

const CLUSTERS = 12; // "first N clusters" scope of the audit
const SURFACE = new THREE.Color('#050510');

/** Full OKLab triple from a THREE.Color (linear working-space components). */
function oklab(c: THREE.Color): [number, number, number] {
  const l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  const m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  const s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  const l3 = Math.cbrt(l);
  const m3 = Math.cbrt(m);
  const s3 = Math.cbrt(s);
  return [
    0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3,
    1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3,
    0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3,
  ];
}

function deltaEok(a: THREE.Color, b: THREE.Color): number {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** WCAG relative luminance from linear components. */
const relLum = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

function contrast(a: THREE.Color, b: THREE.Color): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('cluster palette', () => {
  it('is stable per cluster id and cached', () => {
    expect(clusterColor(3)).toBe(clusterColor(3));
    expect(hexFor(3)).toBe(hexFor(3));
  });

  it('equalizes OKLab lightness into the dark-surface band', () => {
    for (let i = 0; i < CLUSTERS; i++) {
      const L = oklabLightness(clusterColor(i));
      expect(L, `cluster ${i} lightness`).toBeGreaterThan(0.58);
      expect(L, `cluster ${i} lightness`).toBeLessThan(0.68);
    }
  });

  it('keeps consecutive cluster ids well separated (ΔEok ≥ 0.12)', () => {
    for (let i = 0; i < CLUSTERS - 1; i++) {
      const d = deltaEok(clusterColor(i), clusterColor(i + 1));
      expect(d, `clusters ${i}↔${i + 1}`).toBeGreaterThan(0.12);
    }
  });

  it('keeps every pair among the first 12 distinguishable (ΔEok ≥ 0.025)', () => {
    for (let i = 0; i < CLUSTERS; i++) {
      for (let j = i + 1; j < CLUSTERS; j++) {
        const d = deltaEok(clusterColor(i), clusterColor(j));
        expect(d, `clusters ${i}↔${j}`).toBeGreaterThan(0.025);
      }
    }
  });

  it('clears 3:1 contrast against the void background', () => {
    for (let i = 0; i < CLUSTERS; i++) {
      expect(contrast(clusterColor(i), SURFACE), `cluster ${i}`).toBeGreaterThan(3);
    }
    expect(contrast(clusterColor(-1), SURFACE), 'neutral').toBeGreaterThan(3);
  });
});
