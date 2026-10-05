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
}
export interface LearnedDjHead {
  group: ReviewedGroup;
  label: string;
  weights: number[];
  bias: number;
  threshold: number;
  /** Measured on unseen brands between the 50% and 65% bars: shown as a maybe. */
  maybe?: boolean;
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
    !Number.isFinite(h.bias) || !Number.isFinite(h.threshold) || h.threshold < .5 || h.threshold > 1 || (h.maybe !== undefined && typeof h.maybe !== 'boolean')))) return;
  return {version:1,encoder:model.encoder,revision:model.revision,examples,...(model.heads ? {heads:model.heads} : {})};
}
/** Conservative exemplar classifier over frozen CLAP features; not base-model fine-tuning.
 * Positive and negative evidence compete independently for each reviewed label.
 */
export function learnedDjScores(embedding: ArrayLike<number>, model: LearnedDjModel): DescriptionScore[] {
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
  for (const head of model.heads ?? []) {
    if (results.some(r => r.learnedGroup === head.group && r.label === head.label)) continue;
    const logit = head.bias + head.weights.reduce((sum,w,i) => sum + w * vector[i] / norm, 0);
    const score = 1 / (1 + Math.exp(-Math.max(-35,Math.min(35,logit))));
    if (score >= head.threshold) results.push({group:'dj-learned',label:head.label,score,learnedGroup:head.group,decision:'include',basis:'head',...(head.maybe ? {maybe:true} : {})});
  }
  return results;
}
