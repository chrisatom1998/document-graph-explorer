// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import LibrarySettings from './LibrarySettings';

const coordinator = vi.hoisted(() => ({
  outdatedAudioIds: vi.fn(() => ['older']),
  analyzeAudioCorpus: vi.fn(async (_ids?: string[]) => {}),
}));
vi.mock('../pipeline/coordinatorLazy', () => coordinator);
vi.mock('../persistence/library', () => ({
  libraryStats: vi.fn(async () => ({ files: 3, analyses: 2 })),
  clearLibrary: vi.fn(async () => true),
}));

const track = (id: string): DocNode => ({
  id, title: `${id}.wav`, fileType: 'audio', kind: 'document',
  topics: [], entities: [], keywords: [], wordCount: 0, cluster: -1, degree: 0, status: 'ok',
});

beforeEach(() => {
  vi.clearAllMocks();
  useGraphStore.getState().reset();
  useGraphStore.getState().addNodes(['older', 'unfinished', 'current'].map(track));
  useGraphStore.getState().setPhase('ready');
});
afterEach(cleanup);

it('updates only the older tracks named by the button, leaving other unfinished tracks alone', async () => {
  render(<LibrarySettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Update 1 older track' }));
  await waitFor(() => expect(coordinator.analyzeAudioCorpus).toHaveBeenCalledWith(['older']));
  expect(coordinator.analyzeAudioCorpus).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole('status')).toHaveTextContent('Updated 1 track');
});
