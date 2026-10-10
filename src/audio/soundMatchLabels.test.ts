import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import type { MusicAnalysis } from './musicTypes';
import type { SoundReview } from './recognition';
import { otherModelGuessGroups, soundMatchLabels } from './soundMatchLabels';

const review = (dimension: SoundReview['dimension'], labelId: string, decision: SoundReview['decision']): SoundReview => ({
  dimension, labelId, decision, scope: 'track', at: '2026-10-07T12:00:00Z', evidenceRunId: 'old-run',
});
const clip = (features: Partial<MusicAnalysis> = {}): Pick<DocNode, 'title' | 'audio'> => ({
  title: 'recording.wav',
  audio: { version: 2, durationSeconds: 180, analyzedSeconds: 60, instruments: [], notes: [],
    soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false,
      djTags: [{ group: 'production', label: 'cymbal', score: .9, model: 'Trained head' }] },
    ...features },
});

describe('cymbal reviews in sound match labels', () => {
  it.each(['rejected', 'uncertain'] as const)('does not restore a source %s cymbal as a production guess', decision => {
    const node = clip({ soundReviews: [review('source', 'cymbals', decision)] });
    const before = JSON.stringify(node);
    expect(soundMatchLabels(node)).toEqual([]);
    expect(JSON.stringify(node)).toBe(before);
  });

  it.each([
    ['source', 'cymbals'], ['source', 'cymbal'], ['effect', 'cymbal'], ['effect', 'cymbal hit'],
  ] as const)('applies the latest %s:%s rejection to both source and production aliases', (dimension, label) => {
    const node = clip({ soundReviews: [review('source', 'cymbals', 'confirmed'), review(dimension, label, 'rejected')] });
    node.audio!.soundProfile!.djTags!.push({ group: 'source', label: 'cymbal', score: .9, model: 'Trained head' });
    expect(soundMatchLabels(node)).toEqual([]);
  });

  it('restores one confirmed source label after a newer confirmation under the other source alias', () => {
    const node = clip({ soundReviews: [
      review('source', 'cymbals', 'confirmed'), review('effect', 'cymbal', 'rejected'),
      { ...review('source', 'cymbal', 'confirmed'), at: '2026-10-06T12:00:00Z', evidenceRunId: 'different-run' },
    ] });
    expect(soundMatchLabels(node)).toEqual([{ group: 'source', label: 'cymbal', origin: 'confirmed', weight: .85 }]);
  });

  it('restores the latest effect confirmation without retaining an older source confirmation or source guess', () => {
    const node = clip({ soundReviews: [
      review('source', 'cymbals', 'confirmed'), review('source', 'cymbal', 'uncertain'),
      review('effect', 'cymbal hit', 'confirmed'),
    ] });
    node.audio!.soundProfile!.djTags!.push({ group: 'source', label: 'cymbals', score: .9, model: 'Trained head' });
    expect(soundMatchLabels(node)).toEqual([{ group: 'production', label: 'cymbal', origin: 'confirmed', weight: .85 }]);
  });

  it('keeps unrelated drum and sound labels at their existing weights', () => {
    const node = clip({ soundReviews: [review('source', 'cymbals', 'rejected')] });
    node.audio!.soundProfile!.djTags!.push(
      { group: 'production', label: 'kick', score: .9, model: 'Trained head' },
      { group: 'character', label: 'bright', score: .9, model: 'Trained head (maybe)' },
      { group: 'production', label: 'ride cymbal', score: .3 },
    );
    expect(soundMatchLabels(node)).toEqual([
      { group: 'production', label: 'kick', origin: 'sounds', weight: .7 },
      { group: 'character', label: 'bright', origin: 'maybe', weight: .55 },
      { group: 'production', label: 'ride cymbal', origin: 'guess', weight: .4 },
    ]);
  });
});

describe('merged look-alike tags', () => {
  it('lists an old-name model guess once, under the surviving name', () => {
    const labels = soundMatchLabels(clip({ soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false,
      djTags: [{ group: 'production', label: 'synth stab', score: .9, model: 'Trained head' }, { group: 'source', label: 'noise', score: .9, model: 'Trained head' }] } }));
    const names = labels.map(l => `${l.group}:${l.label}`);
    expect(names).not.toContain('production:synth stab');
    expect(names).not.toContain('source:noise');
    expect(names).toEqual(expect.arrayContaining(['production:synth hit', 'production:static noise']));
  });
});

describe('labels hidden until tested on real clips', () => {
  it('leaves them out of other model guesses', () => {
    const profile = { djTags: [{ group: 'production' as const, label: 'reverse effect', score: .3 }, { group: 'character' as const, label: 'distorted', score: .3 }, { group: 'production' as const, label: 'riser', score: .3 }] };
    expect(otherModelGuessGroups({ profile, exclude: [] })).toEqual([{ group: 'production', values: ['riser'] }]);
  });
});
