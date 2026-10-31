import type { DescriptionScore } from './profileDescriptions';

export type ReviewedGroup = 'source' | 'production' | 'character';
export interface LearnedDjExample {
  id: string;
  vector: number[];
  labels: Record<ReviewedGroup, string[]>;
  /** Only these categories were available when this example was reviewed. */
  knownLabels: string[];
  /** Learned models contain direct human confirmations only. */
  provenance: 'explicit human confirmation';
}
export interface LearnedDjModel {
  version: 1;
  encoder: string;
  revision: string;
  examples: LearnedDjExample[];
  heads?: LearnedDjHead[];
  neighbours?: LearnedDjNeighbours;
}
/** Few-shot example matching for tags with few training clips (scripts/knn-heads/): a clip is tagged when it sits
 *  closer to a tag's labelled training examples than to unrelated sounds. Vectors are int8 CLAP fingerprints in
 *  base64, 512 bytes each; scale is irrelevant because every vector is compared by cosine. */
export interface LearnedDjNeighbours {
  /** How many nearest examples (and nearest background sounds) are averaged. */
  k: number;
  /** Shared background bank of training sounds with mixed tags. */
  background: string;
  heads: LearnedDjNeighbourHead[];
}
export interface LearnedDjNeighbourHead {
  group: ReviewedGroup;
  label: string;
  examples: string;
  /** Background sounds that carry this tag, left out of its comparison. */
  skipBackground: number[];
  /** Tagged when mean top-k similarity to the examples minus that to the background reaches this. */
  cutoff: number;
}
const VECTOR = 512;
interface DecodedNeighbours { k: number; background: Float32Array[]; heads: { head: LearnedDjNeighbourHead; examples: Float32Array[]; skip: Set<number> }[] }
function decodeBank(base64: string): Float32Array[] | undefined {
  let bytes: string;
  try { bytes = atob(base64); } catch { return; }
  if (!bytes.length || bytes.length % VECTOR) return;
  const out: Float32Array[] = [];
  for (let a = 0; a < bytes.length; a += VECTOR) {
    const v = new Float32Array(VECTOR); let n = 0;
    for (let i = 0; i < VECTOR; i++) { const b = bytes.charCodeAt(a + i); v[i] = b > 127 ? b - 256 : b; n += v[i] * v[i]; }
    n = Math.sqrt(n); if (!n) return;
    for (let i = 0; i < VECTOR; i++) v[i] /= n;
    out.push(v);
  }
  return out;
}
const decodedNeighbours = new WeakMap<LearnedDjNeighbours, DecodedNeighbours>();
function sanitizeNeighbours(raw: unknown): LearnedDjNeighbours | undefined | null {
  if (raw === undefined) return undefined;
  const n = raw as Partial<LearnedDjNeighbours>;
  if (!n || typeof n !== 'object' || !Number.isInteger(n.k) || n.k! < 1 || n.k! > 50 || typeof n.background !== 'string' || !Array.isArray(n.heads) || n.heads.length > 500) return null;
  const background = decodeBank(n.background);
  if (!background || background.length > 20000) return null;
  const heads: DecodedNeighbours['heads'] = [];
  for (const h of n.heads) {
    if (!h || !groups.includes(h.group) || typeof h.label !== 'string' || !h.label || h.label.length > 80 || typeof h.examples !== 'string' ||
      !Number.isFinite(h.cutoff) || !Array.isArray(h.skipBackground) || !h.skipBackground.every(i => Number.isInteger(i) && i >= 0 && i < background.length)) return null;
    const examples = decodeBank(h.examples);
    if (!examples || examples.length > 1000) return null;
    heads.push({ head: { group: h.group, label: h.label, examples: h.examples, skipBackground: h.skipBackground, cutoff: h.cutoff }, examples, skip: new Set(h.skipBackground) });
  }
  const model: LearnedDjNeighbours = { k: n.k!, background: n.background, heads: heads.map(h => h.head) };
  decodedNeighbours.set(model, { k: model.k, background, heads });
  return model;
}
const meanTop = (sims: number[], k: number): number => {
  sims.sort((a, b) => b - a); const n = Math.min(k, sims.length); let s = 0;
  for (let i = 0; i < n; i++) s += sims[i];
  return n ? s / n : -1;
};
/** Neighbour-head scores for one unit CLAP vector: positive when a tag's examples are nearer than the background. */
export function neighbourMargins(unit: ArrayLike<number>, neighbours: LearnedDjNeighbours): { head: LearnedDjNeighbourHead; margin: number }[] {
  const decoded = decodedNeighbours.get(neighbours);
  if (!decoded) return [];
  const dot = (v: Float32Array) => { let s = 0; for (let i = 0; i < VECTOR; i++) s += v[i] * unit[i]; return s; };
  const bg = decoded.background.map(dot);
  return decoded.heads.map(({ head, examples, skip }) => ({
    head, margin: meanTop(examples.map(dot), decoded.k) - meanTop(bg.filter((_, i) => !skip.has(i)), decoded.k),
  }));
}
export interface LearnedDjHead {
  group: ReviewedGroup;
  label: string;
  weights: number[];
  bias: number;
  threshold: number;
  /** Below the full-tag bar (held-out precision AND recall >= 0.50 since 2026-10-10) on held-out sources: shown as a maybe. */
  maybe?: boolean;
  /** Also tested on held-out whole clips of at most the one-shot length (scripts/dj-effects/oneshot.py), so it still
   *  scores those clips; other heads stay off them and only the one-shot heads (short-clip.json) apply. */
  oneShot?: boolean;
}
const groups: ReviewedGroup[] = ['source', 'production', 'character'];
interface ReviewedIndex { group: ReviewedGroup; label: string; decisions: Int8Array }
// Published models are immutable snapshots. A newly loaded model gets its own
// index, and WeakMap lets the old index go when the worker releases the model.
const indexes = new WeakMap<LearnedDjModel, ReviewedIndex[]>();
function reviewedIndex(model: LearnedDjModel): ReviewedIndex[] {
  const existing = indexes.get(model);
  if (existing) return existing;
  const byKey = new Map<string, ReviewedIndex>();
  model.examples.forEach((example, index) => {
    for (const key of example.knownLabels) {
      const separator = key.indexOf(':');
      const group = key.slice(0, separator) as ReviewedGroup;
      const label = key.slice(separator + 1);
      if (!groups.includes(group) || !label) continue;
      let entry = byKey.get(key);
      if (!entry) {
        entry = { group, label, decisions: new Int8Array(model.examples.length) };
        byKey.set(key, entry);
      }
      entry.decisions[index] = example.labels[group].includes(label) ? 1 : -1;
    }
  });
  const result = [...byKey.values()];
  indexes.set(model, result);
  return result;
}
export function sanitizeLearnedDjModel(raw: unknown): LearnedDjModel | undefined {
  if (!raw || typeof raw !== 'object') return;
  const model = raw as Partial<LearnedDjModel>;
  if (model.version !== 1 || typeof model.encoder !== 'string' || typeof model.revision !== 'string' || !Array.isArray(model.examples) || model.examples.length > 2000) return;
  const examples: LearnedDjExample[] = [];
  for (const example of model.examples) {
    if (!example || typeof example.id !== 'string' || example.provenance !== 'explicit human confirmation' || !Array.isArray(example.vector) || example.vector.length !== 512 || !example.vector.every(Number.isFinite)) return;
    const norm = Math.hypot(...example.vector);
    if (norm < 1e-8 || !example.labels || !groups.every(g => Array.isArray(example.labels[g]) && example.labels[g].every(v => typeof v === 'string' && v.length <= 80))) return;
    if (!Array.isArray(example.knownLabels) || example.knownLabels.length > 2000 || !example.knownLabels.every(v => typeof v === 'string' && v.length <= 100)) return;
    examples.push({...example, vector:example.vector.map(v => v / norm)});
  }
  if (model.heads !== undefined && (!Array.isArray(model.heads) || model.heads.length > 2000 || model.heads.some(h =>
    !h || !groups.includes(h.group) || typeof h.label !== 'string' || !h.label || h.label.length > 80 ||
    !Array.isArray(h.weights) || h.weights.length !== 512 || !h.weights.every(Number.isFinite) ||
    !Number.isFinite(h.bias) || !Number.isFinite(h.threshold) || h.threshold < .5 || h.threshold > 1 || (h.maybe !== undefined && typeof h.maybe !== 'boolean') || (h.oneShot !== undefined && typeof h.oneShot !== 'boolean')))) return;
  const neighbours = sanitizeNeighbours(model.neighbours);
  if (neighbours === null) return;
  return {version:1,encoder:model.encoder,revision:model.revision,examples,...(model.heads ? {heads:model.heads} : {}),...(neighbours ? {neighbours} : {})};
}
/** On a recording shorter than the 10 s CLAP window, these heads stay quiet unless they outscore the sibling
 *  they are regularly confused with. A 10 s mix window can contain both, so it is not gated. Measured on the
 *  NSynth test notes (instruments held out of training): electric guitar kept every true positive that already
 *  cleared its cutoff and dropped the acoustic-guitar notes it had been claiming. */
export const SHORT_RECORDING_HEAD_GATES: { group: ReviewedGroup; label: string; sibling: string }[] = [
  { group: 'source', label: 'electric guitar', sibling: 'acoustic guitar' },
];

/** Conservative exemplar classifier over frozen CLAP features; not base-model fine-tuning.
 * Positive and negative evidence compete independently for each reviewed label.
 * `shortRecording` applies SHORT_RECORDING_HEAD_GATES. Omit it for a 10 s window. */
export function learnedDjScores(embedding: ArrayLike<number>, model: LearnedDjModel, options?: { shortRecording?: boolean }): DescriptionScore[] {
  if (embedding.length !== 512) return [];
  const vector = Array.from(embedding); const norm = Math.hypot(...vector);
  if (!norm || !Number.isFinite(norm)) return [];
  const neighbors = model.examples.map((example, index) => {
    let similarity = 0;
    for (let i = 0; i < vector.length; i++) similarity += example.vector[i] * vector[i] / norm;
    return { index, similarity };
  }).sort((a, b) => b.similarity - a.similarity);
  const results: DescriptionScore[] = [];
  for (const { group, label, decisions } of reviewedIndex(model)) {
    let positive = -1; let negative = -1;
    let foundPositive = false; let foundNegative = false;
    // The first reviewed positive/negative in sorted order is exactly its
    // maximum. Unknown categories remain unknown, never negative examples.
    for (const {index,similarity} of neighbors) {
      if (!foundPositive && decisions[index] === 1) { positive = Math.max(-1, similarity); foundPositive = true; }
      if (!foundNegative && decisions[index] === -1) { negative = Math.max(-1, similarity); foundNegative = true; }
      if (foundPositive && foundNegative) break;
    }
    // Uncalibrated similarity gates deliberately favor near matches. Conflict abstains.
    if (positive >= .88 && positive-negative >= .04) results.push({group:'dj-learned',label,score:Math.min(1,positive),learnedGroup:group,decision:'include'});
    else if (negative >= .94 && negative-positive >= .04) results.push({group:'dj-learned',label,score:Math.min(1,negative),learnedGroup:group,decision:'exclude'});
  }
  // Validated supervised heads generalize beyond nearest-example matches.
  // Direct reviewed evidence wins; heads only add a positive classification.
  const pending: { head: LearnedDjHead; score: number }[] = [];
  for (const head of model.heads ?? []) {
    if (results.some(r => r.learnedGroup === head.group && r.label === head.label)) continue;
    const logit = head.bias + head.weights.reduce((sum,w,i) => sum + w * vector[i] / norm, 0);
    const score = 1 / (1 + Math.exp(-Math.max(-35,Math.min(35,logit))));
    pending.push({ head, score });
  }
  const raw = new Map(pending.map(p => [`${p.head.group}:${p.head.label}`, p.score]));
  const gates = options?.shortRecording ? SHORT_RECORDING_HEAD_GATES : [];
  for (const { head, score } of pending) {
    if (score < head.threshold) continue;
    const gate = gates.find(g => g.group === head.group && g.label === head.label);
    const sibling = gate ? raw.get(`${gate.group}:${gate.sibling}`) : undefined;
    // Missing sibling means that head is not in this model: nothing to compare, so the cutoff stands.
    if (sibling !== undefined && !(score > sibling)) continue;
    results.push({group:'dj-learned',label:head.label,score,learnedGroup:head.group,decision:'include',basis:'head',...(head.maybe ? {maybe:true} : {})});
  }
  // Neighbour heads were checked like trained heads (held-out precision >= 0.60, recall >= 0.30) and add their tag
  // the same way. The score is a 0-1 squash of the margin over the cutoff (0.5 at the cutoff), not a probability.
  if (model.neighbours) {
    const unit = vector.map(v => v / norm);
    for (const {head, margin} of neighbourMargins(unit, model.neighbours)) {
      if (margin < head.cutoff || results.some(r => r.learnedGroup === head.group && r.label === head.label)) continue;
      results.push({group:'dj-learned',label:head.label,score:1 / (1 + Math.exp(-40 * (margin - head.cutoff))),learnedGroup:head.group,decision:'include',basis:'head'});
    }
  }
  return results;
}
