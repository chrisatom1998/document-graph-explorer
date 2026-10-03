import { FUSION_LABELS, type FusionScorer, type FusionIdentity } from '../fusion';
import type { MusicDecoder } from '../decodeMusic';
import { extractTemporalFeatures, TEMPORAL_FEATURE_NAMES } from './temporalFeatures';

/** No production call site, URL setting, model installation, or default inference. */
export const EXPERIMENTAL_TEMPORAL_CANDIDATE_ENABLED = false;
type Tree = { children_left: number[]; children_right: number[]; feature: number[]; threshold: number[]; value: number[][] };
type Head = { configuration: { family: string; head: 'logistic' | 'trees' }; threshold: number; parameters: { weights?: number[]; bias?: number; trees?: Tree[] }; positiveGroups: number; negativeGroups: number };
type Artifact = { featureNames: Record<string, string[]>; canonicalAstOrder: string[]; jamendoOrder: string[]; clapDescriptionOrder: Array<Array<string | null>>; models: Record<string, Head> };
const identity = (d: { group: string; label: string | null; alternative?: string; learnedGroup?: string; decision?: string }) => [d.group, d.label, d.alternative ?? null, d.learnedGroup ?? null, d.decision ?? null];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const check: (v: unknown, message: string) => asserts v = (v, message) => { if (!v) throw new Error(message); };
export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)); return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('');
}
function nativeVector(raw: Parameters<FusionScorer['score']>[0]['raw'], artifact: Artifact, family: string) {
  check(same(Object.keys(raw.ast.instruments).sort(), artifact.canonicalAstOrder) && same(Object.keys(raw.jamendo).sort(), artifact.jamendoOrder), 'Native score schema mismatch');
  check(same(raw.clap.descriptions.map(identity), artifact.clapDescriptionOrder), 'Descriptor order mismatch');
  const logit = (p: number) => { check(Number.isFinite(p) && p >= 0 && p <= 1, 'Invalid native probability'); p = Math.max(1e-6, Math.min(1 - 1e-6, p)); return Math.log(p / (1 - p)); };
  const x = [...artifact.canonicalAstOrder.map(k => logit(raw.ast.instruments[k])), ...raw.clap.descriptions.map(d => { check(Number.isFinite(d.score) && d.score >= -1 && d.score <= 1, 'Invalid CLAP score'); return d.score; })];
  if (family === 'full_native_with_jamendo_plus_dsp') x.push(...artifact.jamendoOrder.map(k => logit(raw.jamendo[k])));
  else check(family === 'full_native_no_jamendo_plus_dsp', 'Unknown temporal feature family');
  return x;
}
export function predictTemporalHead(head: Head, x: number[]) {
  const p = head.parameters;
  if (head.configuration.head === 'logistic') {
    const z = x.reduce((sum, v, i) => sum + v * p.weights![i], p.bias!);
    return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
  }
  let sum = 0;
  for (const t of p.trees!) {
    let i = 0; while (t.children_left[i] !== -1) i = Math.fround(x[t.feature[i]]) <= t.threshold[i] ? t.children_left[i] : t.children_right[i];
    sum += t.value[i][1] / (t.value[i][0] + t.value[i][1]);
  }
  return sum / p.trees!.length;
}
export interface ExperimentalTemporalOptions {
  /** Required explicit research opt-in; omitted/false returns before work. */
  enabled?: boolean;
  decoder: MusicDecoder;
  modelBytes: Uint8Array;
  expectedModelSha256: string;
  /** Independently frozen experimental protocol/source, never an acceptance receipt. */
  protocolSha256: string;
  scorerSha256: string;
  onFeatures?: (value: { interval: { start: number; end: number }; features: number[]; pcmSha256: string; milliseconds: number }) => void;
}
/** Candidate stays unregistered: releaseForScorer returns undefined and GUI remains diagnostic. */
export async function createExperimentalTemporalScorer(options: ExperimentalTemporalOptions): Promise<FusionScorer | undefined> {
  if (!(options.enabled ?? EXPERIMENTAL_TEMPORAL_CANDIDATE_ENABLED)) return undefined;
  const bytes = new Uint8Array(options.modelBytes);
  check([options.expectedModelSha256, options.protocolSha256, options.scorerSha256].every(digest), 'Pinned experiment hashes required');
  check(await sha256(bytes) === options.expectedModelSha256, 'Temporal model bytes changed');
  const artifact = JSON.parse(new TextDecoder().decode(bytes)) as Artifact;
  check(same(Object.keys(artifact.models).sort(), FUSION_LABELS) && artifact.canonicalAstOrder.length === 67 && artifact.jamendoOrder.length === 40 && artifact.clapDescriptionOrder.length === 512, 'Incomplete temporal candidate');
  for (const label of FUSION_LABELS) {
    const head = artifact.models[label], names = artifact.featureNames[head.configuration.family];
    check(names && same(names.slice(-133), TEMPORAL_FEATURE_NAMES.map(n => 'dsp:' + n)), 'Temporal feature order mismatch');
    check(Number.isFinite(head.threshold) && head.threshold >= 0 && head.threshold <= 1.000001 && Number.isInteger(head.positiveGroups) && head.positiveGroups >= 0 && Number.isInteger(head.negativeGroups) && head.negativeGroups >= 0, 'Invalid class calibration/support');
    if (head.configuration.head === 'logistic') check(head.parameters.weights?.length === names.length && head.parameters.weights.every(Number.isFinite) && Number.isFinite(head.parameters.bias), 'Invalid linear head');
    else {
      check(head.configuration.head === 'trees' && head.parameters.trees?.length, 'Invalid tree head');
      for (const tree of head.parameters.trees) {
        const n = tree.feature.length;
        check(n > 0 && [tree.children_left, tree.children_right, tree.threshold, tree.value].every(v => v.length === n), 'Invalid tree dimensions');
        for (let i = 0; i < n; i++) {
          check(Number.isFinite(tree.threshold[i]) && tree.value[i].length === 2 && tree.value[i].every(v => Number.isFinite(v) && v >= 0) && tree.value[i][0] + tree.value[i][1] > 0, 'Invalid tree values');
          const left = tree.children_left[i], right = tree.children_right[i];
          check(left === -1 && right === -1 || Number.isInteger(left) && left > i && left < n && Number.isInteger(right) && right > i && right < n && Number.isInteger(tree.feature[i]) && tree.feature[i] >= 0 && tree.feature[i] < names.length, 'Invalid/cyclic tree structure');
        }
      }
    }
  }
  const scorerIdentity: FusionIdentity = { modelSha256: options.expectedModelSha256, policySha256: options.protocolSha256, scorerSha256: options.scorerSha256 };
  return { identity: scorerIdentity, async score(input, signal) {
    signal?.throwIfAborted();
    check(input.interval.start >= 0 && input.interval.end > input.interval.start && input.interval.end - input.interval.start <= 10, 'Invalid temporal interval');
    const samples = await options.decoder.read(input.interval.start, input.interval.end - input.interval.start, 16000);
    signal?.throwIfAborted();
    check(samples.length === Math.round((input.interval.end - input.interval.start) * 16000), 'Incomplete temporal PCM');
    const started = performance.now(), features = extractTemporalFeatures(samples);
    const pcmSha256 = await sha256(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
    options.onFeatures?.({ interval: { ...input.interval }, features: features.slice(), pcmSha256, milliseconds: performance.now() - started });
    return FUSION_LABELS.map(label => {
      const head = artifact.models[label], x = [...nativeVector(input.raw, artifact, head.configuration.family), ...features];
      check(x.length === artifact.featureNames[head.configuration.family].length, 'Temporal vector dimension mismatch');
      const probability = predictTemporalHead(head, x);
      check(Number.isFinite(probability) && probability >= 0 && probability <= 1, 'Invalid temporal probability');
      return { label, state: probability >= head.threshold ? 'positive' : 'negative', headProbability: probability, decisionProbability: probability, source: 'learned-head', eligible: true, positiveGroups: head.positiveGroups, negativeGroups: head.negativeGroups };
    });
  } };
}
