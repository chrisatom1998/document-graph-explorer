// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { DocNode } from '../../model/types';
import type { MusicAnalysis } from '../../audio/musicTypes';
import { useGraphStore } from '../../store/graphStore';
import { DEFAULT_FILTER, useUiStore } from '../../store/uiStore';
import FilterBar from '../FilterBar';
import GraphNavigator from '../GraphNavigator';
import ResonanceFilters from './ResonanceFilters';

function track(id: string, path: string, estimates: Partial<NonNullable<DocNode['audio']>> = {}): DocNode {
  return {
    id, title: id, path, kind: 'document', fileType: 'audio', topics: [], entities: [],
    keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok',
    audio: { version: 2, durationSeconds: 4, analyzedSeconds: 4, instruments: [], notes: [], ...estimates },
  };
}

describe('Resonance audio filters', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    useUiStore.setState({ filter: { ...DEFAULT_FILTER } });
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    useGraphStore.getState().reset();
    useUiStore.setState({ filter: { ...DEFAULT_FILTER } });
  });

  it('offers filename and folder tempo/key values instead of conflicting or missing estimates', async () => {
    useGraphStore.getState().addNodes([
      track('Tagged piano', 'Piano_128bpm_Dm.wav', {
        tempo: { bpm: 96, confidence: 0.9 }, key: { tonic: 0, mode: 'major', strength: 0.9 },
      }),
      track('Folder sample', '110bpm_Gmajor/clip.wav'),
    ]);
    render(<><ResonanceFilters /><GraphNavigator embedded /></>);

    const key = screen.getByRole('combobox', { name: 'Key' });
    expect(within(key).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Any key', 'D minor', 'G major']);
    expect(screen.getByRole('slider', { name: 'Minimum tempo' })).toHaveAttribute('min', '110');
    expect(screen.getByRole('slider', { name: 'Maximum tempo' })).toHaveAttribute('max', '128');
    fireEvent.change(key, { target: { value: 'D minor' } });
    const list = screen.getByRole('listbox', { name: 'Graph nodes' });
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(within(list).getByRole('option', { name: /Tagged piano/ })).toBeVisible();
    await screen.findByText('1 document matches');
  });

  it('filters equivalent sharp and flat keys together from the sidebar', async () => {
    useGraphStore.getState().addNodes([
      track('Sharp', 'Pad_D#m.wav'),
      track('Flat', 'Pad_Ebm.wav'),
      track('Estimated', 'clip.wav', { key: { tonic: 3, mode: 'minor', strength: 0.9 } }),
      track('Major', 'Pad_Ebmajor.wav'),
    ]);
    render(<><ResonanceFilters /><GraphNavigator embedded /></>);
    fireEvent.change(screen.getByRole('combobox', { name: 'Key' }), { target: { value: 'D♯ minor' } });
    const list = screen.getByRole('listbox', { name: 'Graph nodes' });
    expect(within(list).getAllByRole('option')).toHaveLength(3);
    for (const title of ['Estimated', 'Flat', 'Sharp']) {
      expect(within(list).getByRole('option', { name: new RegExp(title) })).toBeVisible();
    }
    expect(within(list).queryByRole('option', { name: /Major/ })).not.toBeInTheDocument();
    // Let the real lazy advanced-filter panel settle before the test unmounts.
    await screen.findByText('3 documents match');
  });

  it('counts no matches when kind and strength are satisfied by different links', () => {
    useGraphStore.getState().addNodes([track('Alpha', 'a.wav'), track('Beta', 'b.wav')]);
    useGraphStore.getState().setEdges([
      { id: 'instrument', source: 'Alpha', target: 'Beta', kind: 'instrument', weight: 0.5, evidence: [] },
      { id: 'tempo', source: 'Alpha', target: 'Beta', kind: 'tempo', weight: 0.9, evidence: [] },
    ]);
    useUiStore.getState().setFilter({ edgeKinds: ['instrument'], minEdgeWeight: 0.8 });
    render(<><FilterBar embedded /><GraphNavigator embedded /></>);
    expect(screen.getByText('0 documents match')).toBeVisible();
    expect(within(screen.getByRole('listbox', { name: 'Graph nodes' })).queryAllByRole('option')).toEqual([]);
  });

  it('shows an equivalent offered spelling for a restored key filter', async () => {
    useGraphStore.getState().addNodes([track('Sharp', 'Pad_D#m.wav')]);
    useUiStore.getState().setFilter({ musicKey: 'Eb minor' });
    render(<><ResonanceFilters /><GraphNavigator embedded /></>);
    expect(screen.getByRole('combobox', { name: 'Key' })).toHaveValue('D♯ minor');
    expect(within(screen.getByRole('listbox', { name: 'Graph nodes' })).getByRole('option', { name: /Sharp/ })).toBeVisible();
    await screen.findByText('1 document matches');
  });

  it('refreshes filter values when track metadata changes', async () => {
    useGraphStore.getState().addNodes([track('Sample', 'Pad_128bpm_Dm.wav')]);
    render(<ResonanceFilters />);
    const key = screen.getByRole('combobox', { name: 'Key' });
    expect(within(key).getByRole('option', { name: 'D minor' })).toBeInTheDocument();

    act(() => useGraphStore.getState().patchNodes(new Map([
      ['Sample', { path: 'Pad_140bpm_Gmajor.wav' }],
    ])));
    expect(within(key).queryByRole('option', { name: 'D minor' })).not.toBeInTheDocument();
    expect(within(key).getByRole('option', { name: 'G major' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Maximum tempo' })).toHaveAttribute('max', '140');

    act(() => useGraphStore.getState().patchNodes(new Map([
      ['Sample', { path: 'clip.wav', audio: track('Sample', 'clip.wav', {
        tempo: { bpm: 120, confidence: 0.9 }, key: { tonic: 0, mode: 'minor', strength: 0.9 },
      }).audio }],
    ])));
    expect(within(key).queryByRole('option', { name: 'G major' })).not.toBeInTheDocument();
    expect(within(key).getByRole('option', { name: 'C minor' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Maximum tempo' })).toHaveAttribute('max', '120');
    await screen.findByText('1 document matches');
  });
});

const clip = (id: string, confirmedInstruments: string[]): DocNode => ({
  id, kind: 'document', title: id, fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok',
  audio: { version: 2, durationSeconds: 8, analyzedSeconds: 8, instruments: [], notes: [], confirmedInstruments } as MusicAnalysis,
});

describe('Sounds filter', () => {
  afterEach(() => { cleanup(); useGraphStore.getState().reset(); useUiStore.setState({ filter: { ...DEFAULT_FILTER } }); });

  it('lists each sound with its clip count and picks several as "any of"', async () => {
    useGraphStore.getState().addNodes([clip('a', ['voice']), clip('b', ['synth', 'voice']), clip('c', ['drums'])]);
    render(<ResonanceFilters />);
    const sounds = screen.getByRole('region', { name: 'Sounds' });
    expect(sounds).toHaveTextContent('voice 2drums 1synth 1');
    fireEvent.click(screen.getByRole('checkbox', { name: /voice/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /synth/ }));
    expect(useUiStore.getState().filter.sounds).toEqual(['voice', 'synth']);
    expect(sounds).toHaveTextContent('Sounds (any of)');
    fireEvent.click(screen.getByRole('checkbox', { name: /voice/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /synth/ }));
    expect(useUiStore.getState().filter.sounds).toBeNull();
    await screen.findAllByText(/match/);
  });

  it('keeps a picked sound listed after its last clip loses it, so it can be unticked', async () => {
    useGraphStore.getState().addNodes([clip('a', ['drums'])]);
    useUiStore.setState({ filter: { ...DEFAULT_FILTER, sounds: ['voice'] } });
    render(<ResonanceFilters />);
    const voice = screen.getByRole('checkbox', { name: /voice/ });
    expect(voice).toBeChecked();
    fireEvent.click(voice);
    expect(useUiStore.getState().filter.sounds).toBeNull();
    await screen.findAllByText(/match/);
  });
});

describe('restored and orphaned audio filters', () => {
  beforeEach(() => { useGraphStore.getState().reset(); useUiStore.setState({ filter: { ...DEFAULT_FILTER } }); localStorage.clear(); });
  afterEach(() => { cleanup(); useGraphStore.getState().reset(); useUiStore.setState({ filter: { ...DEFAULT_FILTER } }); });

  it('shows a restored character filter even when it is not a genre option', async () => {
    useGraphStore.getState().addNodes([track('Warm clip', 'clip.wav', { confirmedDjTags: { source: [], production: [], character: ['warm'] } })]);
    useUiStore.getState().setFilter({ style: 'warm' });
    render(<ResonanceFilters />);
    const genre = screen.getByRole('combobox', { name: 'Genre' });
    expect(genre).toHaveValue('warm');
    expect(within(genre).getByRole('option', { name: 'warm (saved filter)' })).toBeInTheDocument();
    expect(genre).toBeEnabled();
    fireEvent.change(genre, { target: { value: '' } });
    expect(useUiStore.getState().filter.style).toBeNull();
    await screen.findByText('1 document matches');
  });

  it('keeps active audio facets visible after the last clip disappears and clears only them', async () => {
    useGraphStore.getState().addNodes([track('Clip', '128bpm_Dm.wav')]);
    useUiStore.getState().setFilter({ bpmRange: [120, 130], musicKey: 'D minor', style: 'techno', sounds: ['voice'], fileTypes: ['md'] });
    render(<ResonanceFilters />);
    act(() => {
      useGraphStore.getState().reset();
      useGraphStore.getState().addNodes([{ ...track('Document', 'notes.md'), fileType: 'md', audio: undefined }]);
    });
    expect(screen.getByRole('combobox', { name: 'Key' })).toHaveValue('D minor');
    expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveValue('techno');
    expect(screen.getByRole('checkbox', { name: /voice/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Clear audio filters' }));
    expect(useUiStore.getState().filter).toEqual({ ...DEFAULT_FILTER, fileTypes: ['md'] });
    expect(screen.queryByRole('combobox', { name: 'Key' })).not.toBeInTheDocument();
    await screen.findByText('1 document matches');
  });
});
