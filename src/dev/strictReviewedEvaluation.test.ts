import { expect, it } from 'vitest';
import { strictReviewedModel, evaluateReviewedTagBranch, type ReviewedPartition } from './strictReviewedEvaluation';
import type { LearnedDjExample, LearnedDjHead } from '../audio/learnedDjModel';
const vector = (i: number) => Array.from({ length: 512 }, (_, j) => Number(i === j));
const examples = (): LearnedDjExample[] => ['a', 'b', 'c'].map((id, i) => ({ id, vector: vector(i), labels: { source: ['piano'], production: [], character: [] }, knownLabels: ['source:piano'], provenance: 'explicit human confirmation' }));
const partitions = (): ReviewedPartition[] => ['train', 'calibration', 'test'].map((split, i) => ({ id: 'abc'[i], split: split as ReviewedPartition['split'], sha256: String(i).repeat(64), groups: { recording: String(i), artist: String(i), pack: String(i), family: String(i) } }));
it('excludes calibration and test from nearest matching without mutating confirmations', () => {
  const data = examples(); const before = JSON.stringify(data);
  const model = strictReviewedModel(data, partitions());
  expect(model.examples.map(e => e.id)).toEqual(['a']);
  expect(evaluateReviewedTagBranch(vector(2), model)).toEqual([]);
  expect(JSON.stringify(data)).toBe(before);
  model.examples[0].labels.source.push('voice');
  expect(JSON.stringify(data)).toBe(before);
});
it('rejects cross-split recording families, identical bytes, and draft truth', () => {
  for (const field of ['recording', 'artist', 'pack', 'family'] as const) {
    const p = partitions(); p[2].groups[field] = p[0].groups[field];
    expect(() => strictReviewedModel(examples(), p)).toThrow('Split leakage');
  }
  const p = partitions(); p[2].sha256 = p[0].sha256;
  expect(() => strictReviewedModel(examples(), p)).toThrow('Split leakage');
  const data = examples(); delete (data[0] as Partial<LearnedDjExample>).provenance;
  expect(() => strictReviewedModel(data, partitions())).toThrow('Human-confirmed');
});
it('scores after the deployed output filter and rejects held-out head fitting', () => {
  const head: LearnedDjHead = { group: 'source', label: 'piano', weights: Array(512).fill(0), bias: Math.log(4), threshold: .7 };
  const model = strictReviewedModel(examples(), partitions(), [{ head, trainingIds: ['a'] }]);
  // A head is shown at its own measured threshold (.80 >= .70), under its own name -
  // not held to the .88 similarity gate that applies to reviewed-example matches.
  expect(evaluateReviewedTagBranch(vector(2), model)).toEqual([expect.objectContaining({ label: 'piano', model: 'Trained head', score: expect.closeTo(.8, 5) })]);
  model.heads![0].threshold = .9;
  expect(evaluateReviewedTagBranch(vector(2), model)).toEqual([]); // below the head's threshold: silent
  model.heads![0].bias = Math.log(19);
  expect(evaluateReviewedTagBranch(vector(2), model)).toEqual([expect.objectContaining({ label: 'piano' })]);
  expect(() => strictReviewedModel(examples(), partitions(), [{ head, trainingIds: ['c'] }])).toThrow('train examples only');
});
