// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import SoundIdentification, { OtherModelGuesses } from './SoundIdentification';
import type { SoundProfile } from '../audio/soundProfile';
afterEach(cleanup);
const profile: SoundProfile = { version: 1, source: { label: 'synthesizer', basis: 'MTG-Jamendo', corroborated: false }, resemblance: 'trumpet', character: ['pulsing', 'reverberant'], roles: ['lead'], disagreement: false, models: [{model:'AudioSet AST',complete:true,candidates:[]},{model:'MTG-Jamendo',complete:true,candidates:[{label:'synthesizer',score:.6}]},{model:'Music CLAP',complete:false,candidates:[{label:'trumpet',score:.5}]}] };
it('shows only the instrument and compares models with actual results', () => {
 render(<SoundIdentification profile={profile} />);
 expect(screen.getByText('synthesizer',{selector:'dd'})).toBeVisible();
 expect(screen.queryByText('Character')).toBeNull();
 expect(screen.queryByText('Suggested role')).toBeNull();
 expect(screen.queryByText('Sounds like')).toBeNull();
 expect(screen.getByText('Model comparisons').closest('details')).not.toHaveAttribute('open');
 fireEvent.click(screen.getByText('Model comparisons'));
 expect(screen.queryByText('AudioSet AST')).toBeNull();
 expect(screen.getByText('MTG-Jamendo',{selector:'strong'})).toBeVisible();
 expect(screen.getByText('Music CLAP',{selector:'strong'})).toBeVisible();
 expect(screen.getByText(/trumpet — partial result/)).toBeVisible();
});
it('hides the model comparison section when no model has results', () => {
 render(<SoundIdentification profile={{...profile,source:undefined,models:profile.models.map(m=>({...m,candidates:[]}))}} />);
 expect(screen.getByText('Not identified yet')).toBeVisible();
 expect(screen.queryByText('Model comparisons')).toBeNull();
 fireEvent.click(screen.getByText('Explanations'));
 expect(screen.getByText('No instrument was identified confidently.')).toBeVisible();
});
it('preserves confirmed labels and explains disagreement on request', () => {
 render(<SoundIdentification profile={{...profile,disagreement:true}} sourceOverride={{label:'electric piano',origin:'confirmed by you'}} />);
 expect(screen.getByText('electric piano',{selector:'dd'})).toBeVisible();
 fireEvent.click(screen.getByText('Explanations'));
 expect(screen.getByText('Instrument source: confirmed by you.')).toBeVisible();
 expect(screen.getByText(/instrument models disagree/)).toBeVisible();
});
it('explains early estimates without displaying empty pending model rows', () => {
 render(<SoundIdentification preliminary profile={profile} />);
 fireEvent.click(screen.getByText('Explanations'));
 expect(screen.getByText('Early estimate; verification is still in progress.')).toBeVisible();
 expect(screen.queryByText('No supported match')).toBeNull();
});
it('shows voice alongside an instrument, with the vocal style inside explanations only', () => {
 const withVoice:SoundProfile={...profile,voice:{basis:'MTG-Jamendo',corroborated:true,style:'vocal chops'}};
 const view=render(<SoundIdentification profile={withVoice} />);
 expect(screen.getByText('synthesizer, vocal chops',{selector:'dd'})).toBeVisible();
 expect(screen.getByText(/Music CLAP suggests vocal chops/)).not.toBeVisible();
 fireEvent.click(screen.getByText('Explanations'));
 expect(screen.getByText(/Music CLAP suggests vocal chops/)).toBeVisible();
 view.rerender(<SoundIdentification profile={withVoice} sourceOverride={{label:'synthesizer',origin:'confirmed by you'}} />);
 expect(screen.getByText('synthesizer',{selector:'dd'})).toBeVisible();
 expect(screen.queryByText(/Music CLAP suggests vocal chops/)).toBeNull();
});
it('retains detected voice alongside filename clues without duplicating the label', () => {
 const withVoice:SoundProfile={...profile,voice:{basis:'AudioSet AST',corroborated:false}};
 const view=render(<SoundIdentification profile={withVoice} sourceOverride={{label:'synthesizer',origin:'file name',allowVoice:true}} />);
 expect(screen.getByText('synthesizer, voice',{selector:'dd'})).toBeVisible();
 view.rerender(<SoundIdentification profile={withVoice} sourceOverride={{label:'voice',origin:'file name',allowVoice:true}} />);
 expect(screen.getByText('voice',{selector:'dd'})).toBeVisible();
});
it('displays a vocal-chop result as the main label instead of synthesizer or generic voice', () => {
 render(<SoundIdentification profile={{...profile,source:{label:'voice',basis:'Music CLAP',corroborated:false},voice:{basis:'Music CLAP',corroborated:false,style:'vocal chops'},disagreement:true}} />);
 expect(screen.getByText('vocal chops',{selector:'dd'})).toBeVisible();
 expect(screen.queryByText('synthesizer',{selector:'dd'})).toBeNull();
 expect(screen.queryByText('voice',{selector:'dd'})).toBeNull();
});

describe('OtherModelGuesses', () => {
  const profile = { version: 1 as const, character: [], roles: [], models: [], disagreement: false, djTags: [
    { group: 'source' as const, label: 'drums', score: .4 }, { group: 'source' as const, label: 'synthesizer', score: .4 },
    { group: 'production' as const, label: 'drum loop', score: .4 }, { group: 'character' as const, label: 'rhythmic_stabs', score: .4 },
  ] };
  it('shows untested guesses by group, without repeating tags already in Sounds', () => {
    render(<OtherModelGuesses profile={profile} exclude={['Drums']} />);
    const region = screen.getByRole('region', { name: 'Other model guesses' });
    expect(region).not.toHaveTextContent('untested');
    expect(within(region).queryByText('drums')).toBeNull();
    expect(within(region).getByText('synthesizer')).toBeVisible();
    expect(within(region).getByText('drum loop')).toBeVisible();
    expect(within(region).getByText('rhythmic stabs')).toBeVisible();
  });
  it('hides empty groups, confirmed groups and itself when nothing is left', () => {
    const { container } = render(<OtherModelGuesses profile={profile} exclude={[]} skipSource
      reviewedLabels={[{ group: 'production', label: 'drum loop', source: 'confirmed' }, { group: 'character', label: 'rhythmic_stabs', source: 'estimated' }]} />);
    expect(container).not.toHaveTextContent(/Source|drum loop|Production type/);
    expect(container).toHaveTextContent('rhythmic stabs');
    const empty = render(<OtherModelGuesses profile={profile} exclude={[]} confirmedDjTags={{ source: ['piano'], production: [], character: [] }} />);
    expect(empty.container).toBeEmptyDOMElement();
  });
});
