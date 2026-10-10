import { describe, expect, it } from 'vitest';
import { otherModelGuessGroups, soundMatchLabels } from './soundMatchLabels';
import { confirmedInstrumentList } from './instrumentEvidence';
import { sanitizeMusicAnalysis } from './musicTypes';
import { confidentSoundSummary } from './confidentSoundSummary';
import { MERGED_DJ_LABELS, type DjGroup } from './djTags';

describe('merged label consumer regressions', () => {
  for (const [key, merged] of Object.entries(MERGED_DJ_LABELS)) {
    const [group, label] = key.split(':') as [DjGroup, string];
    it(`projects ${key} guesses under their surviving group and label`, () => {
      const profile = { djTags: [{ group, label, score: .3 }] };
      expect(otherModelGuessGroups({ profile, exclude: [] })).toEqual([{ group: merged.group, values: [merged.label] }]);
      expect(otherModelGuessGroups({ profile, exclude: [merged.label] })).toEqual([]);
      expect(otherModelGuessGroups({ profile: { djTags: [{ ...profile.djTags[0], ...merged }] }, exclude: [label] })).toEqual([]);
    });
    it.each(['rejected', 'uncertain'] as const)(`honors old ${key} %s reviews on the survivor`, decision => {
      const dimension = group === 'production' ? 'effect' : group;
      const sounds = confidentSoundSummary({ version: 2, durationSeconds: 4, analyzedSeconds: 4, instruments: [], notes: [],
        soundReviews: [{ dimension, labelId: label, decision, scope: 'track', at: 'now', evidenceRunId: 'old' }],
        soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false,
          djTags: [{ ...merged, score: .9, model: 'Trained head' }] },
      });
      expect(sounds.some(t => t.label === merged.label)).toBe(false);
    });
    it(`does not retain ${key} as a second graph-link label`, () => {
      const labels = soundMatchLabels({ title: 'recording.wav', audio: {
        version: 2, durationSeconds: 4, analyzedSeconds: 4, instruments: [], notes: [],
        soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false,
          djTags: [{ group, label, score: .9, model: 'Trained head' }] },
      } });
      expect(labels.some(t => t.label === label)).toBe(false);
      expect(labels.filter(t => t.label === merged.label)).toHaveLength(1);
    });
  }
  it('honors destination source suppression when an effect merges into a source', () => {
    expect(otherModelGuessGroups({ profile: { djTags: [{ group: 'production', label: 'vocal breath', score: .3 }] }, exclude: [], skipSource: true })).toEqual([]);
  });
  it('uses migrated DJ source corrections instead of the stale parallel instrument snapshot', () => {
    const restored = sanitizeMusicAnalysis({ version: 2, durationSeconds: 4, analyzedSeconds: 4, instruments: [], notes: [],
      confirmedInstruments: ['noise'], confirmedDjTags: { source: ['noise'], production: ['vocal breath'], character: [] },
    })!;
    expect(confirmedInstrumentList(restored)).toEqual(['breath']);
    expect(restored.confirmedDjTags).toEqual({ source: ['breath'], production: ['static noise'], character: [] });
    expect(sanitizeMusicAnalysis(restored)).toEqual(restored);
  });
});
