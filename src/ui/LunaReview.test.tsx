// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LunaReview from './LunaReview';
import { sample } from '../audio/lunaEvidence.fixture';
import { deterministicLuna, LUNA_MODEL, LUNA_POLICY } from '../audio/lunaEvidence';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('sends only metadata on explicit click and requires another action to choose listening', async () => {
  const fetch = vi.fn(async () => Response.json({ model: LUNA_MODEL, policy: LUNA_POLICY, status: 'complete', cached: false,
    samples: [{ ...deterministicLuna(sample), review: 'recommend', reason: 'Ambiguous keys with unknown coverage.' }] }));
  vi.stubGlobal('fetch', fetch); const choose = vi.fn();
  render(<LunaReview samples={[sample]} disabled={false} onChooseAudio={choose} />);
  expect(fetch).not.toHaveBeenCalled(); expect(screen.getByText(/Vocals → voice/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Normalize labels and check review need' }));
  expect(await screen.findByText('Ambiguous keys with unknown coverage.')).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledOnce(); expect(choose).not.toHaveBeenCalled();
  const args = (fetch.mock.calls as unknown[][])[0];
  expect(args[0]).toBe('/api/dj-copilot/review-luna');
  expect(JSON.stringify(args[1])).not.toMatch(/wav|base64|apiKey/);
  fireEvent.click(screen.getByRole('button', { name: 'Choose GPT-Audio listening review' }));
  expect(choose).toHaveBeenCalledWith(['Sample 1']); expect(fetch).toHaveBeenCalledOnce();
});
it('keeps deterministic evidence visible on failure', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw Error('secret upstream detail'); }));
  render(<LunaReview samples={[sample]} disabled={false} onChooseAudio={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Normalize labels and check review need' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Existing detector results are unchanged');
  expect(screen.getByText(/Vocals → voice/)).toBeInTheDocument();
  expect(screen.queryByText(/secret upstream detail/)).not.toBeInTheDocument();
});
