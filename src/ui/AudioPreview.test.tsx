// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DocNode } from '../model/types';
vi.mock('../persistence/originals', () => ({ getOriginal: vi.fn(async () => undefined) }));
vi.mock('../audio/saveAudioGraph', () => ({ saveAudioGraph: vi.fn() }));
vi.mock('../audio/convertAudio', () => ({ convertAudio: vi.fn() }));
vi.mock('../layout/layoutBridge', () => ({ layoutSetLinks: vi.fn(), layoutReheat: vi.fn() }));
import AudioPreview from './AudioPreview';
import { saveAudioGraph } from '../audio/saveAudioGraph';
import { getOriginal } from '../persistence/originals';
import { convertAudio } from '../audio/convertAudio';
import { useGraphStore } from '../store/graphStore';
const node = (id: string): DocNode => ({ id, title: id, fileType: 'audio', kind: 'document', topics: [], entities: [], keywords: [], wordCount: 0, cluster: -1, degree: 0, status: 'ok' });
beforeEach(() => {
  vi.mocked(saveAudioGraph).mockReset().mockResolvedValue('Relationships saved on this device.');
  useGraphStore.getState().reset();
  useGraphStore.getState().addNodes([node('first'), node('second')]);
  useGraphStore.getState().setPhase('ready');
});
afterEach(cleanup);
function connect() {
  fireEvent.click(screen.getByText('Connect to another track'));
  fireEvent.change(screen.getByLabelText('Track to connect'), { target: { value: 'second' } });
  fireEvent.change(screen.getByLabelText('Relationship'), { target: { value: 'Same rhythm' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect tracks' }));
}
describe('one status line', () => {
  it('keeps a stored analysis warning visible on a node whose status stayed ok', async () => {
    const warning = 'Audio analysis failed. Reanalyze this track to retry.';
    const view = render(<AudioPreview node={{ ...node('first'), warning }} />);
    await screen.findByText(/Audio is not saved here/);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toMatch(/^Audio is not saved here.*Audio analysis failed/);
    view.rerender(<AudioPreview node={node('first')} />);
    expect(screen.getByRole('status')).not.toHaveTextContent(warning);
  });
  it('joins playback feedback and the analysis state instead of stacking two lines', async () => {
    const preview = { ...node('first'), audio: { version: 2 as const, durationSeconds: 8, analyzedSeconds: 2, instruments: [], notes: [], stage: 'preview' as const } };
    render(<AudioPreview node={preview} />);
    await screen.findByText(/Audio is not saved here/);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(/Audio is not saved here.*Quick estimate only\. Reanalyze to finish/);
    expect(screen.getByRole('button', { name: 'Finish analysis' })).toBeInTheDocument();
  });
});

describe('audio relationships', () => {
  it('adds a labeled graph edge and removes it again', async () => {
    render(<AudioPreview node={node('first')} />);
    connect();
    await screen.findByText('Relationships saved on this device.');
    expect(useGraphStore.getState().edges[0].evidence).toEqual(['Your relationship: Same rhythm']);
    expect(useGraphStore.getState().nodes[0].degree).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove relationship Your relationship: Same rhythm' }));
    await waitFor(() => expect(useGraphStore.getState().edges).toHaveLength(0));
    expect(saveAudioGraph).toHaveBeenCalledTimes(2);
  });
  it('keeps a failed save visible and provides a working retry', async () => {
    vi.mocked(saveAudioGraph).mockRejectedValueOnce(new Error('quota'));
    render(<AudioPreview node={node('first')} />);
    connect();
    await screen.findByText('Your relationships are visible but could not be saved. Retry before closing.');
    expect(useGraphStore.getState().edges).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving relationships' }));
    await screen.findByText('Relationships saved on this device.');
    expect(screen.queryByRole('button', { name: 'Retry saving relationships' })).toBeNull();
  });

  it('updates the same manual link from either track without duplicating it', async () => {
    const view = render(<AudioPreview node={node('first')} />);
    connect();
    await screen.findByText('Relationships saved on this device.');
    view.unmount();
    render(<AudioPreview node={node('second')} />);
    fireEvent.click(screen.getByText('Connect to another track'));
    fireEvent.change(screen.getByLabelText('Track to connect'), { target: { value: 'first' } });
    fireEvent.change(screen.getByLabelText('Relationship'), { target: { value: 'Shared sample' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect tracks' }));
    await screen.findByText('Relationships saved on this device.');
    expect(useGraphStore.getState().edges).toHaveLength(1);
    expect(useGraphStore.getState().edges[0].evidence).toEqual(['Your relationship: Shared sample']);
  });
  it('explains missing originals after importing a graph', async () => {
    render(<AudioPreview node={node('first')} />);
    await screen.findByText('Audio is not saved here. Add the original file again to play it.');
    expect(screen.queryByRole('button', { name: 'Prepare playback' })).toBeNull();
  });
});

describe('preparing playback', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', class extends URL {
      static override createObjectURL = vi.fn((blob: Blob) => `blob:${blob.size}`);
      static override revokeObjectURL = vi.fn();
    });
    vi.mocked(getOriginal).mockResolvedValue({ hash: 'first', name: 'clip.flac', blob: new Blob(['original']) });
    vi.mocked(convertAudio).mockResolvedValue(new Blob(['converted audio']));
  });
  afterEach(() => { vi.mocked(getOriginal).mockResolvedValue(undefined); vi.unstubAllGlobals(); });

  it('keeps a warning after loading succeeds and after playback conversion', async () => {
    const warning = 'Analysis is incomplete. Reanalyze to finish.';
    render(<AudioPreview node={{ ...node('first'), warning }} />);
    await screen.findByRole('button', { name: 'Prepare playback' });
    expect(screen.getByRole('status')).toHaveTextContent(warning);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare playback' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Ready to play.'));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(warning);
  });

  it('resets transport state when conversion replaces a playing clip', async () => {
    const view = render(<AudioPreview node={node('first')} />);
    await screen.findByRole('button', { name: 'Prepare playback' });
    const original = view.container.querySelector('audio')!;
    Object.defineProperty(original, 'duration', { value: 20 });
    original.currentTime = 8;
    fireEvent.loadedMetadata(original);
    fireEvent.timeUpdate(original);
    fireEvent.play(original);
    expect(screen.getByRole('button', { name: 'Pause sample' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare playback' }));
    await screen.findByText('Ready to play.');
    expect(view.container.querySelector('audio')).not.toBe(original);
    expect(screen.getByRole('button', { name: 'Play sample' })).toBeEnabled();
    expect(screen.getByLabelText('Sample position')).toHaveValue('0');
    expect(screen.getByLabelText('Sample position')).toBeDisabled();
  });

  it('ignores an old play rejection after conversion replaces the audio element', async () => {
    let failPlay!: (error: Error) => void;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { failPlay = reject; }));
    try {
      render(<AudioPreview node={node('first')} />);
      await screen.findByRole('button', { name: 'Prepare playback' });
      fireEvent.click(screen.getByRole('button', { name: 'Play sample' }));
      fireEvent.click(screen.getByRole('button', { name: 'Prepare playback' }));
      await screen.findByText('Ready to play.');
      await act(async () => failPlay(new Error('The play request was interrupted by a new load request')));
      expect(screen.getByRole('status')).toHaveTextContent('Ready to play.');
    } finally { vi.mocked(HTMLMediaElement.prototype.play).mockRestore(); }
  });
});
