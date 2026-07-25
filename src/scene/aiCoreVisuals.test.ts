import { describe, expect, it } from 'vitest';
import {
  computeAiCoreCorpusScale,
  computeAiCoreVisuals,
} from './aiCoreVisuals';

describe('computeAiCoreVisuals', () => {
  it('clamps energy to the supported range', () => {
    expect(computeAiCoreVisuals(-2, 0, false)).toEqual(
      computeAiCoreVisuals(0, 0, false),
    );
    expect(computeAiCoreVisuals(4, 0, false)).toEqual(
      computeAiCoreVisuals(1, 0, false),
    );
  });

  it('makes an active core brighter and faster', () => {
    const idle = computeAiCoreVisuals(0, 0, false);
    const active = computeAiCoreVisuals(1, 0, false);

    expect(active.glowOpacity).toBeGreaterThan(idle.glowOpacity);
    expect(active.shellIntensity).toBeGreaterThan(idle.shellIntensity);
    expect(active.angularSpeed).toBeGreaterThan(idle.angularSpeed);
  });

  it('removes phase-driven motion when reduced motion is requested', () => {
    const first = computeAiCoreVisuals(0.7, 0, true);
    const later = computeAiCoreVisuals(0.7, Math.PI / 2, true);

    expect(later).toEqual(first);
    expect(later.angularSpeed).toBe(0);
  });
});

describe('computeAiCoreCorpusScale', () => {
  it('keeps small corpora at the baseline size', () => {
    expect(computeAiCoreCorpusScale(0)).toBe(1);
    expect(computeAiCoreCorpusScale(36)).toBe(1);
  });

  it('grows with sqrt of document count to match the orbit shell', () => {
    const scale = computeAiCoreCorpusScale(2000);
    // shell ≈ 11 * sqrt(2000) ≈ 492 → scale ≈ 492 / 72 ≈ 6.83
    expect(scale).toBeCloseTo((11 * Math.sqrt(2000)) / 72, 5);
    expect(scale).toBeGreaterThan(6);
  });

  it('treats negative counts as empty', () => {
    expect(computeAiCoreCorpusScale(-10)).toBe(1);
  });
});
