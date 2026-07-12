import { describe, expect, it } from 'vitest';
import { benchmarkMetrics, buildBenchmarkReport, type BenchmarkCaseResult } from './retrievalBenchmark';

function result(
  id: string,
  expectedFiles: string[],
  rankedFiles: string[],
  critical = false,
): BenchmarkCaseResult {
  return {
    id,
    category: expectedFiles.length ? 'exact' : 'no-answer',
    query: id,
    expectedFiles,
    rankedFiles,
    latencyMs: 10,
    critical,
  };
}

describe('retrieval benchmark metrics', () => {
  it('computes recall, reciprocal rank, top accuracy, false positives, and latency', () => {
    const metrics = benchmarkMetrics([
      result('one', ['a.pdf'], ['x.pdf', 'a.pdf'], true),
      result('two', ['b.pdf', 'c.pdf'], ['b.pdf', 'y.pdf', 'c.pdf'], true),
      result('none', [], ['false-positive.pdf']),
    ]);
    expect(metrics.recallAt5).toBe(1);
    expect(metrics.mrrAt10).toBe(0.75);
    expect(metrics.topResultAccuracy).toBe(0.5);
    expect(metrics.criticalAccuracy).toBe(1);
    expect(metrics.falsePositiveCount).toBe(1);
    expect(metrics.meanLatencyMs).toBe(10);
  });

  it('accepts only a quality improvement with no recall or critical regression', () => {
    const baseline = [result('one', ['a.pdf'], ['x.pdf', 'a.pdf'], true)];
    const improved = [result('one', ['a.pdf'], ['a.pdf'], true)];
    const regressed = [result('one', ['a.pdf'], [], true)];
    expect(buildBenchmarkReport(1, baseline, improved).accepted).toBe(true);
    expect(buildBenchmarkReport(1, baseline, regressed).accepted).toBe(false);
  });
});
