import { describe, expect, it, vi } from 'vitest';
import { analyzeDecodedMusic, type AnalysisOptions, type MusicRequest } from './analyzeDecodedMusic';
import { fastInstrumentStarts } from './analysisPlan';
import { sanitizeMusicAnalysis, type MusicAnalysis } from './musicTypes';
import type { MusicDecoder } from './decodeMusic';
import { reliableInstruments } from './instrumentEvidence';

function fixture(duration: number, options: AnalysisOptions = {}, fail?: string) {
  const calls: string[] = [];
  const decoder: MusicDecoder = { durationSeconds: duration, close() {}, read: vi.fn(async (start, seconds, rate) => {
    options.signal?.throwIfAborted();
    return new Float32Array(Math.round(Math.max(0, Math.min(seconds, duration - start)) * rate)).fill(.1);
  }) };
  const request: MusicRequest = async <T>(message: Record<string, unknown>) => {
    options.signal?.throwIfAborted();
    calls.push(String(message.kind));
    if (message.kind === fail) throw new Error('Model unavailable');
    if (message.kind === 'rhythm') return { version: 2, durationSeconds: duration, analyzedSeconds: Math.min(60, duration), instruments: [], notes: [] } as T;
    if (message.kind === 'instruments') return { scores: { piano: .95 }, musicScore: .9 } as T;
    if (message.kind === 'jamendo') return { synthesizer: .7 } as T;
    return [{group:'source',label:'piano',score:.6}] as T;
  };
  return { calls, decoder, run: () => analyzeDecodedMusic(decoder, request, options) };
}
describe('early estimates and selectable music scans', () => {
  it('publishes a preliminary estimate before the expensive scan and reuses its model result', async () => {
    let preview: MusicAnalysis | undefined;
    const f=fixture(12,{onPreview:p=>{preview=p;expect(f.calls).toEqual(['jamendo']);}});
    const full=await f.run();
    expect(preview?.stage).toBe('preview');expect(preview?.soundProfile?.source?.label).toBe('synthesizer');
    expect(reliableInstruments(preview!)).toEqual([]);
    expect(full.stage).toBeUndefined();expect(full.soundProfile?.source?.label).toBe('piano');
    expect(full.instrumentScan).toMatchObject({mode:'full',complete:true,analyzedSeconds:12,windows:2});
    expect(f.calls.filter(c=>c==='jamendo')).toHaveLength(3); // not four: preview is reused
    expect(preview?.soundProfile?.source?.label).toBe('synthesizer'); // immutable preview snapshot
  });
  it('bounds Fast mode while keeping all three models and truthful coverage', async () => {
    const f=fixture(75,{mode:'fast'});const result=await f.run();
    expect(result.instrumentScan).toMatchObject({mode:'fast',complete:true,analyzedSeconds:30,windows:3});
    expect(f.calls.filter(c=>c==='jamendo')).toHaveLength(1);
    expect(f.calls.filter(c=>c==='profile')).toHaveLength(1);
    expect(result.soundProfile?.models.every(m=>m.complete)).toBe(true);
    expect(sanitizeMusicAnalysis(result)?.instrumentScan).toEqual(result.instrumentScan);
  });
  it('avoids repeated overlapping inference for short loops in Fast mode', async () => {
    const f=fixture(12,{mode:'fast'});const result=await f.run();
    expect(result.instrumentScan).toMatchObject({mode:'fast',complete:true,analyzedSeconds:10,windows:1});
    expect(f.calls).toEqual(['jamendo','rhythm','instruments','profile']);
    expect(fastInstrumentStarts(6)).toEqual([0]);
    expect(fastInstrumentStarts(19)).toEqual([4.5]);
    expect(fastInstrumentStarts(24)).toEqual([0,14]);
    expect(fastInstrumentStarts(30)).toEqual([0,10,20]);
  });
  it('keeps complete Full coverage on long recordings', async () => {
    const result=await fixture(75).run();
    expect(result.instrumentScan).toMatchObject({mode:'full',complete:true,analyzedSeconds:75,windows:14});
  });
  it('keeps preview provenance through persistence and respects cancellation', async () => {
    const abort=new AbortController();let preview: MusicAnalysis | undefined;
    const f=fixture(12,{signal:abort.signal,onPreview:p=>{preview=p;abort.abort();}});
    await expect(f.run()).rejects.toMatchObject({name:'AbortError'});
    expect(sanitizeMusicAnalysis(preview)?.stage).toBe('preview');
    expect(f.calls).toEqual(['jamendo']);
  });
  it('does not mark a failed model as a complete scan', async () => {
    const result=await fixture(12,{mode:'fast'},'profile').run();
    expect(result.instrumentScan?.complete).toBe(false);
    expect(result.soundProfile?.models.find(m=>m.model==='Music CLAP')?.complete).toBe(false);
    expect(result.notes).toContain('Sound character recognition was unavailable. Reanalyze to retry.');
  });
});
it('falls back to full discovery if the container has no duration', async () => {
  const f=fixture(12,{mode:'fast'});f.decoder.durationSeconds=0;
  expect((await f.run()).instrumentScan).toMatchObject({mode:'full',complete:true,analyzedSeconds:12});
});
