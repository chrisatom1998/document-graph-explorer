import { FUSION_LABELS, type FusionAnalysis, type FusionScorer } from '../fusion';
import { releaseForScorer } from '../fusionRelease';
import type { MusicDecoder } from '../decodeMusic';
import { PASST_IDENTITY, PASST_POLICY } from './identity';
export const experimentalPaSSTEnabled = () => import.meta.env.VITE_EXPERIMENTAL_PASST === '1';
export interface PaSSTOptions {
 enabled?: boolean;
 baseline: FusionScorer;
 decoder: MusicDecoder;
 predict?: (samples: Float32Array, signal?: AbortSignal) => Promise<number[]>;
 onPhase?: (phase: string) => void;
 onResult?: (result: { samples: Float32Array; scores: number[]; milliseconds: number }) => void;
}
/** Unregistered experimental scores remain diagnostics; failure restores the actual baseline receipt. */
export function prepareExperimentalPaSST(options: PaSSTOptions) {
 let fallback = false;
 const previous = new Map<string, Awaited<ReturnType<FusionScorer['score']>>>();
 const key = (start: number, end: number) => `${start}:${end}`;
 const restore = (analysis: FusionAnalysis | undefined): FusionAnalysis | undefined => {
  if (!fallback || !analysis) return analysis;
  const release = releaseForScorer(options.baseline);
  return { ...analysis, identity: options.baseline.identity, validation: release ? 'policy-qualified' : 'unvalidated', ...(release ? { release } : {}), windows: analysis.windows.map(window => ({ ...window, decisions: previous.get(key(window.start, window.end)) ?? window.decisions })) };
 };
 if (!options.enabled) return { scorer: options.baseline, restore, usedFallback: () => false };
 const predict = options.predict ?? (async (samples: Float32Array, signal?: AbortSignal) => (await import('./backend')).predictPaSST(samples, signal));
 const scorer: FusionScorer = { identity: PASST_IDENTITY, async score(input, signal) {
  signal?.throwIfAborted();
  options.onPhase?.('Checking installed baseline');
  const old = await options.baseline.score(input, signal); previous.set(key(input.interval.start, input.interval.end), old);
  if (fallback) return old;
  try {
   if (input.interval.start !== 0 || input.interval.end !== 10) throw Error('Experimental PaSST requires one complete10second window');
   options.onPhase?.('Decoding PaSST32k section');
   const decoded = await options.decoder.read(0, 10, 32000); signal?.throwIfAborted();
   if (decoded.length < 319000 || decoded.length > 320000 || !decoded.every(Number.isFinite)) throw Error('Invalid PaSST decoded PCM');
   const samples = new Float32Array(320000); samples.set(decoded);
   options.onPhase?.('Running experimental PaSST worker');
   const started = performance.now(); const scores = await predict(samples, signal); signal?.throwIfAborted();
   if (scores.length !== 20 || scores.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw Error('Invalid PaSST score vector');
   options.onResult?.({ samples, scores: scores.slice(), milliseconds: performance.now() - started });
   return old.map((decision, i) => {
    const p = PASST_POLICY[FUSION_LABELS[i]];
    return p.enabled ? { ...decision, state: scores[i] >= p.threshold! ? 'positive' : 'negative', source: 'learned-head', eligible: true, headProbability: scores[i], decisionProbability: scores[i], positiveGroups: 0, negativeGroups: 0 } : decision;
   });
  } catch (error) {
   signal?.throwIfAborted();
   if (error instanceof DOMException && error.name === 'AbortError') throw error;
   fallback = true; return old;
  }
 } };
 return { scorer, restore, usedFallback: () => fallback };
}
