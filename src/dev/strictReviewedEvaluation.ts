import { learnedDjScores, sanitizeLearnedDjModel, type LearnedDjExample, type LearnedDjHead } from '../audio/learnedDjModel';
import { selectDjTags } from '../audio/djTags';
import type { DescriptionScore } from '../audio/profileDescriptions';

export interface ReviewedPartition {
  id: string;
  split: 'train' | 'calibration' | 'test';
  sha256: string;
  groups: { recording: string; artist: string; pack: string; family: string };
}
export interface BoundReviewedHead { head: LearnedDjHead; trainingIds: string[] }
/** Evaluation-only snapshot. Production confirmations are never removed or mutated.
 * Call before fitting/tuning; unknown provenance fails closed, not into a random split.
 */
export function strictReviewedModel(examples: LearnedDjExample[], partitions: ReviewedPartition[], heads: BoundReviewedHead[] = []) {
  const roles = new Map<string, ReviewedPartition>();
  const owners = new Map<string, string>();
  for (const p of partitions) {
    if (!p.id || roles.has(p.id) || !['train', 'calibration', 'test'].includes(p.split) || !/^[a-f0-9]{64}$/.test(p.sha256)) throw new Error('Invalid or duplicate partition');
    roles.set(p.id, p);
    const groups = { ...p.groups, sha256: p.sha256 };
    for (const dimension of ['recording', 'artist', 'pack', 'family', 'sha256'] as const) {
      const value = groups[dimension];
      if (typeof value !== 'string' || !value.trim()) throw new Error('Verified provenance groups required');
      const key = JSON.stringify([dimension, value]);
      if (owners.has(key) && owners.get(key) !== p.split) throw new Error(`Split leakage: ${dimension}`);
      owners.set(key, p.split);
    }
  }
  const seen = new Set<string>();
  for (const e of examples) {
    if (seen.has(e.id) || !roles.has(e.id)) throw new Error('Every example needs a unique partition');
    seen.add(e.id);
    if (e.provenance !== 'explicit human confirmation') throw new Error('Human-confirmed examples required');
  }
  if (partitions.some(p => !seen.has(p.id))) throw new Error('Partition has no corresponding example');
  for (const { trainingIds } of heads) {
    if (!trainingIds.length || new Set(trainingIds).size !== trainingIds.length || trainingIds.some(id => roles.get(id)?.split !== 'train' || !seen.has(id))) throw new Error('Head fitting must use train examples only');
  }
  const model = sanitizeLearnedDjModel({ version: 1, encoder: 'evaluation-snapshot', revision: 'strict-partition-v1', examples: examples.filter(e => roles.get(e.id)?.split === 'train'), heads: heads.map(h => h.head) });
  if (!model) throw new Error('Invalid model snapshot');
  return structuredClone(model);
}
/** Exact deployed DJ tag selection, including the post-head .88 inclusion filter.
 * This is the reviewed/CLAP branch, not a substitute for complete GUI evaluation.
 */
export function evaluateReviewedTagBranch(embedding: ArrayLike<number>, model: ReturnType<typeof strictReviewedModel>, nativeScores: DescriptionScore[] = []) {
  if (nativeScores.some(s => s.group === 'dj-learned')) throw new Error('Supply native scores without unpartitioned reviewed predictions');
  return selectDjTags([...nativeScores, ...learnedDjScores(embedding, model)]);
}
