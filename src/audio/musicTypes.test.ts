import { expect, it } from 'vitest';
import { sanitizeMusicAnalysis } from './musicTypes';

it('moves saved instrument corrections with merged look-alike tags', () => {
  const out = sanitizeMusicAnalysis({ version: 2, durationSeconds: 4, analyzedSeconds: 4, instruments: [], notes: [],
    confirmedInstruments: ['noise', 'piano'], confirmedDjTags: { source: ['noise', 'piano'], production: ['vocal breath'], character: [] } });
  expect(out?.confirmedDjTags).toEqual({ source: ['piano', 'breath'], production: ['static noise'], character: [] });
  expect(out?.confirmedInstruments).toEqual(['piano', 'breath']);
});
