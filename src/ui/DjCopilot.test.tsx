// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { DocNode } from '../model/types';
import DjCopilot from './DjCopilot';
import { applyCopilotProperties } from '../audio/applyCopilotProperties';
vi.mock('../audio/applyCopilotProperties', () => ({ applyCopilotProperties: vi.fn(async () => 'AI-suggested properties saved for 1 sound.'), copilotCorpusIdentity: () => 'test-corpus' }));
vi.mock('./DjTagCorrection', () => ({ default: () => <p>Manual correction controls</p> }));
vi.mock('../persistence/originals', () => ({ getOriginal: vi.fn(async () => undefined) }));
const clip = (id: string): DocNode => ({ id, title: `${id}.wav`, path: `/private/${id}.wav`, kind: 'document', fileType: 'audio',
  topics: [], entities: [], keywords: [], wordCount: 0, degree: 0, cluster: -1, status: 'ok',
  audio: { version: 2, durationSeconds: 2, analyzedSeconds: 2, instruments: [], notes: [], confirmedDjTags: { source: ['voice'], production: ['vocal chops'], character: [] } } });
const props = () => ({ audio: ['one', 'two', 'three', 'four', 'five', 'six'].map(clip), ready: true, localApi: true, crate: [], onAddToCrate: vi.fn(), onOpen: vi.fn() });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('copilot review UI', () => {
  it('shows evidence locally and limits review batches to five', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); render(<DjCopilot {...props()} />);
    const boxes = screen.getAllByRole('checkbox');
    boxes.slice(0, 5).forEach(box => fireEvent.click(box));
    expect(boxes[5]).toBeDisabled();
    expect(screen.getAllByText('Confirmed by you: voice, vocal chops')).toHaveLength(5);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(boxes[0]); expect(boxes[5]).not.toBeDisabled();
  });
  it('sends anonymized evidence only and displays advice without applying labels', async () => {
    const fetch = vi.fn(async () => Response.json({ answer: 'Listen to Sample 1.', model: 'gpt-6.1-sol' })); vi.stubGlobal('fetch', fetch);
    const p = props(); render(<DjCopilot {...p} />); fireEvent.click(screen.getByRole('checkbox', { name: 'one.wav' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review selected sounds' }));
    expect(await screen.findByText('Listen to Sample 1.')).toBeInTheDocument();
    const sent = String((fetch.mock.calls as unknown as [string, RequestInit][])[0][1].body);
    expect(sent).not.toMatch(/private|one\.wav/); expect(sent).toContain('vocal chops');
    expect(p.onAddToCrate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '+ Add to crate' })); expect(p.onAddToCrate).toHaveBeenCalledWith('one');
    fireEvent.change(screen.getByLabelText('What should the copilot review?'), { target: { value: 'New request' } });
    expect(screen.getByText(/review is historical/)).toBeInTheDocument();
  });
  it('preserves local evidence after an API error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'API quota exhausted.' }, { status: 502 })));
    render(<DjCopilot {...props()} />); fireEvent.click(screen.getByRole('checkbox', { name: 'one.wav' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review selected sounds' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('API quota exhausted');
    expect(screen.getByText('Confirmed by you: voice, vocal chops')).toBeInTheDocument();
  });
  it('aborts the request on close and never uploads audio without a transcription action', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, options) => { signal = options.signal; return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(Error('Aborted')))); }));
    const view = render(<DjCopilot {...props()} />); fireEvent.click(screen.getByRole('checkbox', { name: 'one.wav' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review selected sounds' }));
    await waitFor(() => expect(signal).toBeDefined()); view.unmount(); expect(signal!.aborted).toBe(true);
  });
  it('explains missing original audio without making an API request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(<DjCopilot {...props()} />); fireEvent.click(screen.getByRole('checkbox', { name: 'one.wav' }));
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe vocal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add the original audio'); expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps local evidence available in a static build', () => {
    render(<DjCopilot {...props()} localApi={false} />); fireEvent.click(screen.getByRole('checkbox', { name: 'one.wav' }));
    expect(screen.getByRole('button', { name: 'Review selected sounds' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Transcribe vocal' })).toBeDisabled();
    expect(screen.getByText('Confirmed by you: voice, vocal chops')).toBeInTheDocument();
  });
  it('applies structured suggestions to the reviewed sound only, once', async () => {
    const tags = { source: ['voice'], production: ['vocal chops'], character: [] };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ answer: 'Consider vocal chops.', model: 'gpt-6.1-sol', suggestions: [{ ref: 'Sample 1', tags }] })));
    const p = props(); p.audio[0].audio!.confirmedDjTags = undefined;
    render(<DjCopilot {...p} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'one.wav' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review selected sounds' }));
    const apply = await screen.findByRole('button', { name: 'Apply suggested properties' });
    expect(applyCopilotProperties).not.toHaveBeenCalled();
    fireEvent.click(apply);
    expect(await screen.findByRole('button', { name: '✓ Properties added' })).toBeDisabled();
    expect(applyCopilotProperties).toHaveBeenCalledWith(expect.objectContaining({ ids: ['one'], suggestions: [{ ref: 'Sample 1', tags }], corpus: 'test-corpus' }));
    expect(applyCopilotProperties).toHaveBeenCalledOnce();
  });
  it('disables applying a stale review and lets a failed save be retried', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ answer: 'Consider voice.', model: 'gpt-6.1-sol', suggestions: [{ ref: 'Sample 1', tags: { source: ['voice'], production: [], character: [] } }] })));
    const p = props(); p.audio[0].audio!.confirmedDjTags = undefined;
    render(<DjCopilot {...p} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'one.wav' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review selected sounds' }));
    const apply = await screen.findByRole('button', { name: 'Apply suggested properties' });
    vi.mocked(applyCopilotProperties).mockRejectedValueOnce(Error('Saving failed. Retry.'));
    fireEvent.click(apply);
    expect(await screen.findByRole('alert')).toHaveTextContent('Saving failed');
    expect(apply).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'two.wav' }));
    expect(apply).toBeDisabled();
  });
});
