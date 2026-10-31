// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ConfidentSoundSummary, { SoundDescription } from './ConfidentSoundSummary';
import type { MusicAnalysis } from '../audio/musicTypes';
import { confidentSoundSummary } from '../audio/confidentSoundSummary';
import { soundMatchLabels } from '../audio/soundMatchLabels';
import { resolvedNonSourceLabels } from '../audio/soundReviewPolicy';
import { matchesStyleFilter } from '../audio/styleTags';
import { TIMBRE_VERSION, type TimbreSummary } from '../audio/timbre';

afterEach(cleanup);
// Measures as "warm, smooth" (timbreDescriptions.ts): a held low tone with nothing above 4 kHz.
const warmSmooth: TimbreSummary = { version: TIMBRE_VERSION, bands: [0, 1, 0, 0, 0, 0], flatness: 0, airFlatness: 0, crest: 1.41, richness: .1, sustain: 1, scoopDb: 0, resonanceDb: 0, inharmonicity: 0 };
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

it('respects a saved character correction in the measured description', () => {
  const corrected = audio({ timbre: warmSmooth, confirmedDjTags: { source: [], production: [], character: [] } });
  const { rerender } = render(<SoundDescription audio={corrected} />);
  expect(screen.queryByText(/^Sound:/)).toBeNull();
  rerender(<SoundDescription audio={{ ...corrected, confirmedDjTags: { source: [], production: [], character: ['warm'] } }} />);
  expect(screen.getByText(/^Sound: warm/)).toBeVisible();
  expect(screen.queryByText(/^Sound: warm, smooth/)).toBeNull();
});

it('lets the latest individual confirmation override a saved empty character list', () => {
  render(<SoundDescription audio={audio({ timbre: warmSmooth, confirmedDjTags: { source: [], production: [], character: [] },
    soundReviews: [{ dimension: 'character', labelId: 'warm', decision: 'confirmed', scope: 'track', at: 'now', evidenceRunId: 'r' }] })} />);
  expect(screen.getByText(/^Sound: warm/)).toBeVisible();
  expect(screen.queryByText(/^Sound: warm, smooth/)).toBeNull();
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

it('renders no hidden-until-tested label in the Sounds row, including its likely group', () => {
  const hidden = audio({ soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false, djTags: [
    { group: 'production', label: 'reverse effect', score: .95, model: 'Trained head' },
    { group: 'character', label: 'distorted', score: .95, model: 'Trained head' },
    { group: 'production', label: 'riser', score: .9, model: 'Trained head' }] } });
  render(<ConfidentSoundSummary audio={hidden} node={{ title: 'clip.wav' }} />);
  expect(screen.queryByText('reverse effect')).toBeNull();
  expect(screen.queryByText('distorted')).toBeNull();
  expect(screen.getAllByText('riser').length).toBeGreaterThan(0);
});
