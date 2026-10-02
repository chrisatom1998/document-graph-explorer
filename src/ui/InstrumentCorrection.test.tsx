// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useGraphStore } from '../store/graphStore';
import type { DocNode } from '../model/types';
import InstrumentCorrection from './InstrumentCorrection';
const setAudioInstruments = vi.hoisted(() => vi.fn());
vi.mock('../pipeline/coordinatorLazy', () => ({ setAudioInstruments }));
const node: DocNode = { id: 'track', kind: 'document', title: 'Track', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok' };
beforeEach(() => {
  setAudioInstruments.mockReset();
  useGraphStore.getState().setPhase('ready');
});
afterEach(cleanup);
function save() {
  render(<InstrumentCorrection node={node} />);
  fireEvent.click(screen.getByText('Correct the instrument'));
  fireEvent.click(screen.getByRole('button', { name: 'Save confirmed instrument' }));
}
it('waits for the persistence acknowledgment before announcing success', async () => {
  let complete!: (value: { saved: boolean; count: number }) => void;
  setAudioInstruments.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  save();
  expect(screen.queryByRole('status')).toBeNull();
  await vi.waitFor(() => expect(setAudioInstruments).toHaveBeenCalled());
  complete({ saved: true, count: 1 });
  expect((await screen.findByRole('status')).textContent).toContain('Saved on this device.');
});
it('explains export requirements for a temporary graph', async () => {
  setAudioInstruments.mockResolvedValue({ saved: false, count: 1 });
  save();
  expect((await screen.findByRole('status')).textContent).toContain('Export this graph to keep your changes.');
  expect(screen.getByRole('status').textContent).not.toContain('Saved');
});
it('reports a failed write without claiming that the correction was saved', async () => {
  setAudioInstruments.mockRejectedValue(new Error('Your correction is visible but could not be saved. Retry before closing.'));
  save();
  expect((await screen.findByRole('status')).textContent).toContain('could not be saved');
  expect(screen.getByRole('button', { name: 'Save confirmed instrument' })).toBeEnabled();
});
