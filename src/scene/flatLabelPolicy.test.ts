import { describe, expect, it } from 'vitest';
import {
  flatLabelBudget,
  flatLabelOpacity,
  flatLabelPriority,
  flatLabelScale,
} from './flatLabelPolicy';

describe('flat label policy', () => {
  it('shows fewer labels at overview distance and more while zoomed in', () => {
    expect(flatLabelBudget(500, 100, 0, 40)).toBe(12);
    expect(flatLabelBudget(320, 100, 0, 40)).toBe(18);
    expect(flatLabelBudget(220, 100, 0, 40)).toBe(28);
    expect(flatLabelBudget(120, 100, 0, 40)).toBe(40);
  });

  it('honors the degraded quality cap and graph size', () => {
    expect(flatLabelBudget(100, 100, 3, 40)).toBe(12);
    expect(flatLabelBudget(100, 7, 0, 40)).toBe(7);
  });

  it('prioritizes a connected hub at the same distance', () => {
    expect(flatLabelPriority(10_000, 18)).toBeLessThan(flatLabelPriority(10_000, 0));
  });

  it('keeps overview labels larger but within readable bounds', () => {
    expect(flatLabelScale(80)).toBe(1.05);
    expect(flatLabelScale(800)).toBe(1.7);
    expect(flatLabelOpacity(80)).toBe(0.92);
    expect(flatLabelOpacity(800)).toBe(0.62);
  });
});
