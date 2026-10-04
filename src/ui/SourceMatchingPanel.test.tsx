// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import SourceMatchingPanel from './SourceMatchingPanel';
import SamplePackFinder from './SamplePackFinder';
import { compareLocalAudio, loadProvidedReferences } from '../audio/sourceMatching/localLibrary';
import type { LocalReferenceLibrary } from '../audio/sourceMatching/localLibrary';
import type { MatchResult } from '../audio/sourceMatching/matching';
vi.mock('../audio/sourceMatching/localLibrary', () => ({ compareLocalAudio: vi.fn(), loadProvidedReferences: vi.fn(), importLocalReferenceFiles: vi.fn(), importUnlabelledAudio: vi.fn() }));
vi.mock('./useReviewerImport', () => ({ useReviewerImport: () => ({ busy: false, upload: vi.fn() }) }));
const library = { candidates: [], files: new Map(), name: 'Test references' } as LocalReferenceLibrary;
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('URL', class extends URL { static override createObjectURL = vi.fn(() => 'blob:local'); static override revokeObjectURL = vi.fn(); }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const load = async () => { vi.mocked(loadProvidedReferences).mockResolvedValue(library); fireEvent.click(screen.getByText('Load provided flute and marimba references')); await screen.findByText(/0 references ready/); };
it('keeps local references when the optional panel is collapsed and reopened', async () => {
  render(<SamplePackFinder />);
  const summary = screen.getByText('Match a reference sound locally'); const details = summary.closest('details')!;
  details.open = true; fireEvent(details, new Event('toggle')); await screen.findByText('Load provided flute and marimba references'); await load();
  details.open = false; fireEvent(details, new Event('toggle')); details.open = true; fireEvent(details, new Event('toggle'));
  expect(screen.getByText(/0 reference recordings · Test references/)).toBeVisible();
});
it('ignores progress and results arriving after cancellation', async () => {
  let progress: (message: string) => void = () => {}; let finish: (value: LocalReferenceLibrary) => void = () => {};
  vi.mocked(loadProvidedReferences).mockImplementation((_signal, callback) => { progress = callback!; return new Promise(resolve => { finish = resolve; }); });
  render(<SourceMatchingPanel />); fireEvent.click(screen.getByText('Load provided flute and marimba references')); fireEvent.click(screen.getByText('Stop source comparison'));
  await act(async () => { progress('stale decoding'); finish(library); });
  expect(screen.getByRole('status')).toHaveTextContent('Comparison stopped'); expect(screen.queryByText(/Test references/)).toBeNull();
});
it('preserves the reference library after an import failure', async () => {
  render(<SourceMatchingPanel />); await load(); vi.mocked(loadProvidedReferences).mockRejectedValue(new Error('Invalid reference hash')); fireEvent.click(screen.getByText('Load provided flute and marimba references'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid reference hash'); expect(screen.getByText(/0 reference recordings · Test references/)).toBeInTheDocument();
});
it('renders an unknown decision without inventing a preset or origin', async () => {
  vi.mocked(compareLocalAudio).mockResolvedValue({ decision: 'unknown', ranked: [], reason: 'Not enough matching audio evidence.' } as unknown as MatchResult);
  render(<SourceMatchingPanel />); await load(); fireEvent.change(screen.getByLabelText('Audio to compare'), { target: { files: [new File(['audio'], 'Serum-Preset.wav')] } }); fireEvent.click(screen.getByText('Compare with references'));
  expect(await screen.findByText('Unknown source')).toBeVisible(); expect(screen.queryByText('Verified reference origin')).toBeNull(); expect(screen.getByText(/No exact synth-preset library is included/)).toBeVisible();
});
