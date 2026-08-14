import { afterEach, describe, expect, it, vi } from 'vitest';
import { settleBloomBoost, triggerSettleCue } from './settleCue';

describe('settleCue', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns a decaying bloom boost after trigger', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList);

    const t0 = 1_000_000;
    vi.spyOn(performance, 'now').mockReturnValue(t0);
    triggerSettleCue();
    expect(settleBloomBoost(t0)).toBeGreaterThan(0.05);
    expect(settleBloomBoost(t0 + 400)).toBeGreaterThan(0.02);
    expect(settleBloomBoost(t0 + 400)).toBeLessThan(settleBloomBoost(t0));
    expect(settleBloomBoost(t0 + 900)).toBe(0);
  });
});
