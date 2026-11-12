// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../../model/types';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';

vi.mock('../../persistence/originals', () => ({
  getOriginal: vi.fn(async (id: string) => ({ name: `${id}.wav`, blob: new Blob(['x']) })),
}));

import NowPlayingAudio from './NowPlayingAudio';
import { playClip, togglePlayback, usePlayerStore } from './player';

const node = (id: string, fileType: DocNode['fileType']): DocNode => ({
  id, kind: 'document', title: id, fileType, topics: [], entities: [], keywords: [],
  wordCount: 1, cluster: 0, degree: 0, status: 'ok',
});

describe('shared player', () => {
  const pause = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:clip');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
    useGraphStore.getState().reset();
    useGraphStore.getState().addNodes([node('notes', 'pdf'), node('kick', 'audio'), node('snare', 'audio')]);
    useUiStore.setState({ selectedId: null });
    usePlayerStore.setState({ currentId: null, playing: false, progress: 0, command: null });
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('plays a sample, not the selected document, from the footer button', () => {
    useUiStore.setState({ selectedId: 'notes' });
    togglePlayback();
    expect(usePlayerStore.getState().currentId).toBe('kick');
  });

  it('starts from the selected sample when one is selected', () => {
    useUiStore.setState({ selectedId: 'snare' });
    togglePlayback();
    expect(usePlayerStore.getState().currentId).toBe('snare');
  });

  it('stops and forgets the clip when it leaves the workspace', async () => {
    const { container } = render(<NowPlayingAudio />);
    act(() => playClip('kick'));
    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull());

    act(() => useGraphStore.getState().reset());

    expect(usePlayerStore.getState()).toMatchObject({ currentId: null, playing: false, command: null });
    await waitFor(() => expect(container.querySelector('audio')).toBeNull());
  });

  it('pauses when another player on the page starts', async () => {
    const { container } = render(<><NowPlayingAudio /><audio data-testid="inspector" /></>);
    act(() => playClip('kick'));
    await waitFor(() => expect(container.querySelector('audio[src]')).not.toBeNull());
    pause.mockClear();

    fireEvent.play(container.querySelector('[data-testid="inspector"]')!);

    expect(pause.mock.contexts).toEqual([container.querySelector('audio[src]')]);
  });
});
