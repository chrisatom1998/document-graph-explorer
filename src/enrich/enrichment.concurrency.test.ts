/**
 * Pass-1 enrichment batches run several at a time — a 500-document corpus is
 * 34 requests, and running them strictly one after another wasted most of the
 * wall clock waiting on the model. The pool must respect its limit (rate
 * limits) and keep results in input order (a batch's results are matched to
 * documents by id, but order still drives which error is reported last).
 */
import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './enrichment';

describe('mapWithConcurrency', () => {
  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency([...Array(20).keys()], 4, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // actually parallel, not accidentally serial
  });

  it('returns results in input order even when later items finish first', async () => {
    const out = await mapWithConcurrency([30, 20, 10, 0], 4, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return index;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it('runs every item exactly once', async () => {
    const seen: number[] = [];
    await mapWithConcurrency([...Array(50).keys()], 4, async (n) => {
      seen.push(n);
      return n;
    });
    expect(seen).toHaveLength(50);
    expect(new Set(seen).size).toBe(50);
  });

  it('handles an empty list and a limit larger than the list', async () => {
    expect(await mapWithConcurrency([], 4, async (n) => n)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 99, async (n) => n * 2)).toEqual([2, 4]);
  });
});
