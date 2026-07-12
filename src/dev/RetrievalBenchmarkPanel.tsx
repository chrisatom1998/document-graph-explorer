import { useState } from 'react';
import type { DocNode } from '../model/types';
import { loadDemoCorpus, resetCorpus } from '../pipeline/coordinator';
import { SEARCH_MIN_SCORE } from '../config';
import { retrieveCorpus, retrievalTerms, type RetrievalHit } from '../search/retrieval';
import {
  buildBenchmarkReport,
  type BenchmarkCaseResult,
  type RetrievalBenchmarkReport,
} from '../search/retrievalBenchmark';
import { useGraphStore } from '../store/graphStore';
import { RETRIEVAL_BENCHMARK_CASES } from './retrievalBenchmarkCases';

type RunState = 'idle' | 'loading' | 'running' | 'done' | 'error';

function fileForNode(node: DocNode): string {
  return node.path?.replace(/^.*[\\/]/, '') ?? node.title;
}

function legacyLabelMatch(node: DocNode, query: string): boolean {
  const terms = retrievalTerms(query);
  const labels = [...(node.topics ?? []), ...(node.keywords ?? []), ...(node.entities ?? [])]
    .map((label) => label.toLowerCase());
  return labels.some((label) => terms.some((term) => label === term || label.includes(term)));
}

/** Reconstruct the pre-refactor document ranking from the same raw candidates. */
function baselineRanking(query: string, nodes: DocNode[], hits: RetrievalHit[]): string[] {
  const maxSemanticByDoc = new Map<string, number>();
  for (const hit of hits) {
    if (hit.semanticScore === undefined) continue;
    maxSemanticByDoc.set(hit.docId, Math.max(maxSemanticByDoc.get(hit.docId) ?? -Infinity, hit.semanticScore));
  }
  const queryLower = query.trim().toLowerCase();
  return nodes
    .filter((node) => node.kind === 'document')
    .map((node) => {
      const semantic = maxSemanticByDoc.get(node.id) ?? -Infinity;
      const titleMatch = node.title.toLowerCase().includes(queryLower);
      const keywordMatch = legacyLabelMatch(node, query);
      const score = titleMatch ? 1 : keywordMatch ? 0.8 : semantic;
      return { node, score, titleMatch, keywordMatch };
    })
    .filter(({ score, titleMatch, keywordMatch }) => titleMatch || keywordMatch || score >= SEARCH_MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id))
    .map(({ node }) => fileForNode(node));
}

function candidateRanking(nodes: DocNode[], hits: RetrievalHit[]): string[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const files: string[] = [];
  for (const hit of hits) {
    if (seen.has(hit.docId)) continue;
    const node = nodeById.get(hit.docId);
    if (!node) continue;
    seen.add(hit.docId);
    files.push(fileForNode(node));
  }
  return files;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function RetrievalBenchmarkPanel() {
  const [state, setState] = useState<RunState>('idle');
  const [completed, setCompleted] = useState(0);
  const [report, setReport] = useState<RetrievalBenchmarkReport | null>(null);
  const [error, setError] = useState('');

  if (!import.meta.env.DEV) return null;

  const run = async () => {
    setState('loading');
    setCompleted(0);
    setReport(null);
    setError('');
    try {
      resetCorpus();
      await loadDemoCorpus();
      const nodes = useGraphStore.getState().nodes;
      const baselineCases: BenchmarkCaseResult[] = [];
      const candidateCases: BenchmarkCaseResult[] = [];
      setState('running');

      for (let index = 0; index < RETRIEVAL_BENCHMARK_CASES.length; index++) {
        const benchmarkCase = RETRIEVAL_BENCHMARK_CASES[index];
        const started = performance.now();
        const hits = await retrieveCorpus(benchmarkCase.query, {
          limit: 4096,
          perDocument: 256,
          timeoutMs: 15_000,
          minSemanticScore: SEARCH_MIN_SCORE,
        });
        const latencyMs = performance.now() - started;
        const common = {
          id: benchmarkCase.id,
          category: benchmarkCase.category,
          query: benchmarkCase.query,
          expectedFiles: benchmarkCase.expectedFiles,
          latencyMs,
          critical: benchmarkCase.critical ?? false,
        };
        baselineCases.push({ ...common, rankedFiles: baselineRanking(benchmarkCase.query, nodes, hits) });
        candidateCases.push({ ...common, rankedFiles: candidateRanking(nodes, hits) });
        setCompleted(index + 1);
      }

      const nextReport = buildBenchmarkReport(nodes.filter((node) => node.kind === 'document').length, baselineCases, candidateCases);
      setReport(nextReport);
      setState('done');
      (window as unknown as { __retrievalBenchmark?: RetrievalBenchmarkReport }).__retrievalBenchmark = nextReport;
      console.info('[knowledge-nebula] retrieval benchmark', nextReport);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setState('error');
    }
  };

  const download = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `retrieval-benchmark-${report.createdAt.replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const metrics = report?.candidate.metrics;
  return (
    <aside style={{ position: 'fixed', inset: '16px 16px auto auto', zIndex: 10000, width: 420, maxHeight: 'calc(100vh - 32px)', overflow: 'auto', padding: 16, borderRadius: 12, color: '#eef5ff', background: 'rgba(8, 15, 30, .96)', border: '1px solid rgba(127,180,255,.45)', font: '13px/1.45 system-ui' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Retrieval benchmark</h2>
      <p style={{ margin: '0 0 12px', opacity: .78 }}>Development only. Running resets the current corpus, loads the 36 bundled demo documents, and evaluates 30 grounded queries.</p>
      <button type="button" onClick={() => void run()} disabled={state === 'loading' || state === 'running'}>
        {state === 'loading' ? 'Loading demo corpus...' : state === 'running' ? `Running ${completed}/30...` : 'Run benchmark'}
      </button>
      {state === 'error' && <p style={{ color: '#ff9d9d' }}>Benchmark failed: {error}</p>}
      {report && metrics && (
        <div style={{ marginTop: 14 }}>
          <p><strong>{report.accepted ? 'PASS' : 'REVIEW'}</strong> - {report.decision}</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Metric</th><th>Baseline</th><th>Candidate</th></tr></thead>
            <tbody>
              <tr><td>Recall@5</td><td>{percent(report.baseline.metrics.recallAt5)}</td><td>{percent(metrics.recallAt5)}</td></tr>
              <tr><td>MRR@10</td><td>{report.baseline.metrics.mrrAt10.toFixed(3)}</td><td>{metrics.mrrAt10.toFixed(3)}</td></tr>
              <tr><td>Top-result accuracy</td><td>{percent(report.baseline.metrics.topResultAccuracy)}</td><td>{percent(metrics.topResultAccuracy)}</td></tr>
              <tr><td>Critical accuracy</td><td>{percent(report.baseline.metrics.criticalAccuracy)}</td><td>{percent(metrics.criticalAccuracy)}</td></tr>
              <tr><td>False positives</td><td>{report.baseline.metrics.falsePositiveCount}</td><td>{metrics.falsePositiveCount}</td></tr>
              <tr><td>Mean latency</td><td>{report.baseline.metrics.meanLatencyMs.toFixed(0)} ms</td><td>{metrics.meanLatencyMs.toFixed(0)} ms</td></tr>
            </tbody>
          </table>
          <button type="button" onClick={download} style={{ marginTop: 12 }}>Download JSON report</button>
        </div>
      )}
    </aside>
  );
}
