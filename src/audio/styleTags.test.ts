import { describe, expect, it } from 'vitest';
import type { MusicAnalysis } from './musicTypes';
import { matchesStyleFilter, styleTags } from './styleTags';
import { genreFromScores } from './genreEnergy';

const base = (): MusicAnalysis => ({ version: 2, durationSeconds: 8, analyzedSeconds: 8, instruments: [], notes: [],
  soundProfile: { version: 1, character: ['dark'], roles: [], models: [], disagreement: false, djTags: [{ group: 'character', label: 'bright', score: 0.8 }] } });

describe('styleTags', () => {
  it('lists nothing when no genre was estimated', () => {
    expect(styleTags(base())).toEqual([]);
    expect(styleTags(undefined)).toEqual([]);
  });
  it('files a clip under the genre the track panel shows, not its character tags', () => {
    const audio = base();
    audio.genreScores = { version: 'test', scores: { techno: 0.99 } };
    const genre = genreFromScores(audio.genreScores.scores);
    expect(genre).toBeDefined();
    expect(styleTags(audio)).toEqual([genre!.label]);
    expect(styleTags(audio)).not.toContain('bright');
  });
});

describe('matchesStyleFilter', () => {
  it('matches the estimated genre and a character label saved by an older view', () => {
    const audio = base();
    audio.genreScores = { version: 'test', scores: { techno: 0.99 } };
    expect(matchesStyleFilter(audio, genreFromScores(audio.genreScores.scores)!.label)).toBe(true);
    expect(matchesStyleFilter(audio, 'dark')).toBe(true);
    expect(matchesStyleFilter(audio, 'crunchy')).toBe(false);
    expect(matchesStyleFilter(undefined, 'dark')).toBe(false);
  });
  it('does not revive character labels that were rejected or replaced by confirmations', () => {
    const audio = base();
    audio.soundReviews = [{ dimension: 'character', labelId: 'dark', decision: 'rejected', scope: 'track', at: 'now', evidenceRunId: 'test' }];
    expect(matchesStyleFilter(audio, 'dark')).toBe(false);
    audio.confirmedDjTags = { source: [], production: [], character: [] };
    expect(matchesStyleFilter(audio, 'bright')).toBe(false);
  });
});
