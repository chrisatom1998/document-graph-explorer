import { expect, it } from 'vitest';
import type { MusicAnalysis } from './musicTypes';
import { sanitizeSoundReviews, type SoundReview } from './recognition';
import { djReviewAllows, latestSoundReview, projectedCopilotProperties, resolvedNonSourceLabels, reviewedSoundProfile } from './soundReviewPolicy';

const review = (dimension: SoundReview['dimension'], labelId: string, decision: SoundReview['decision']): SoundReview => ({
  dimension, labelId, decision, scope: 'track', at: '2026-10-07T12:00:00Z', evidenceRunId: 'old',
});
const audio = (soundReviews: SoundReview[]): MusicAnalysis => ({ version: 2, durationSeconds: 180, analyzedSeconds: 60, instruments: [], notes: [], soundReviews,
  soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false,
    djTags: [{ group: 'production', label: 'cymbal', score: .9, model: 'Trained head' }] },
});

it.each(['rejected', 'uncertain', 'confirmed'] as const)('uses the latest %s review across cymbal dimensions and aliases', decision => {
  const latest = { ...review('effect', 'cymbal hit', decision), at: '2026-10-06T12:00:00Z', evidenceRunId: 'different' };
  const history = [review('source', 'cymbals', 'confirmed'), review('source', 'cymbal', 'rejected'), latest];
  for (const [dimension, label] of [['source', 'cymbals'], ['source', 'cymbal'], ['effect', 'cymbal'], ['effect', 'cymbal hit']] as const) {
    expect(latestSoundReview(history, dimension, label)).toBe(latest);
  }
});

it.each(['rejected', 'uncertain'] as const)('excludes a source %s cymbal from current profile and copilot projections', decision => {
  const a = audio([review('source', 'cymbals', decision)]);
  a.copilotProperties = { model: 'draft', tags: { source: [], production: ['cymbal'], character: [] } };
  const before = JSON.stringify(a);
  expect(djReviewAllows(a, 'production', 'cymbal')).toBe(false);
  expect(resolvedNonSourceLabels(a, true)).toEqual([]);
  expect(reviewedSoundProfile(a)?.djTags).toEqual([]);
  expect(projectedCopilotProperties(a)).toEqual({ current: [], historical: [{ group: 'production', label: 'cymbal', reason: `${decision} by you` }] });
  expect(JSON.stringify(a)).toBe(before);
});

it('does not treat related drum types as aliases or change unrelated review ordering', () => {
  const a = audio([review('source', 'cymbals', 'rejected'), review('character', 'distortion', 'rejected'), review('character', 'distorted', 'confirmed')]);
  for (const label of ['kick', 'drums', 'ride cymbal', 'crash cymbal', 'reverse cymbal']) expect(djReviewAllows(a, 'production', label)).toBe(true);
  expect(latestSoundReview(a.soundReviews, 'character', 'distortion')?.decision).toBe('confirmed');
});

it('accepts only declared cymbal review aliases beyond the existing recognition vocabulary', () => {
  const exact = review('effect', 'cymbal', 'rejected');
  const alias = review('effect', 'cymbal hit', 'confirmed');
  const validSource = review('source', 'piano', 'confirmed');
  expect(sanitizeSoundReviews([
    exact, alias, validSource,
    review('effect', 'ride cymbal', 'confirmed'), review('source', 'cymbal hit', 'confirmed'),
    review('vocal', 'cymbal', 'confirmed'), review('effect', 'invented cymbal', 'confirmed'),
  ])).toEqual([exact, { ...alias, labelId: 'cymbal' }, validSource]);
});

it('projects cached source labels into the surviving non-source group without changing raw evidence', () => {
  const a = audio([]);
  a.soundProfile!.djTags = [
    { group: 'source', label: 'turntable', score: .63, model: 'Trained head' },
    { group: 'production', label: 'vinyl scratch', score: .94, model: 'Music CLAP' },
    { group: 'source', label: 'noise', score: .72, model: 'Trained head' },
  ];
  const before = structuredClone(a);
  expect(resolvedNonSourceLabels(a)).toEqual([
    { group: 'production', label: 'vinyl scratch', source: 'estimated', score: .63 },
    { group: 'production', label: 'static noise', source: 'estimated', score: .72 },
  ]);
  expect(a).toEqual(before);
});

it('projects explicit merged source confirmations but preserves unrelated shared-alias dimensions', () => {
  const a = audio([review('source', 'turntable', 'confirmed'), review('source', 'cymbals', 'confirmed')]);
  expect(resolvedNonSourceLabels(a)).toEqual([{ group: 'production', label: 'vinyl scratch', source: 'confirmed' }]);
});
