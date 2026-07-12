import type { RetrievalBenchmarkCase } from '../dev/retrievalBenchmarkCases';

export interface BenchmarkCaseResult {
  id: string;
  category: RetrievalBenchmarkCase['category'];
  query: string;
  expectedFiles: string[];
  rankedFiles: string[];
  latencyMs: number;
  critical: boolean;
}

export interface BenchmarkMetrics {
  recallAt5: number;
  mrrAt10: number;
  topResultAccuracy: number;
  criticalAccuracy: number;
  falsePositiveCount: number;
  meanLatencyMs: number;
}

export interface RetrievalBenchmarkReport {
  createdAt: string;
  corpusDocuments: number;
  baseline: { metrics: BenchmarkMetrics; cases: BenchmarkCaseResult[] };
  candidate: { metrics: BenchmarkMetrics; cases: BenchmarkCaseResult[] };
  accepted: boolean;
  decision: string;
}

function matches(file: string, expected: string): boolean {
  return file.toLowerCase().endsWith(expected.toLowerCase());
}

export function benchmarkMetrics(results: BenchmarkCaseResult[]): BenchmarkMetrics {
  const answerable = results.filter((result) => result.expectedFiles.length > 0);
  const noAnswer = results.filter((result) => result.expectedFiles.length === 0);
  const recallAt5 = answerable.reduce((total, result) => {
    const top = result.rankedFiles.slice(0, 5);
    const found = result.expectedFiles.filter((expected) => top.some((file) => matches(file, expected))).length;
    return total + found / result.expectedFiles.length;
  }, 0) / Math.max(1, answerable.length);
  const mrrAt10 = answerable.reduce((total, result) => {
    const rank = result.rankedFiles.slice(0, 10).findIndex((file) =>
      result.expectedFiles.some((expected) => matches(file, expected)));
    return total + (rank < 0 ? 0 : 1 / (rank + 1));
  }, 0) / Math.max(1, answerable.length);
  const topResultAccuracy = answerable.filter((result) =>
    result.rankedFiles[0]
      && result.expectedFiles.some((expected) => matches(result.rankedFiles[0], expected)),
  ).length / Math.max(1, answerable.length);
  const critical = answerable.filter((result) => result.critical);
  const criticalAccuracy = critical.filter((result) => {
    const top = result.rankedFiles.slice(0, 5);
    return result.expectedFiles.every((expected) => top.some((file) => matches(file, expected)));
  }).length / Math.max(1, critical.length);
  return {
    recallAt5,
    mrrAt10,
    topResultAccuracy,
    criticalAccuracy,
    falsePositiveCount: noAnswer.filter((result) => result.rankedFiles.length > 0).length,
    meanLatencyMs: results.reduce((sum, result) => sum + result.latencyMs, 0) / Math.max(1, results.length),
  };
}

export function buildBenchmarkReport(
  corpusDocuments: number,
  baselineCases: BenchmarkCaseResult[],
  candidateCases: BenchmarkCaseResult[],
): RetrievalBenchmarkReport {
  const baselineMetrics = benchmarkMetrics(baselineCases);
  const candidateMetrics = benchmarkMetrics(candidateCases);
  const noRegression = candidateMetrics.recallAt5 >= baselineMetrics.recallAt5
    && candidateMetrics.criticalAccuracy >= baselineMetrics.criticalAccuracy;
  const qualityImproved = candidateMetrics.mrrAt10 > baselineMetrics.mrrAt10
    || candidateMetrics.topResultAccuracy > baselineMetrics.topResultAccuracy;
  const accepted = noRegression && qualityImproved;
  return {
    createdAt: new Date().toISOString(),
    corpusDocuments,
    baseline: { metrics: baselineMetrics, cases: baselineCases },
    candidate: { metrics: candidateMetrics, cases: candidateCases },
    accepted,
    decision: accepted
      ? 'Candidate accepted: no Recall@5 or critical-query regression, with better ranking quality.'
      : !noRegression
        ? 'Candidate rejected: Recall@5 or critical-query accuracy regressed.'
        : 'Candidate not proven: ranking quality did not improve over baseline.',
  };
}
