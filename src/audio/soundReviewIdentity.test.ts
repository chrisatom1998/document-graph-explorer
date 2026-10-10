import { describe, expect, it } from 'vitest';
import type { SoundReview } from './recognition';
import { latestSoundReview, soundReviewKey } from './soundReviewIdentity';

describe('merged look-alike tags share one review identity', () => {
  it('maps old names onto the surviving tag', () => {
    expect(soundReviewKey('effect', 'synth stab')).toBe(soundReviewKey('effect', 'synth hit'));
    expect(soundReviewKey('source', 'noise')).toBe(soundReviewKey('effect', 'static noise'));
    expect(soundReviewKey('source', 'turntable')).toBe(soundReviewKey('effect', 'vinyl scratch'));
    expect(soundReviewKey('effect', 'vocal harmony')).toBe(soundReviewKey('effect', 'choir'));
    expect(soundReviewKey('effect', 'acid bass')).toBe(soundReviewKey('effect', 'acid synth'));
    expect(soundReviewKey('effect', 'vocal breath')).toBe(soundReviewKey('source', 'breath'));
    expect(soundReviewKey('effect', 'synth hit')).not.toBe(soundReviewKey('effect', 'static noise'));
  });
  it('lets a rejection of the old name cover the surviving tag', () => {
    const reviews: SoundReview[] = [{ dimension: 'source', labelId: 'noise', decision: 'rejected', scope: 'track', at: '2026-10-10T00:00:00Z', evidenceRunId: 'r' }];
    expect(latestSoundReview(reviews, 'effect', 'static noise')?.decision).toBe('rejected');
  });
});
