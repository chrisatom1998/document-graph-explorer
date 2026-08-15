import { describe, expect, it } from 'vitest';
import { NODE_FADE_FAR, NODE_FADE_MIN, NODE_FADE_NEAR, viewDistanceFade } from './viewDistance';

describe('viewDistanceFade', () => {
  it('stays full brightness near the camera', () => {
    expect(viewDistanceFade(0)).toBe(1);
    expect(viewDistanceFade(NODE_FADE_NEAR)).toBe(1);
  });

  it('eases to the floor at far range', () => {
    expect(viewDistanceFade(NODE_FADE_FAR)).toBe(NODE_FADE_MIN);
    expect(viewDistanceFade(NODE_FADE_FAR + 200)).toBe(NODE_FADE_MIN);
  });

  it('is between the endpoints in the fade band', () => {
    const mid = viewDistanceFade((NODE_FADE_NEAR + NODE_FADE_FAR) / 2);
    expect(mid).toBeGreaterThan(NODE_FADE_MIN);
    expect(mid).toBeLessThan(1);
  });
});
