// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocNode } from '../../model/types';
import type { MusicAnalysis } from '../../audio/musicTypes';

vi.mock('../FilterBar', () => ({ default: () => null }));
vi.mock('../../ingest/DropZone', () => ({ openFilePicker: vi.fn() }));
vi.mock('../../ingest/folderPicker', () => ({ openFolderPicker: vi.fn() }));

import ResonanceFilters from './ResonanceFilters';
import { useGraphStore } from '../../store/graphStore';
import { DEFAULT_FILTER, useUiStore } from '../../store/uiStore';

const clip = (id: string, confirmedInstruments: string[]): DocNode => ({
  id, kind: 'document', title: id, fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok',
  audio: { version: 2, durationSeconds: 8, analyzedSeconds: 8, instruments: [], notes: [], confirmedInstruments } as MusicAnalysis,
});

afterEach(() => { cleanup(); useUiStore.setState({ filter: { ...DEFAULT_FILTER } }); });

describe('Sounds filter', () => {
  it('lists each sound with its clip count and picks several as "any of"', () => {
    useGraphStore.setState({ nodes: [clip('a', ['voice']), clip('b', ['synth', 'voice']), clip('c', ['drums'])], edges: [] });
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
  });
});
