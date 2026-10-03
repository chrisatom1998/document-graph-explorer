import { installedFusionIdentity, sameFusionRelease, sanitizeFusionReleaseIdentity, type FusionReleaseIdentity } from './fusionRelease';
import type { DescriptionScore } from './profileDescriptions';
import type { Interval, ModelJob } from './recognition';

export const FUSION_LABELS = ['accordion','banjo','bass','cello','clarinet','cymbals','drums','flute','guitar','mallet_percussion','mandolin','organ','piano','saxophone','synthesizer','trombone','trumpet','ukulele','violin','voice'] as const;
export type FusionLabel = typeof FUSION_LABELS[number];
export const MAX_FUSION_WINDOWS = 512;
export interface FusionIdentity { modelSha256: string; policySha256: string; scorerSha256: string }
export interface FusionDecision {
  label: FusionLabel;
  state: 'positive' | 'negative' | 'uncertain' | 'unavailable';
  headProbability: number | null;
  decisionProbability: number | null;
  source: 'learned-head' | 'guarded-binary-baseline' | 'unavailable';
  eligible: boolean;
  positiveGroups: number;
  negativeGroups: number;
}
export type FusionStatus = 'complete' | 'failed' | 'unsupported' | 'empty';
export interface FusionWindow extends Interval { status: FusionStatus; reason?: string; decisions: FusionDecision[] }
export interface FusionAnalysis {
  version: 1;
  scope: 'window';
  validation: 'unvalidated' | 'policy-qualified';
  release?: FusionReleaseIdentity;
  /** Imported predictions never inherit trusted local activation. */
  imported?: true;
  identity: FusionIdentity;
  planned: number;
  counts: Record<FusionStatus, number>;
  omittedWindows: number;
  windows: FusionWindow[];
}
/** Explicit opt-in for isolated qualification; the app uses its pinned accepted release. */
export interface FusionScorer {
  identity: FusionIdentity;
  score(input: { interval: Interval; audioFingerprint?: string; raw: {
    ast: { instruments: Record<string, number> }; jamendo: Record<string, number>; clap: { descriptions: DescriptionScore[] };
  }; native: Array<Pick<ModelJob, 'modelId' | 'weightsVersion' | 'preprocessingVersion' | 'promptVersion'> & { cacheKey: string; cacheHit: boolean }>
   }, signal?: AbortSignal): Promise<FusionDecision[]>;
}
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown, max = 20000): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
export function sanitizeFusionIdentity(raw: unknown): FusionIdentity | undefined {
  const v = raw as FusionIdentity | undefined;
  return v && hash(v.modelSha256) && hash(v.policySha256) && hash(v.scorerSha256)
    ? { modelSha256: v.modelSha256, policySha256: v.policySha256, scorerSha256: v.scorerSha256 } : undefined;
}
export function sanitizeFusionDecisions(raw: unknown, complete: boolean): FusionDecision[] | undefined {
  if (!Array.isArray(raw) || raw.length !== 20) return;
  const decisions: FusionDecision[] = [];
  for (let i = 0; i < 20; i++) {
    const d = raw[i] as FusionDecision;
    if (!d || d.label !== FUSION_LABELS[i] || !integer(d.positiveGroups) || !integer(d.negativeGroups) || typeof d.eligible !== 'boolean') return;
    if (!complete) {
      if (d.headProbability !== null || d.state !== 'unavailable' || d.decisionProbability !== null || d.source !== 'unavailable' || d.eligible || d.positiveGroups || d.negativeGroups) return;
    } else {
      if (typeof d.headProbability !== 'number' || !Number.isFinite(d.headProbability) || d.headProbability < 0 || d.headProbability > 1) return;
      if (!['positive','negative','uncertain'].includes(d.state)) return;
      if (d.source === 'learned-head') {
        if (typeof d.decisionProbability !== 'number' || !Number.isFinite(d.decisionProbability) || d.decisionProbability < 0 || d.decisionProbability > 1 || d.decisionProbability !== d.headProbability) return;
      } else if (d.source !== 'guarded-binary-baseline' || d.decisionProbability !== null || d.state === 'uncertain') return;
    }
    decisions.push({ label: d.label, state: d.state, headProbability: d.headProbability, decisionProbability: d.decisionProbability, source: d.source, eligible: d.eligible, positiveGroups: d.positiveGroups, negativeGroups: d.negativeGroups });
  }
  return decisions;
}
export function unavailableFusionDecisions(): FusionDecision[] {
  return FUSION_LABELS.map(label => ({ label, state: 'unavailable', headProbability: null, decisionProbability: null, source: 'unavailable', eligible: false, positiveGroups: 0, negativeGroups: 0 }));
}
export function sanitizeFusion(raw: unknown, duration: number): FusionAnalysis | undefined {
  const f = raw as FusionAnalysis | undefined;
  const identity = sanitizeFusionIdentity(f?.identity);
  if (!f || f.version !== 1 || f.scope !== 'window' || !['unvalidated', 'policy-qualified'].includes(f.validation) || !identity || !integer(f.planned) || !integer(f.omittedWindows) || !f.counts || !Array.isArray(f.windows) || f.windows.length > MAX_FUSION_WINDOWS) return;
  const release = sanitizeFusionReleaseIdentity(f.release);
  if (f.validation === 'policy-qualified' && (!sameFusionRelease(release, installedFusionIdentity()) || JSON.stringify(sanitizeFusionIdentity(release)) !== JSON.stringify(identity))) return;
  if (f.validation === 'unvalidated' && f.release !== undefined) return;
  const counts = { complete: f.counts.complete, failed: f.counts.failed, unsupported: f.counts.unsupported, empty: f.counts.empty };
  if (!Object.values(counts).every(n => integer(n))) return;
  const processed = Object.values(counts).reduce((a,b) => a+b,0);
  if (processed > f.planned || processed !== f.windows.length + f.omittedWindows) return;
  const windows: FusionWindow[] = [];
  const retained = { complete: 0, failed: 0, unsupported: 0, empty: 0 };
  let previousStart = -1;
  for (const w of f.windows) {
    if (!w || !Object.hasOwn(counts,w.status) || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.start <= previousStart || w.end > duration || w.end <= w.start || w.end - w.start > 10.000001) return;
    const decisions = sanitizeFusionDecisions(w.decisions, w.status === 'complete');
    if (!decisions) return;
    previousStart = w.start; retained[w.status]++;
    windows.push({ start: w.start, end: w.end, status: w.status, decisions, ...(typeof w.reason === 'string' ? { reason: w.reason.slice(0,160) } : {}) });
  }
  if (Object.keys(counts).some(k => retained[k as FusionStatus] > counts[k as FusionStatus])) return;
  return { version: 1, scope: 'window', validation: f.validation, ...(release ? { release } : {}), ...(f.imported === true ? { imported: true as const } : {}), identity, planned: f.planned, counts, omittedWindows: f.omittedWindows, windows };
}
