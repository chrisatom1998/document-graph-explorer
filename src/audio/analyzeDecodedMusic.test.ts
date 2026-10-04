import { describe, expect, it, vi } from 'vitest';
import { analyzeDecodedMusic, type AnalysisOptions, type MusicRequest } from './analyzeDecodedMusic';
import { fastInstrumentStarts } from './analysisPlan';
import { sanitizeMusicAnalysis, type MusicAnalysis } from './musicTypes';
import type { MusicDecoder } from './decodeMusic';
import { reliableInstruments } from './instrumentEvidence';
import { ResultCache } from './recognition';
import type { DescriptionScore } from './profileDescriptions';

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
    if (message.kind === 'rhythm' || message.kind === 'tonal') return { version: 2, durationSeconds: duration, analyzedSeconds: Math.min(60, duration), instruments: [], notes: [] } as T;
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
    expect(f.calls.filter(c=>c==='jamendo')).toHaveLength(2); // shared full timeline; preview is reused
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
    expect(f.calls).toEqual(['jamendo','rhythm','tonal','instruments','profile']);
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
it('accepts a slightly short EOF decode instead of failing the scan or tempo/key jobs', async () => {
  const duration = 75;
  const actual = 74.5;
  const decoder: MusicDecoder = { durationSeconds: duration, close() {}, read: vi.fn(async (start, seconds, rate) =>
    new Float32Array(Math.round(Math.max(0, Math.min(seconds, actual - start)) * rate)).fill(.1)) };
  const request: MusicRequest = async <T>(message: Record<string, unknown>) => {
    if (message.kind === 'rhythm' || message.kind === 'tonal') return { version: 2, durationSeconds: duration, analyzedSeconds: actual, instruments: [], notes: [] } as T;
    if (message.kind === 'instruments') return { scores: { piano: .95 }, musicScore: .9 } as T;
    if (message.kind === 'jamendo') return { synthesizer: .7 } as T;
    return [{ group: 'source', label: 'piano', score: .6 }] as T;
  };
  const result = await analyzeDecodedMusic(decoder, request, {});
  expect(result.durationSeconds).toBe(actual);
  expect(result.recognition?.evidence.every(e=>e.end<=actual && e.validSeconds===e.end-e.start)).toBe(true);
  expect(result.recognition?.jobs.find(j=>j.modelId==='ast')?.analyzedSeconds).toBe(actual);
  expect(result.instrumentScan?.complete).toBe(true);
  expect(result.recognition?.jobs.find(j => j.modelId === 'rhythm')?.status).toBe('complete');
  expect(result.recognition?.jobs.find(j => j.modelId === 'tonal')?.status).toBe('complete');
  expect(result.notes).not.toContain('Tempo analysis was unavailable. Reanalyze to retry.');
  expect(result.notes).not.toContain('Key analysis was unavailable. Reanalyze to retry.');
});

describe('independent recognition jobs', () => {
  it('includes sub-50ms tails and reuses only matching audio cache entries', async () => {
    const cache = new ResultCache();
    const first = fixture(10.02, { cache, audioFingerprint: 'same' });
    const result = await first.run();
    expect(result.recognition?.jobs.find(j=>j.modelId==='ast')?.gaps).toEqual([]);
    const second = fixture(10.02, { cache, audioFingerprint: 'same' });
    await second.run(); expect(second.calls).toEqual(['rhythm','tonal']);
    const different = fixture(10.02, { cache, audioFingerprint: 'different' });
    await different.run(); expect(different.calls).toContain('instruments');
  });
  it('keeps rhythm and instruments when tonality fails', async () => {
    const result=await fixture(12,{},'tonal').run();
    expect(result.recognition?.jobs.find(j=>j.modelId==='tonal')?.status).toBe('failed');
    expect(result.recognition?.jobs.find(j=>j.modelId==='rhythm')?.status).toBe('complete');
    expect(result.recognition?.observations.length).toBeGreaterThan(0);
  });
  it('keeps independent evidence when the first AST request fails', async () => {
    const result = await fixture(12, {}, 'instruments').run();
    expect(result.soundProfile?.models.find(m => m.model === 'MTG-Jamendo')?.complete).toBe(true);
    expect(result.soundProfile?.models.find(m => m.model === 'Music CLAP')?.complete).toBe(true);
    expect(result.recognition?.jobs.find(j => j.modelId === 'ast')?.successful).toEqual([]);
    expect(result.recognition?.observations.some(o => o.labelId === 'synthesizer')).toBe(true);
  });
  it('preserves sources and tonality when rhythm fails', async () => {
    const result = await fixture(12, {}, 'rhythm').run();
    expect(result.soundProfile?.source).toBeDefined();
    expect(result.recognition?.jobs.find(j => j.modelId === 'rhythm')?.status).toBe('failed');
    expect(result.recognition?.jobs.find(j => j.modelId === 'tonal')?.status).toBe('complete');
  });
  it('covers the full track independently with all three sound models', async () => {
    const result = await fixture(75).run();
    for (const modelId of ['ast', 'jamendo', 'clap']) {
      const job = result.recognition?.jobs.find(j => j.modelId === modelId);
      expect(job?.analyzedSeconds).toBe(75);
      expect(job?.gaps).toEqual([]);
    }
    expect(result.recognition?.observations.every(o => o.status === 'possible' && o.confidence === undefined)).toBe(true);
  });
  it('preserves completed evidence on cancellation without resolving as complete', async () => {
    const controller = new AbortController(); let partial: MusicAnalysis | undefined;
    const f = fixture(12, { signal: controller.signal, onPartial: p => { partial = p; controller.abort(); } });
    await expect(f.run()).rejects.toMatchObject({ name: 'AbortError' });
    expect(partial?.recognition?.status).toBe('cancelled');
    expect(partial?.recognition?.evidence.length).toBeGreaterThan(0);
  });
});
it('does not credit interior truncated reads as successful evidence', async () => {
  const f=fixture(30);const read=f.decoder.read;
  f.decoder.read=async(start,seconds,rate)=>start===0?new Float32Array(1):read(start,seconds,rate);
  const result=await f.run();
  expect(result.recognition?.jobs.find(j=>j.modelId==='ast')?.successful).toEqual([]);
  expect(result.recognition?.evidence).toEqual([]);
});
it('records unsupported short Jamendo inputs without inference or repeated scan eligibility', async()=>{
 const f=fixture(1);const r=await f.run();
 expect(f.calls).not.toContain('jamendo');
 expect(r.recognition?.jobs.find(j=>j.modelId==='jamendo')).toMatchObject({status:'unsupported',successful:[],analyzedSeconds:0});
 expect(r.instrumentScan?.complete).toBe(true);
 expect(sanitizeMusicAnalysis(r)?.recognition?.jobs.find(j=>j.modelId==='jamendo')?.status).toBe('unsupported');
});

async function vocalEvidenceFixture(scores: DescriptionScore[], duration=3) {
 const decoder: MusicDecoder = { durationSeconds:duration, close() {}, read:async(start,seconds,rate)=>new Float32Array(Math.round(Math.min(seconds,duration-start)*rate)).fill(.1) };
 const request: MusicRequest = async<T,>(message:Record<string,unknown>) => {
  if(message.kind==='profile')return scores as T;
  if(message.kind==='instruments')return {scores:{piano:.95},musicScore:.9} as T;
  if(message.kind==='jamendo')return {} as T;
  return {version:2,durationSeconds:3,analyzedSeconds:3,instruments:[],notes:[]} as T;
 };
 return analyzeDecodedMusic(decoder,request,{mode:'full'});
}
it.each([
 {group:'sample' as const,label:'vocal chops',competitor:'synthesizer'},
 {group:'vocal' as const,label:'singing',competitor:'instrumental'},
])('preserves strong $label voice evidence beside an instrument, with its raw basis',async({group,label,competitor})=>{
 const result=await vocalEvidenceFixture([{group,label,score:.6},{group,label:competitor,score:.2}]);
 const voice=result.recognition!.evidence.find(e=>e.dimension==='source'&&e.labelId==='voice');
 expect(voice).toMatchObject({modelId:'clap',start:0,end:3,score:.6,derivedFrom:{group,labelId:label}});
 expect(result.recognition!.observations.filter(o=>o.dimension==='source').map(o=>o.labelId)).toEqual(['piano','voice']);
 expect(result.soundProfile?.source?.label).toBe('piano');
 expect(result.soundProfile?.voice?.basis).toBe('Music CLAP');
 expect(sanitizeMusicAnalysis(result)?.recognition?.evidence).toEqual(result.recognition!.evidence);
 expect(reliableInstruments(result)).toEqual([]);
});
it.each([
 [{group:'sample',label:'vocal chops',score:.34},{group:'sample',label:'synthesizer',score:.1}],
 [{group:'sample',label:'vocal chops',score:.6},{group:'sample',label:'synthesizer',score:.58}],
 [{group:'vocal',label:'singing',score:.34},{group:'vocal',label:'instrumental',score:.1}],
 [{group:'vocal',label:'singing',score:.6},{group:'vocal',label:'instrumental',score:.55}],
 []
] as DescriptionScore[][])('does not invent source voice when the existing vocal rule fails (%j)',async(...scores)=>{
 const result=await vocalEvidenceFixture(scores as DescriptionScore[]);
 expect(result.recognition!.observations.some(o=>o.dimension==='source'&&o.labelId==='voice')).toBe(false);
});
it('uses the qualifying sample score instead of an unrelated higher vocal score, without duplicates',async()=>{
 const scores:DescriptionScore[]=[{group:'sample',label:'vocal chops',score:.5},{group:'sample',label:'synthesizer',score:.2},{group:'vocal',label:'vocal chops',score:.9},{group:'vocal',label:'instrumental',score:.89}];
 const result=await vocalEvidenceFixture(scores);
 expect(result.recognition!.evidence.find(e=>e.labelId==='voice')).toMatchObject({score:.5,derivedFrom:{group:'sample',labelId:'vocal chops'}});
 const direct=await vocalEvidenceFixture([...scores,{group:'source',label:'voice',score:.7}]);
 const voices=direct.recognition!.evidence.filter(e=>e.labelId==='voice');
 expect(voices).toHaveLength(1);expect(voices[0].score).toBe(.7);expect(voices[0].derivedFrom).toBeUndefined();
});

it('keeps derived voice provenance separate for overlapping classifier windows',async()=>{
 const result=await vocalEvidenceFixture([{group:'sample',label:'vocal chops',score:.6},{group:'sample',label:'synthesizer',score:.2}],12);
 const voices=result.recognition!.evidence.filter(e=>e.dimension==='source'&&e.labelId==='voice');
 expect(voices.map(e=>[e.start,e.end])).toEqual([[0,10],[2,12]]);
 expect(new Set(voices.map(e=>e.id)).size).toBe(2);
 expect(sanitizeMusicAnalysis(result)?.recognition?.evidence.filter(e=>e.labelId==='voice')).toEqual(voices);
});

it('routes atmosphere evidence to the effect dimension',async()=>{
 const result=await vocalEvidenceFixture([{group:'role',label:'atmosphere',score:.8},{group:'role',label:'lead',score:.1}]);
 expect(result.recognition!.evidence.find(e=>e.labelId==='atmosphere')).toMatchObject({dimension:'effect',score:.8});
 expect(sanitizeMusicAnalysis(result)?.recognition?.evidence.find(e=>e.labelId==='atmosphere')?.dimension).toBe('effect');
});
it('avoids unused growing snapshots when the consumer only needs cancellation evidence',async()=>{
 const partial=vi.fn();const clone=vi.spyOn(globalThis,'structuredClone');
 try {
  const f=fixture(120,{mode:'full',partialUpdates:'cancelled',onPartial:partial});
  const result=await f.run();
  expect(partial).not.toHaveBeenCalled();expect(clone.mock.calls.some(([value])=>value && typeof value==='object' && 'recognition' in value)).toBe(false);
  expect(result.recognition?.jobs.every(j=>j.status==='complete')).toBe(true);
 } finally {clone.mockRestore();}
});

it('finishes supported work on a sub-two-second effect without treating unsupported Jamendo as a failed run', async()=>{
 const r=await fixture(.7).run();
 expect(r.recognition?.status).toBe('complete');
 expect(r.recognition?.jobs.find(j=>j.modelId==='jamendo')?.status).toBe('unsupported');
});


// Independent reviewer regressions; scratch only.
it.each(['instruments','profile','rhythm','tonal'])('review: short unsupported Jamendo does not mask %s failure',async fail=>{
 const result=await fixture(.7,{},fail).run();
 expect(result.recognition?.status).toBe('partial');
 expect(result.recognition?.jobs.find(j=>j.modelId==='jamendo')?.status).toBe('unsupported');
 expect(result.recognition?.jobs.find(j=>j.modelId===({instruments:'ast',profile:'clap',rhythm:'rhythm',tonal:'tonal'} as Record<string,string>)[fail])?.status).toBe('failed');
 expect(sanitizeMusicAnalysis(result)?.recognition?.status).toBe('partial');
});
it.each([.7,2,2.048,8])('review: default %s-second run never dispatches crops or competitors',async duration=>{
 const f=fixture(duration);const result=await f.run();
 expect(f.calls.filter(c=>c==='profile')).toHaveLength(1);
 expect(result.recognition?.configurationHash).not.toContain('short-events');
 expect(result.notes.some(n=>/Experimental short-event|unresolved/.test(n))).toBe(false);
 expect(result.recognition?.status).toBe('complete');
 expect(result.recognition?.jobs.find(j=>j.modelId==='jamendo')?.status).toBe(duration<2.048?'unsupported':'complete');
});
