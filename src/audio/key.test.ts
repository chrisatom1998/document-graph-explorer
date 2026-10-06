import { describe, expect, it } from 'vitest';
import { combineKeys, learnedKey } from './key';

/** 36-bin chroma (bin 0 = A, three bins per semitone) with energy on the given C-indexed pitch classes. */
function chroma(pitchClasses: number[], weights = pitchClasses.map(() => 1)): number[] {
  const bins = new Array<number>(36).fill(0.02);
  pitchClasses.forEach((pc, i) => { bins[(3 * (pc - 9) + 36) % 36] = weights[i]; });
  return bins;
}

describe('learnedKey', () => {
  it('reads natural minor and major scales with a stressed tonic triad', () => {
    // A natural minor: A B C D E F G, triad A C E stressed.
    expect(learnedKey(chroma([9, 11, 0, 2, 4, 5, 7], [1, .4, .8, .4, .8, .4, .4]))).toMatchObject({ tonic: 9, mode: 'minor' });
    // C major: C D E F G A B, triad C E G stressed.
    expect(learnedKey(chroma([0, 2, 4, 5, 7, 9, 11], [1, .4, .8, .4, .8, .4, .4]))).toMatchObject({ tonic: 0, mode: 'major' });
  });

  it('is transposition-invariant', () => {
    const minor = [0, 2, 3, 5, 7, 8, 10], weights = [1, .4, .8, .4, .8, .4, .4];
    for (let t = 0; t < 12; t++) expect(learnedKey(chroma(minor.map(pc => (pc + t) % 12), weights))).toMatchObject({ tonic: t, mode: 'minor' });
  });

  it('shows a key only with strength of at least 0.6 and none for flat or malformed chroma', () => {
    const key = learnedKey(chroma([9, 0, 4]));
    expect(key?.strength).toBeGreaterThanOrEqual(0.6);
    expect(key?.strength).toBeLessThanOrEqual(1);
    expect(learnedKey(new Array(36).fill(0.5))).toBeUndefined();
    expect(learnedKey(new Array(12).fill(1))).toBeUndefined();
  });
});

describe('combineKeys', () => {
  it('needs half of the excerpts to agree and reports the weakest agreeing strength', () => {
    const a = { tonic: 9, mode: 'minor' as const, strength: 0.9 }, b = { tonic: 0, mode: 'major' as const, strength: 0.8 };
    expect(combineKeys([a, b, { ...a, strength: 0.7 }], 3)).toEqual({ ...a, strength: 0.7 });
    expect(combineKeys([a, b], 3)).toBeUndefined();
  });
});
