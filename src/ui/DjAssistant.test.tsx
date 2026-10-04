// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useGraphStore } from '../store/graphStore';
import { useCorpusStore } from '../store/corpusStore';
import { EMPTY_SAMPLE_QUERY } from '../audio/sampleQuery';
import type { DocNode } from '../model/types';
vi.mock('../persistence/originals', () => ({ getOriginal: vi.fn(async () => undefined) }));
vi.mock('./DjTagCorrection', () => ({ default: () => <p>Correction controls</p> }));
import DjAssistant from './DjAssistant';

const clip = (id: string, durationSeconds: number): DocNode => ({ id, title: id, kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, degree: 0, cluster: -1, status: 'ok', audio: { version: 2, durationSeconds, analyzedSeconds: durationSeconds, instruments: [], notes: [], confirmedDjTags: { source: ['voice'], production: ['vocal chops'], character: [] } } });
beforeEach(() => {
  localStorage.clear();
  useGraphStore.getState().reset(); useGraphStore.getState().addNodes([clip('short.wav', 2), clip('long.wav', 20)]); useGraphStore.getState().setPhase('ready');
  useCorpusStore.setState({ activeCorpusId: 'test-corpus' });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const open = () => { render(<DjAssistant />); fireEvent.click(screen.getByRole('button', { name: /Sample assistant/ })); };
describe('sample assistant workflow', () => {
  it('filters locally without calling OpenAI, then saves and restores the crate', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); open();
    fireEvent.click(screen.getByText('Filters', { exact: true }));
    fireEvent.change(screen.getByLabelText('Maximum seconds'), { target: { value: '5' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Apply local filters' }).closest('form')!);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '+ Add to crate' }));
    expect(JSON.parse(localStorage.getItem('dge:dj-crate:test-corpus')!)).toEqual(['short.wav']);
    fireEvent.click(screen.getByRole('button', { name: 'Close sample assistant' }));
    fireEvent.click(screen.getByRole('button', { name: /Sample assistant/ }));
    fireEvent.click(screen.getByRole('button', { name: 'View crate' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('executes validated AI search filters without uploading the library', async () => {
    const fetch = vi.fn(async () => Response.json({ plan: { ...EMPTY_SAMPLE_QUERY, maxSeconds: 5 }, model: 'test' })); vi.stubGlobal('fetch', fetch); open();
    fireEvent.change(screen.getByLabelText('Describe the sound'), { target: { value: 'short clips' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Search sounds' }).closest('form')!);
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
    const call = (fetch.mock.calls as unknown as [string, RequestInit][])[0];
    expect(String(call[1].body)).not.toContain('.wav');
  });
  it('keeps the previous results and shows actionable API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'API usage limit reached' }, { status: 502 }))); open();
    fireEvent.change(screen.getByLabelText('Describe the sound'), { target: { value: 'short clips' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Search sounds' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('API usage limit');
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });
  it('opens checked free-pack sources and keeps license evidence with saved sources', () => {
    open(); fireEvent.click(screen.getByText('Tools', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Find free packs' }));
    expect(screen.getAllByRole('link', { name: /License evidence/ })).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Sound or instrument'), { target: { value: 'impact' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save source' }));
    expect(JSON.parse(localStorage.getItem('dge:training-pack-sources')!)).toEqual(['kenney-impact']);
  });
  it('downloads a supported pack and shows the reviewer import result', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ jobId: 'a'.repeat(24) }, { status: 202 })).mockResolvedValueOnce(Response.json({ state: 'complete', message: 'Complete', result: { added: 12, skipped: 2, failed: [] } }));
    vi.stubGlobal('fetch', fetch); open();
    fireEvent.click(screen.getByText('Tools', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Find free packs' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Download to reviewer' })[0]);
    expect(await screen.findByText('12 sounds added')).toBeInTheDocument();
    expect(fetch.mock.calls[0][0]).toBe('/api/dj-reviewer/packs');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ packId: 'freepats-synth' });
    expect(localStorage.getItem('dge:reviewer-pack-job')).toBeNull();
  });
  it('imports an archive with publisher and license evidence and displays failures', async () => {
    const fetch = vi.fn(async () => Response.json({ error: 'No supported audio found in this archive.' }, { status: 400 }));
    vi.stubGlobal('fetch', fetch); open();
    fireEvent.click(screen.getByText('Tools', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Find free packs' }));
    fireEvent.change(screen.getByLabelText('Pack name'), { target: { value: 'New sounds' } });
    fireEvent.change(screen.getByLabelText('Publisher page'), { target: { value: 'https://example.org/pack' } });
    fireEvent.change(screen.getByLabelText('License evidence page'), { target: { value: 'https://example.org/license' } });
    const file = new File(['zip'], 'sounds.zip');
    fireEvent.change(screen.getByLabelText('Pack archive'), { target: { files: [file] } });
    fireEvent.submit(screen.getByRole('button', { name: 'Import archive to reviewer' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('No supported audio');
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toContain('sourceUrl=https%3A%2F%2Fexample.org%2Fpack');
    expect(calls[0][0]).toContain('licenseUrl=https%3A%2F%2Fexample.org%2Flicense');
    expect(calls[0][1].body).toBe(file);
  });
});

it('keeps an in-flight search and its state alive while minimized', async () => {
  let complete!: (value: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(resolve => { complete = resolve; }));
  vi.stubGlobal('fetch', fetch); open();
  fireEvent.change(screen.getByLabelText('Describe the sound'), {target:{value:'short clips'}});
  fireEvent.submit(screen.getByRole('button',{name:'Search sounds'}).closest('form')!);
  const signal = (fetch.mock.calls as unknown as [string,RequestInit][])[0][1].signal!;
  fireEvent.click(screen.getByRole('button',{name:'Minimize sample assistant'}));
  expect(document.querySelector('dialog')).not.toHaveAttribute('open');
  expect(signal.aborted).toBe(false);
  complete(Response.json({plan:{...EMPTY_SAMPLE_QUERY,maxSeconds:5}}));
  await waitFor(()=>expect(document.querySelectorAll('.dj-card')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button',{name:/Sample assistant/}));
  expect(screen.getByLabelText('Describe the sound')).toHaveValue('short clips');
  expect(screen.getAllByRole('article')).toHaveLength(1);
});
