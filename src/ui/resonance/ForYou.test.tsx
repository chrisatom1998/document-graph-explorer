// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../../model/types';
import { useGraphStore } from '../../store/graphStore';
import { usePlayerStore } from '../../store/playerStore';
import { useViewStore } from '../../store/viewStore';

vi.mock('../DimsToggleButton', () => ({ DimsToggleButton: () => <button type="button">2D 3D</button> }));
vi.mock('../../ingest/DropZone', () => ({ openFilePicker: vi.fn() }));
vi.mock('../../ingest/folderPicker', () => ({ openFolderPicker: vi.fn() }));
vi.mock('../useDemoLoader', () => ({ useDemoLoader: () => ({ loading: null, load: vi.fn() }) }));

import ForYou from './ForYou';

const clip = (id: string, extra: Partial<DocNode> = {}): DocNode => ({
  id, kind: 'document', title: id, fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: -1, degree: 0, status: 'ok', ...extra,
});

describe('ForYou', () => {
  beforeEach(() => {
    useGraphStore.getState().reset();
    usePlayerStore.getState().clear();
    useViewStore.setState({ tab: 'foryou' });
  });
  afterEach(cleanup);

  it('shows an honest empty page: no numbers, sounds, tags or crate', () => {
    render(<ForYou />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your sound map starts here');
    expect(screen.getByText('No key crate yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play crate (no crate yet)' })).toBeDisabled();
    expect(document.body.textContent).not.toMatch(/\d+ (clips?|neighbourhoods?|BPM)/i);
    expect(document.querySelectorAll('.fy-tag, .fy-chip, .fy-card__title')).toHaveLength(0);
    expect(screen.getByText(/with how each was found/)).toBeInTheDocument();
  });

  it('counts only what exists and says why tempo and key are missing', () => {
    useGraphStore.getState().addNodes([clip('Kick one'), clip('Snare two')]);
    render(<ForYou />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('2 clips');
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent('neighbourhood');
    expect(screen.getByText(/Neighbourhoods appear once/)).toBeInTheDocument();
    expect(screen.getByText('None of your 2 clips have a detected key.', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText('No tempo or key yet').length).toBeGreaterThan(0);
    expect(screen.queryByText(/BPM$/)).not.toBeInTheDocument();
  });

  it('plays a card through the shared player and opens a clip in the graph', () => {
    useGraphStore.getState().addNodes([clip('Kick one'), clip('Snare two')]);
    render(<ForYou />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Play Kick one' })[0]);
    expect(usePlayerStore.getState().currentId).toBe('Kick one');
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(useViewStore.getState().tab).toBe('library');
  });

  it('builds the crate from a detected key', () => {
    const audio = { version: 2 as const, analyzedSeconds: 8, durationSeconds: 8, instruments: [], notes: [], key: { tonic: 9, mode: 'minor' as const, strength: 1 }, tempo: { bpm: 124, confidence: 1 } };
    useGraphStore.getState().addNodes([clip('a', { audio }), clip('b', { audio: { ...audio, tempo: { bpm: 126, confidence: 1 } } }), clip('c')]);
    render(<ForYou />);
    expect(screen.getByText('A minor crate')).toBeInTheDocument();
    expect(screen.getByText('2 clips, 124–126 BPM, all in A minor.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play the A minor crate' }));
    expect(usePlayerStore.getState()).toMatchObject({ currentId: 'a', queue: ['a', 'b'] });
  });
});
