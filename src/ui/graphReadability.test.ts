import { describe, expect, it } from 'vitest';
import {
  READABILITY_PRESETS,
  edgeDensityFromWeight,
  estimateRemainingMs,
  formatEta,
  matchingPreset,
  toggleEdgeKindVisibility,
  weightFromEdgeDensity,
} from './graphReadability';

describe('graph readability helpers', () => {
  it('toggles legend kinds from all-on to a hidden set and back to null', () => {
    const hidden = toggleEdgeKindVisibility(null, 'semantic');
    expect(hidden).toEqual(['reference', 'keyword', 'entity']);
    expect(toggleEdgeKindVisibility(hidden, 'semantic')).toBeNull();
  });

  it('maps edge density to min weight and back', () => {
    expect(weightFromEdgeDensity(1)).toBe(0);
    expect(edgeDensityFromWeight(0)).toBe(1);
    expect(weightFromEdgeDensity(0)).toBeCloseTo(0.7);
  });

  it('estimates remaining time once a few files have finished', () => {
    expect(estimateRemainingMs(0, 10, 2000)).toBeNull();
    expect(estimateRemainingMs(4, 10, 2000)).toBe(3000);
    expect(formatEta(3200)).toBe('~3s left');
    expect(formatEta(70_000)).toBe('~1m left');
  });

  it('recognizes the balanced preset', () => {
    const balanced = READABILITY_PRESETS.balanced;
    expect(
      matchingPreset(balanced.minEdgeWeight, balanced.labelDensity, balanced.clusterAtmosphere),
    ).toBe('balanced');
    expect(matchingPreset(0.2, 0.5, 0.5)).toBeNull();
  });
});
