import { describe, expect, it } from 'vitest';
import { computeAiCoreVisuals } from './aiCoreVisuals';

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
