// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { DocNode, Edge } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import TrackVersions from './TrackVersions';

vi.mock('./focusNode', () => ({ focusNode: vi.fn() }));
const { focusNode } = await import('./focusNode');

const track = (id: string, title: string): DocNode => ({ id, kind: 'document', title, fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: -1, degree: 0, status: 'ok',
  audio: { version: 2, analyzedSeconds: 10, durationSeconds: 10, instruments: [], notes: [] } });
const link = (source: string, target: string, text: string): Edge => ({ id: `${source}->${target}:version`, source, target, kind: 'version', weight: .9, evidence: [text] });
afterEach(cleanup);

it('lists copies of the recording, then other versions of the song, and opens them', () => {
  const nodes = [track('a', 'Night Drive.wav'), track('b', 'Night Drive (128k).mp3'), track('c', 'Night Drive (Club Remix).mp3'), track('d', 'Sunrise.mp3')];
  useGraphStore.setState({ nodes, edges: [
    link('a', 'b', 'Same recording (a copy or re-encode): 100% of the shorter file lines up with the other, and the mix matches.'),
    link('b', 'c', 'Another version of the same song: the titles match.'),
    { id: 'a->d:similar', source: 'a', target: 'd', kind: 'similar', weight: .8, evidence: ['Sounds alike'] },
  ] });
  render(<TrackVersions node={nodes[0]} />);
  const group = screen.getByRole('region', { name: 'Versions' });
  expect(within(group).getByText('Versions (3)')).toBeVisible();
  expect(within(group).getByText('Same recording (1)')).toBeVisible();
  expect(within(group).getByText('Other versions of this song (1)')).toBeVisible();
  expect(within(group).getByText('Through Night Drive (128k).mp3.')).toBeVisible();
  expect(within(group).queryByText('Sunrise.mp3')).not.toBeInTheDocument();
  fireEvent.click(within(group).getByRole('button', { name: 'Night Drive (Club Remix).mp3' }));
  expect(focusNode).toHaveBeenCalledWith('c');
});

it('shows nothing for a track without versions', () => {
  const nodes = [track('a', 'Solo.wav')];
  useGraphStore.setState({ nodes, edges: [] });
  render(<TrackVersions node={nodes[0]} />);
  expect(screen.queryByRole('region', { name: 'Versions' })).not.toBeInTheDocument();
});
