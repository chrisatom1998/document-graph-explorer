import { describe, expect, it } from 'vitest';
import { labelBounds, labelsOverlap, labelWorldScale } from './labelLayout';

describe('screen-space graph labels', () => {
  it.each([8, 75, 320, 1600])('keeps a 12px label readable at view depth %s', (depth) => {
    const font = 2.3;
    const projectionY = 1.92;
    const height = 856;
    const scale = labelWorldScale(font, 12, depth, projectionY, height);
    expect(font * scale * height * projectionY / (2 * depth)).toBeCloseTo(12);
  });

  it('keeps focused labels larger without growing when the camera approaches', () => {
    const normal = labelWorldScale(2.3, 12, 8, 1.92, 856);
    const focused = labelWorldScale(2.3, 14, 8, 1.92, 856);
    expect(focused / normal).toBeCloseTo(14 / 12);
  });

  it('does not generate an invalid scale behind the camera or at a zero viewport', () => {
    expect(labelWorldScale(2.3, 12, -8, 1.92, 856)).toBe(0);
    expect(labelWorldScale(2.3, 12, 0, 1.92, 856)).toBe(0);
    expect(labelWorldScale(2.3, 12, 8, 1.92, 0)).toBe(0);
  });

  it('reserves the full wrapped title area for focused documents', () => {
    const short = labelBounds(400, 200, 'Guide', 14, false, 300);
    const long = labelBounds(400, 200, 'Long document title '.repeat(8), 14, false, 300);
    expect(long.right - long.left).toBe(310);
    expect(long.bottom - long.top).toBeGreaterThan(short.bottom - short.top);
    expect(labelsOverlap(long, labelBounds(400, 175, 'Nearby', 12, false, 300))).toBe(true);
  });

  it('allows separated labels and suppresses colliding labels in both map modes', () => {
    for (const flat of [false, true]) {
      const first = labelBounds(200, 200, 'Project notes', 12, flat, 300);
      expect(labelsOverlap(first, labelBounds(202, 202, 'Second note', 12, flat, 300))).toBe(true);
      expect(labelsOverlap(first, labelBounds(550, 200, 'Second note', 12, flat, 300))).toBe(false);
    }
  });
});
