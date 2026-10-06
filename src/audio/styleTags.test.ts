import { describe, expect, it } from 'vitest';
import type { MusicAnalysis } from './musicTypes';
import { styleTags } from './styleTags';

const base = (): MusicAnalysis => ({ version: 2, durationSeconds: 8, analyzedSeconds: 8, instruments: [], notes: [],
  soundProfile: { version: 1, character: ['warm'], roles: [], models: [], disagreement: false, djTags: [{ group: 'character', label: 'bright', score: 0.8 }] } });

describe('styleTags', () => {
  it('lists model character labels when nothing was reviewed', () => {
    expect(styleTags(base()).sort()).toEqual(['bright', 'warm']);
  });
  it('drops labels the user rejected', () => {
    const audio = base();
    audio.soundReviews = [{ dimension: 'character', labelId: 'bright', decision: 'rejected', scope: 'track', at: 'now', evidenceRunId: 'qa' }];
    expect(styleTags(audio)).toEqual(['warm']);
  });
  it('uses saved tags instead of model estimates', () => {
    const audio = base();
    audio.confirmedDjTags = { source: [], production: [], character: ['dark'] };
    expect(styleTags(audio)).toEqual(['dark']);
  });
});
