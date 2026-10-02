// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DocNode } from '../model/types';
vi.mock('../persistence/originals', () => ({ getOriginal: vi.fn(async () => undefined) }));
vi.mock('../audio/saveAudioGraph', () => ({ saveAudioGraph: vi.fn() }));
vi.mock('../layout/layoutBridge', () => ({ layoutSetLinks: vi.fn(), layoutReheat: vi.fn() }));
import AudioPreview from './AudioPreview';
import { saveAudioGraph } from '../audio/saveAudioGraph';
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
