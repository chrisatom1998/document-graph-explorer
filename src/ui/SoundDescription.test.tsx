// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ConfidentSoundSummary, { SoundDescription } from './ConfidentSoundSummary';
import type { MusicAnalysis } from '../audio/musicTypes';
import { confidentSoundSummary } from '../audio/confidentSoundSummary';
import { soundMatchLabels } from '../audio/soundMatchLabels';
import { resolvedNonSourceLabels } from '../audio/soundReviewPolicy';
import { matchesStyleFilter } from '../audio/styleTags';
import type { TimbreSummary } from '../audio/timbre';

afterEach(cleanup);
// Measures as "warm, smooth" (timbreDescriptions.ts): a held low tone with nothing above 4 kHz.
const warmSmooth: TimbreSummary = { version: 1, bands: [0, 1, 0, 0, 0, 0], flatness: 0, airFlatness: 0, crest: 1.41, richness: .1, sustain: 1, scoopDb: 0, resonanceDb: 0, inharmonicity: 0 };
const audio = (extra: Partial<MusicAnalysis> = {}): MusicAnalysis => ({ version: 2, durationSeconds: 30, analyzedSeconds: 30, instruments: [], notes: [], ...extra });
const modelWarm = { version: 1 as const, character: ['warm'], roles: [], models: [], disagreement: false,
  djTags: [{ group: 'character' as const, label: 'warm', score: .9, model: 'Trained head' as const }, { group: 'character' as const, label: 'bright', score: .9, model: 'Trained head' as const }] };

it('shows the rule words as one plain line, apart from the tags, and nothing for old analyses', () => {
  render(<SoundDescription audio={audio({ timbre: warmSmooth })} />);
  const line = screen.getByText(/^Sound: warm, smooth/);
  expect(line.tagName).toBe('P');
  expect(line).toHaveAttribute('title', expect.stringContaining('fixed rules, not a trained model'));
  cleanup();
  const { container } = render(<SoundDescription audio={audio()} />);
  expect(container).toBeEmptyDOMElement();
});

it('leaves out words you rejected or that already show as tags', () => {
  render(<SoundDescription audio={audio({ timbre: warmSmooth, soundReviews: [{ dimension: 'character', labelId: 'smooth', decision: 'rejected', scope: 'track', at: 'now', evidenceRunId: 'r' }] })} exclude={['warm']} />);
  expect(screen.queryByText(/^Sound:/)).toBeNull();
});

it('never shows a model estimate of the rule words as a tag, link label or filter match, but keeps your confirmation', () => {
  const estimated = audio({ soundProfile: modelWarm });
  expect(confidentSoundSummary(estimated).map(s => s.label)).not.toContain('warm');
  expect(soundMatchLabels({ title: 'x.wav', path: 'x.wav', audio: estimated }).map(m => m.label)).not.toContain('warm');
  expect(resolvedNonSourceLabels(estimated).map(l => l.label)).toEqual(['bright']);
  expect(matchesStyleFilter(estimated, 'warm')).toBe(false);
  expect(matchesStyleFilter({ ...estimated, timbre: warmSmooth }, 'warm')).toBe(true);
  render(<ConfidentSoundSummary audio={estimated} />);
  expect(screen.queryByText('warm')).toBeNull();
  cleanup();
  const confirmed = audio({ soundProfile: modelWarm, soundReviews: [{ dimension: 'character', labelId: 'warm', decision: 'confirmed', scope: 'track', at: 'now', evidenceRunId: 'r' }] });
  expect(confidentSoundSummary(confirmed).find(s => s.label === 'warm')?.origin).toBe('confirmed by you');
});
