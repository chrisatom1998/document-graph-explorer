// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ConfidentSoundSummary from './ConfidentSoundSummary';
import type { MusicAnalysis } from '../audio/musicTypes';
import { confidentSoundSummary } from '../audio/confidentSoundSummary';

afterEach(cleanup);
const tag = (label: string, score: number, model: 'Trained head' | 'Trained head (maybe)' = 'Trained head') => ({ group: 'source' as const, label, score, model });
const audio = (extra: Partial<MusicAnalysis> = {}): MusicAnalysis => ({ version: 2, durationSeconds: 8, analyzedSeconds: 8, instruments: [], notes: [],
  soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false,
    djTags: [tag('synthesizer', .45), tag('guitar', .8), tag('organ', .7, 'Trained head (maybe)')] }, ...extra });
const node = { path: 'clip.wav', title: 'clip.wav' };
const chips = () => screen.queryAllByRole('button', { name: /^Not sure\? Fix / });

it('fixture covers a possible, a maybe and a likely tag', () => {
  const shown = confidentSoundSummary(audio());
  expect(shown.find(s => s.label === 'synthesizer')?.tier).toBe('possible');
  expect(shown.find(s => s.label === 'organ')?.maybe).toBe(true);
  expect(shown.find(s => s.label === 'guitar')).toMatchObject({ tier: 'likely' });
  expect(shown.find(s => s.label === 'guitar')?.maybe).toBeUndefined();
});

it('shows the chip on possible and maybe tags only, and nowhere without a save handler', () => {
  render(<ConfidentSoundSummary audio={audio()} node={node} onFix={vi.fn()} />);
  expect(chips().map(b => b.getAttribute('aria-label'))).toEqual(['Not sure? Fix synthesizer', 'Not sure? Fix organ']);
  expect(screen.queryByRole('button', { name: /Confirm|Reject/ })).toBeNull();
  // The details stay uncluttered: no fix panel until a chip is tapped.
  expect(screen.queryByRole('group', { name: /^Fix / })).toBeNull();
  cleanup();
  render(<ConfidentSoundSummary audio={audio()} node={node} />);
  expect(chips()).toEqual([]);
});

it.each([
  ['Keep', { dimension: 'source', label: 'synthesizer', action: 'keep' }],
  ['Remove', { dimension: 'source', label: 'synthesizer', action: 'remove' }],
])('%s saves that fix and closes the panel', async (button, fix) => {
  const onFix = vi.fn().mockResolvedValue(undefined);
  render(<ConfidentSoundSummary audio={audio()} node={node} onFix={onFix} />);
  fireEvent.click(screen.getByRole('button', { name: 'Not sure? Fix synthesizer' }));
  const panel = screen.getByRole('group', { name: 'Fix synthesizer' });
  fireEvent.click(within(panel).getByRole('button', { name: button }));
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Fix synthesizer' })).toBeNull());
  expect(onFix).toHaveBeenCalledWith(fix);
});

it('picking the right tag saves a replacement', async () => {
  const onFix = vi.fn().mockResolvedValue(undefined);
  render(<ConfidentSoundSummary audio={audio()} node={node} onFix={onFix} />);
  fireEvent.click(screen.getByRole('button', { name: 'Not sure? Fix organ' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Pick the right tag' }), { target: { value: 'source:piano' } });
  await waitFor(() => expect(onFix).toHaveBeenCalledWith({ dimension: 'source', label: 'organ', action: 'replace', to: { dimension: 'source', label: 'piano' } }));
});

it('shows a save failure and keeps the panel open', async () => {
  render(<ConfidentSoundSummary audio={audio()} node={node} onFix={vi.fn().mockRejectedValue(new Error('Wait for file processing to finish.'))} />);
  fireEvent.click(screen.getByRole('button', { name: 'Not sure? Fix synthesizer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Wait for file processing to finish.');
  expect(screen.getByRole('group', { name: 'Fix synthesizer' })).toBeVisible();
});

it('saved fixes override the shown tags for the file', () => {
  const at = '2026-10-31T12:00:00.000Z';
  render(<ConfidentSoundSummary node={node} onFix={vi.fn()} audio={audio({ soundTagFixes: [
    { dimension: 'source', label: 'synthesizer', action: 'remove', at },
    { dimension: 'source', label: 'organ', action: 'replace', to: { dimension: 'source', label: 'piano' }, at },
  ] })} />);
  const region = screen.getByRole('region', { name: 'Sound identification' });
  expect(region).not.toHaveTextContent('synthesizer');
  expect(region).not.toHaveTextContent('organ');
  expect(region.querySelector('.sound-tag--confirmed')).toHaveTextContent(/piano/);
  expect(chips()).toEqual([]);
});
