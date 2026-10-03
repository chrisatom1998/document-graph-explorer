import { expect, it } from 'vitest';
import { humanTrainingReviews } from './djReviewProvenance';

const review = { confirmed: true, provenance: 'explicit human confirmation' as const, labels: { source: ['piano'], production: [], character: [] }, knownLabels: ['source:piano'] };

it('admits only explicit human confirmations to the model publisher', () => {
  expect(humanTrainingReviews({ clip: review })).toHaveLength(1);
  expect(() => humanTrainingReviews({ clip: { ...review, provenance: 'assistant review' } })).toThrow('explicit human');
  expect(() => humanTrainingReviews({ clip: { ...review, provenance: undefined } })).toThrow('explicit human');
  expect(() => humanTrainingReviews({ clip: { ...review, confirmed: false } })).toThrow('explicit human');
});
