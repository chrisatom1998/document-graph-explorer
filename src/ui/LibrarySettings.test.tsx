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
  coordinator.outdatedAudioIds.mockReturnValue(['older']);
  // Once updated, nothing is left from an older release.
  coordinator.analyzeAudioCorpus.mockImplementation(async () => { coordinator.outdatedAudioIds.mockReturnValue([]); });
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
  expect(await screen.findByRole('status')).toHaveTextContent('Update requested for 1 track. Check track progress and warnings.');
});

it('reports how many selected tracks still have older results without claiming success', async () => {
  coordinator.outdatedAudioIds.mockReturnValue(['older', 'other']);
  // One track fails and keeps its older results.
  coordinator.analyzeAudioCorpus.mockImplementation(async () => { coordinator.outdatedAudioIds.mockReturnValue(['other']); });
  render(<LibrarySettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Update 2 older tracks' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Update requested for 2 tracks; 1 track still has older results. Check track progress and warnings.');
});

it('does not call an incomplete Full result a successful update when it leaves the outdated list', async () => {
  coordinator.analyzeAudioCorpus.mockImplementation(async () => {
    useGraphStore.getState().patchNodes(new Map([['older', { audio: {
      version: 2, durationSeconds: 30, analyzedSeconds: 10, instruments: [], notes: [],
      instrumentScan: { mode: 'full', complete: false, analyzedSeconds: 10, windows: 1 },
    } }]]));
    useGraphStore.getState().setFileStatus({ fileId: 'older', name: 'older.wav', stage: 'error', error: 'Instrument analysis stopped early.' });
    // The real selector excludes unfinished results, even though this attempt failed.
    coordinator.outdatedAudioIds.mockReturnValue([]);
  });
  render(<LibrarySettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Update 1 older track' }));
  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent('Update requested for 1 track. Check track progress and warnings.');
  expect(status).not.toHaveTextContent(/Updated \d/);
  expect(useGraphStore.getState().nodes.find(n => n.id === 'older')!.audio?.instrumentScan?.complete).toBe(false);
  expect(useGraphStore.getState().fileStatuses.older.stage).toBe('error');
});
