import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { analyzeDecodedMusic, type AnalysisOptions, type MusicRequest } from './analyzeDecodedMusic';
import { fastInstrumentStarts } from './analysisPlan';
import { arrangement } from './structureArrangement.testutil';
import { sanitizeMusicAnalysis, type MusicAnalysis } from './musicTypes';
import type { MusicDecoder } from './decodeMusic';
import { instrumentWindowStarts, reliableInstruments } from './instrumentEvidence';
import { ResultCache } from './recognition';
import type { DescriptionScore } from './profileDescriptions';
import { confidentSoundSummary } from './confidentSoundSummary';
import { TAGGER_UNAVAILABLE } from './tagger';

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
it('keeps native head windows localized through the full refresh pipeline so a covered false alarm stays suppressed', async () => {
  const duration = 40, { decoder } = fixture(duration);
  let profileWindow = 0;
  const request: MusicRequest = async <T>(message: Record<string, unknown>) => {
    if (message.kind === 'tagger') return { 'cat:reverse effect': 0 } as T;
    if (message.kind === 'rhythm' || message.kind === 'tonal') return { version: 2, durationSeconds: duration, analyzedSeconds: duration, instruments: [], notes: [] } as T;
    if (message.kind === 'instruments') return { scores: {}, musicScore: 0 } as T;
    if (message.kind === 'jamendo') return {} as T;
    if (message.kind === 'profile' && !message.samples16 && profileWindow++ === 2) return [{ group: 'dj-learned', learnedGroup: 'production', label: 'reverse effect', score: .99, basis: 'head', decision: 'include' }] as T;
    return [] as T;
  };
  const result = await analyzeDecodedMusic(decoder, request, { mode: 'full', tagger: true });
  expect(result.soundProfile!.djTags!.find(t => t.label === 'reverse effect')!.windowEvidence).toEqual({ windows: [{ start: 10, end: 20, score: .99 }], complete: true });
  expect(confidentSoundSummary(result).find(t => t.label === 'reverse effect')).toBeUndefined();
});
describe('side-by-side model families', () => {
  /** Varying, out-of-order completion: results must not depend on which family answers first. */
  function timed(duration: number, options: AnalysisOptions, fail?: string) {
    let active = 0, maxActive = 0, reads = 0, maxReads = 0;
    const perFamily: Record<string, number> = {};
    let familyOverlap = false;
    const decoder: MusicDecoder = { durationSeconds: duration, close() {}, read: async (start, seconds, rate) => {
      maxReads = Math.max(maxReads, ++reads); await new Promise(r => setTimeout(r, 1)); reads--;
      return new Float32Array(Math.round(Math.max(0, Math.min(seconds, duration - start)) * rate)).fill(.1);
    } };
    const delays: Record<string, number> = { instruments: 7, jamendo: 1, profile: 4, rhythm: 3, tonal: 2, tagger: 9 };
    const request: MusicRequest = async <T>(message: Record<string, unknown>) => {
      const kind = String(message.kind);
      maxActive = Math.max(maxActive, ++active);
      if ((perFamily[kind] = (perFamily[kind] ?? 0) + 1) > 1) familyOverlap = true;
      const samples = message.samples as Float32Array | undefined;
      const n = (samples?.length ?? 0) % 97 / 97;
      await new Promise(r => setTimeout(r, delays[kind]));
      active--; perFamily[kind]--;
      if (kind === fail) throw new Error('Model unavailable');
      if (kind === 'rhythm' || kind === 'tonal') return { version: 2, durationSeconds: duration, analyzedSeconds: Math.min(60, duration), instruments: [], notes: [] } as T;
      if (kind === 'instruments') return { scores: { piano: .6 + n * .3, guitar: .4 + n * .2 }, musicScore: .9 } as T;
      if (kind === 'jamendo') return { synthesizer: .5 + n * .3, drums: .3 + n / 3 } as T;
      if (kind === 'tagger') return { drums: .8, piano: .2, 'cat:reverse effect': .75 } as T;
      return [{group:'source',label:'piano',score:.5 + n * .2}] as T;
    };
    return { run: () => analyzeDecodedMusic(decoder, request, options), stats: () => ({ maxActive, maxReads, familyOverlap }) };
  }
  const comparable = (analysis: MusicAnalysis) => {
    const copy = structuredClone(analysis);
    if (copy.recognition) { copy.recognition.runId = ''; copy.recognition.startedAt = ''; copy.recognition.endedAt = ''; }
    return copy;
  };
  it.each([['full', undefined], ['fast', undefined], ['full', 'profile'], ['full', 'instruments'], ['full', 'tagger'], ['fast', 'tagger']] as const)('matches one-at-a-time results exactly (%s, failing %s)', async (mode, fail) => {
    const base = { mode, audioFingerprint: 'same-audio', tagger: true } as const;
    const serial = timed(47, { ...base }, fail), side = timed(47, { ...base, concurrentModels: true }, fail);
    const [a, b] = [await serial.run(), await side.run()];
    expect(comparable(b)).toEqual(comparable(a));
    expect(serial.stats()).toMatchObject({ maxActive: 1, familyOverlap: false });
    expect(side.stats().familyOverlap).toBe(false);
    expect(side.stats().maxReads).toBe(1); // one FFmpeg instance: section reads queue
    if (mode === 'full') expect(side.stats().maxActive).toBeGreaterThan(1);
  });
  it('stops scoring ahead when the run is cancelled', async () => {
    const controller = new AbortController();
    const f = timed(300, { signal: controller.signal, concurrentModels: true });
    const run = f.run(); setTimeout(() => controller.abort(new DOMException('cancelled', 'AbortError')), 20);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('finishes the tagger while heavy inference is still pending without publishing its result early', async () => {
    const { decoder } = fixture(3);
    let release!: () => void;
    const heavy = new Promise<void>(resolve => { release = resolve; });
    let activeHeavy = 0, previews = 0;
    const request: MusicRequest = async <T>(message: Record<string, unknown>) => {
      if (message.kind === 'instruments' || message.kind === 'profile') {
        activeHeavy++;
        await heavy;
        activeHeavy--;
      }
      if (message.kind === 'tagger') {
        expect(activeHeavy).toBeGreaterThan(0);
        release();
        return { drums: .8 } as T;
      }
      if (message.kind === 'instruments') return { scores: { piano: .9 }, musicScore: .8 } as T;
      if (message.kind === 'profile') return [] as T;
      if (message.kind === 'jamendo') return { piano: .7 } as T;
      return { version: 2, durationSeconds: 3, analyzedSeconds: 3, instruments: [], notes: [] } as T;
    };
    const observe = (result: MusicAnalysis) => { previews++; expect(result.tagger).toBeUndefined(); };
    const result = await analyzeDecodedMusic(decoder, request, {
      mode: 'full', tagger: true, concurrentModels: true, onPreview: observe, onPartial: observe,
    });
    expect(previews).toBeGreaterThan(0);
    expect(result.tagger?.scores.drums).toBe(.8);
    expect(result.recognition?.status).toBe('complete');
  });

  it('handles cancellation during early tagger inference without publishing late evidence', async () => {
    const { decoder } = fixture(3);
    const controller = new AbortController();
    let release!: () => void;
    const tagger = new Promise<void>(resolve => { release = resolve; });
    const partials: MusicAnalysis[] = [];
    const request: MusicRequest = async <T>(message: Record<string, unknown>) => {
      if (message.kind === 'tagger') {
        controller.abort();
        await tagger;
        return { drums: .9 } as T;
      }
      if (message.kind === 'instruments') return { scores: {}, musicScore: 0 } as T;
      if (message.kind === 'profile') return [] as T;
      if (message.kind === 'jamendo') return {} as T;
      return { version: 2, durationSeconds: 3, analyzedSeconds: 3, instruments: [], notes: [] } as T;
    };
    await expect(analyzeDecodedMusic(decoder, request, {
      mode: 'full', concurrentModels: true, tagger: true, signal: controller.signal,
      onPartial: result => { partials.push(result); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await tagger;
    expect(partials.at(-1)?.recognition?.status).toBe('cancelled');
    expect(partials.every(result => !result.tagger && !result.notes.includes(TAGGER_UNAVAILABLE))).toBe(true);
  });
});

describe('shared tempo and key decoding', () => {
  it.each([3, 30, 60, 75, 180])('decodes each %s-second recording excerpt once and survives buffer transfers', async duration => {
    const { decoder } = fixture(duration);
    const seen: Record<string, Array<{ length: number; hash: string }>> = {};
    const request: MusicRequest = async <T>(message: Record<string, unknown>, transfer: Transferable[]) => {
      const kind = String(message.kind);
      if (kind === 'rhythm' || kind === 'tonal') {
        const { samples } = message.excerpts as { samples: Float32Array[] };
        seen[kind] = samples.map(sample => ({ length: sample.length,
          hash: createHash('sha256').update(new Uint8Array(sample.buffer, sample.byteOffset, sample.byteLength)).digest('hex') }));
        structuredClone(message, { transfer });
        expect(samples.every(sample => sample.byteLength === 0)).toBe(true);
        return { version: 2, durationSeconds: duration, analyzedSeconds: Math.min(60, duration), instruments: [], notes: [] } as T;
      }
      if (kind === 'instruments') return { scores: {}, musicScore: 0 } as T;
      return (kind === 'jamendo' ? {} : []) as T;
    };
    const result = await analyzeDecodedMusic(decoder, request, { mode: 'fast', concurrentModels: true });
    const reads = vi.mocked(decoder.read).mock.calls.filter(([, , rate]) => rate === 44100);
    expect(reads).toHaveLength(duration > 60 ? 3 : 1);
    expect(seen.tonal).toEqual(seen.rhythm);
    expect(seen.tonal.reduce((total, sample) => total + sample.length, 0)).toBeLessThanOrEqual(60 * 44100);
    expect(result.recognition?.jobs.filter(job => job.modelId === 'rhythm' || job.modelId === 'tonal')
      .every(job => job.status === 'complete')).toBe(true);
  });

  it('retries key decoding after an incomplete tempo decode without reusing partial excerpts', async () => {
    const { decoder } = fixture(75);
    const read = decoder.read;
    let reads = 0;
    vi.mocked(decoder.read).mockImplementation(async (start, seconds, rate) => {
      if (rate === 44100 && ++reads === 2) throw new Error('Decoder failed');
      return new Float32Array(Math.round(Math.max(0, Math.min(seconds, 75 - start)) * rate)).fill(.1);
    });
    const request: MusicRequest = async <T>(message: Record<string, unknown>) => {
      if (message.kind === 'instruments') return { scores: {}, musicScore: 0 } as T;
      if (message.kind === 'rhythm' || message.kind === 'tonal') return { version: 2, durationSeconds: 75, analyzedSeconds: 60, instruments: [], notes: [] } as T;
      return (message.kind === 'jamendo' ? {} : []) as T;
    };
    const result = await analyzeDecodedMusic(decoder, request, { mode: 'fast' });
    expect(vi.mocked(read).mock.calls.filter(([, , rate]) => rate === 44100)).toHaveLength(5);
    expect(result.recognition?.jobs.find(job => job.modelId === 'rhythm')).toMatchObject({ status: 'failed', successful: [] });
    expect(result.recognition?.jobs.find(job => job.modelId === 'tonal')).toMatchObject({ status: 'complete', successful: expect.any(Array) });
  });
});
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

describe('short one-shots', () => {
  async function profileMessages(duration: number) {
    const messages: Record<string, unknown>[] = [];
    const decoder: MusicDecoder = { durationSeconds: duration, close() {}, read: async (start, seconds, rate) =>
      new Float32Array(Math.round(Math.max(0, Math.min(seconds, duration - start)) * rate)).fill(.1) };
    const request: MusicRequest = async <T>(message: Record<string, unknown>) => {
      if (message.kind === 'profile') messages.push(message);
      if (message.kind === 'rhythm' || message.kind === 'tonal') return { version: 2, durationSeconds: duration, analyzedSeconds: duration, instruments: [], notes: [] } as T;
      if (message.kind === 'instruments') return { scores: {}, musicScore: 0 } as T;
      return (message.kind === 'jamendo' ? {} : []) as T;
    };
    await analyzeDecodedMusic(decoder, request, {});
    return messages;
  }
  it('sends a whole short clip unchanged at 16 kHz with its CLAP request, and nothing extra for longer audio', async () => {
    const [short] = await profileMessages(1.2);
    expect((short.samples as Float32Array).length).toBe(Math.round(1.2 * 48000));
    expect((short.samples16 as Float32Array).length).toBe(Math.round(1.2 * 16000));
    for (const message of await profileMessages(6)) expect(message.samples16).toBeUndefined();
  });
});

it('suggests an instrument that plays in only part of a long song', async () => {
  const duration = 240;
  // Each window's samples carry its start time, so the mock model can answer per section.
  const decoder: MusicDecoder = { durationSeconds: duration, close() {}, read: vi.fn(async (start, seconds, rate) =>
    new Float32Array(Math.round(Math.max(0, Math.min(seconds, duration - start)) * rate)).fill(.01 + start / 1000)) };
  const request: MusicRequest = async <T>(message: Record<string, unknown>) => {
    const start = Math.round(((message.samples as Float32Array)[0] - .01) * 1000);
    if (message.kind === 'rhythm' || message.kind === 'tonal') return { version: 2, durationSeconds: duration, analyzedSeconds: 60, instruments: [], notes: [] } as T;
    if (message.kind === 'instruments') return { scores: {}, musicScore: .9 } as T;
    if (message.kind === 'jamendo') return (start >= 100 && start < 120 ? { saxophone: .7, drums: .6 } : { drums: .6 }) as T;
    return [] as T;
  };
  const result = await analyzeDecodedMusic(decoder, request, { mode: 'full', audioFingerprint: 'part-time-sax' });
  expect(result.instruments.find(i => i.label === 'saxophone')).toMatchObject({ status: 'possible', score: .7 });
});

describe('one-shot windows inside long recordings', { timeout: 60_000 }, () => {
  // A 32 s recording with a loud burst every 6 s; the one-shot heads call every event window a vinyl scratch.
  async function run(mode?: 'fast' | 'full', heads: DescriptionScore[] = [{ group: 'dj-learned', label: 'vinyl scratch', score: .9, learnedGroup: 'production', decision: 'include', basis: 'head' }]) {
    const duration = 32, windows: Record<string, unknown>[] = [];
    const decoder: MusicDecoder = { durationSeconds: duration, close() {}, read: async (start, seconds, rate) => {
      const x = new Float32Array(Math.round(Math.max(0, Math.min(seconds, duration - start)) * rate));
      for (let i = 0; i < x.length; i++) { const t = start + i / rate; x[i] = (t % 6) > 3 && (t % 6) < 3.2 ? .5 * Math.sin(i * .3) : .002 * Math.sin(i * 12.9898); }
      return x;
    } };
    const request: MusicRequest = async <T>(message: Record<string, unknown>) => {
      if (message.kind === 'profile' && message.samples16) { windows.push(message); return heads as T; }
      if (message.kind === 'rhythm' || message.kind === 'tonal') return { version: 2, durationSeconds: duration, analyzedSeconds: duration, instruments: [], notes: [] } as T;
      if (message.kind === 'instruments') return { scores: {}, musicScore: 0 } as T;
      return (message.kind === 'jamendo' ? {} : []) as T;
    };
    return { result: await analyzeDecodedMusic(decoder, request, mode ? { mode } : {}), windows };
  }
  it('scores 2.05 s windows at sound starts and shows an agreed measured label as a maybe tag', async () => {
    const { result, windows } = await run();
    expect(windows.length).toBe(3);
    for (const w of windows) { expect((w.samples as Float32Array).length).toBe(Math.round(2.05 * 48000)); expect((w.samples16 as Float32Array).length).toBe(Math.round(2.05 * 16000)); }
    const tag = result.soundProfile?.djTags?.find(t => t.label === 'vinyl scratch');
    expect(tag).toMatchObject({ group: 'production', model: 'Trained head (maybe)' });
    expect(tag?.segments?.length).toBeGreaterThanOrEqual(2);
    expect(confidentSoundSummary(result).find(t => t.label === 'vinyl scratch')).toMatchObject({ maybe: true });
    const observations = result.recognition?.observations.filter(o => o.labelId === 'vinyl scratch') ?? [];
    expect(observations.length).toBeGreaterThanOrEqual(2);
    expect(observations.every(o => o.status === 'possible' && o.dimension === 'effect')).toBe(true);
    expect(result.recognition?.evidence.filter(e => e.labelId === 'vinyl scratch')).toEqual(
      expect.arrayContaining(observations.flatMap(o => o.evidenceIds.map(id => expect.objectContaining({ id, modelId: 'clap', labelId: 'vinyl scratch' })))));
    expect(sanitizeMusicAnalysis(result)?.recognition?.observations.filter(o => o.labelId === 'vinyl scratch')).toEqual(observations);
  });
  it('keeps 10 s results when the event pass fails and does not mark the run complete', async () => {
    const duration = 32;
    const decoder: MusicDecoder = { durationSeconds: duration, close() {}, read: async (start, seconds, rate) => {
      const x = new Float32Array(Math.round(Math.max(0, Math.min(seconds, duration - start)) * rate));
      for (let i = 0; i < x.length; i++) { const t = start + i / rate; x[i] = (t % 6) > 3 && (t % 6) < 3.2 ? .5 * Math.sin(i * .3) : .002 * Math.sin(i * 12.9898); }
      return x;
    } };
    const request: MusicRequest = async <T>(message: Record<string, unknown>) => {
      if (message.kind === 'profile' && message.samples16) throw new Error('one-shot failed');
      if (message.kind === 'rhythm' || message.kind === 'tonal') return { version: 2, durationSeconds: duration, analyzedSeconds: duration, instruments: [], notes: [] } as T;
      if (message.kind === 'instruments') return { scores: {}, musicScore: 0 } as T;
      return (message.kind === 'jamendo' ? {} : []) as T;
    };
    const result = await analyzeDecodedMusic(decoder, request, {});
    expect(result.recognition?.status).toBe('partial');
    expect(result.recognition?.jobs.find(j => j.modelId === 'clap')).toMatchObject({ status: 'partial', error: 'one-shot failed' });
    expect(result.recognition?.jobs.find(j => j.modelId === 'ast')?.status).toBe('complete');
    expect(result.instrumentScan?.complete).toBe(false);
    expect(result.notes).toContain('Event-window recognition was unavailable. Reanalyze to retry.');
    expect(result.soundProfile?.djTags?.some(t => t.label === 'vinyl scratch')).toBe(false);
  });
  it('shows no tag for labels the windows were not measured on, and skips Fast mode', async () => {
    const impact = await run('full', [{ group: 'dj-learned', label: 'impact', score: .99, learnedGroup: 'production', decision: 'include', basis: 'head' }]);
    expect(impact.result.soundProfile?.djTags?.some(t => t.label === 'impact')).toBe(false);
    expect((await run('fast')).windows).toEqual([]);
  });
});

describe('AST device choice', { timeout: 60_000 }, () => {
  // Every analysis asks for the graphics card; the worker falls back to q8 WASM where WebGPU is missing or fails.
  async function astMessages(duration: number, mode: 'fast' | 'full') {
    const sent: Record<string, unknown>[] = [];
    const decoder: MusicDecoder = { durationSeconds: duration, close() {}, read: async (start, seconds, rate) => new Float32Array(Math.round(Math.max(0, Math.min(seconds, duration - start)) * rate)).fill(.1) };
    const request: MusicRequest = async <T>(message: Record<string, unknown>) => {
      if (message.kind === 'instruments') { sent.push(message); return { scores: {}, musicScore: 0 } as T; }
      if (message.kind === 'rhythm' || message.kind === 'tonal') return { version: 2, durationSeconds: duration, analyzedSeconds: duration, instruments: [], notes: [] } as T;
      return (message.kind === 'jamendo' ? {} : []) as T;
    };
    await analyzeDecodedMusic(decoder, request, { mode, cache: new ResultCache() });
    return sent;
  }
  it('asks for the GPU in every mode, including full analyses the trained source classifier reads', async () => {
    for (const [duration, mode] of [[1.5, 'full'], [1.5, 'fast'], [30, 'fast'], [30, 'full']] as const) {
      const sent = await astMessages(duration, mode);
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.every(m => m.gpu === true)).toBe(true);
    }
  });
  it('records where the GPU was allowed in the AST job, so saved ledgers and cache keys tell the runs apart', async () => {
    const { createRecognition, refreshRuntimeIdentity } = await import('./recognition');
    const ast = (duration: number, mode: 'fast' | 'full') => createRecognition(duration, mode).jobs.find(j => j.modelId === 'ast')!.preprocessingVersion;
    expect(ast(1.5, 'full')).toContain(':webgpu-fp32-allowed');
    expect(ast(30, 'fast')).toContain(':webgpu-fp32-allowed');
    expect(ast(30, 'full')).toContain(':webgpu-fp32-allowed');
    const run = createRecognition(1.5, 'full'); refreshRuntimeIdentity(run, 1.5);
    expect(run.jobs.find(j => j.modelId === 'ast')!.preprocessingVersion).toContain(':webgpu-fp32-allowed');
  });
});
it('reads structure for whole tracks but skips it for recordings longer than 20 minutes', async () => {
  const track = await fixture(120, { mode: 'fast' }).run();
  expect(track.structure).toEqual({ revision: 1, sections: [], drops: [] });
  const set = fixture(21 * 60, { mode: 'fast' });
  const result = await set.run();
  expect(result.structure).toBeUndefined();
  // No 60 s whole-track structure chunks (the version print reads its own bounded 30 s sections).
  expect(vi.mocked(set.decoder.read).mock.calls.filter(([, seconds, rate]) => rate === 16000 && seconds === 60)).toEqual([]);
});
it('moves the Fast scan to the first drop, but keeps Full mode on its usual windows', { timeout: 60_000 }, async () => {
  // 30 s intro, drop at 30 s, breakdown, second drop at 105 s, outro.
  const audio = arrangement([
    { seconds: 30, kick: true, bass: false, pad: false }, { seconds: 45, kick: true, bass: true, pad: true },
    { seconds: 30, kick: false, bass: false, pad: true }, { seconds: 45, kick: true, bass: true, pad: true },
    { seconds: 20, kick: true, bass: false, pad: false },
  ]);
  const duration = audio.length / 16000;
  const run = (mode: 'fast' | 'full') => {
    const f = fixture(duration, { mode });
    vi.mocked(f.decoder.read).mockImplementation(async (start, seconds, rate) => rate === 16000
      ? audio.slice(Math.round(start * rate), Math.round(Math.min(duration, start + seconds) * rate))
      : new Float32Array(Math.round(Math.max(0, Math.min(seconds, duration - start)) * rate)).fill(.1));
    return f;
  };
  const fast = run('fast'), result = await fast.run(), drop = result.structure!.drops[0];
  expect(Math.abs(drop - 30)).toBeLessThan(1);
  const planned = (r: MusicAnalysis, id: string) => r.recognition!.jobs.find(j => j.modelId === id)!.planned.map(i => i.start);
  const starts = fastInstrumentStarts(duration);
  expect(planned(result, 'ast')).toEqual([starts[0], drop, starts[2]]);
  expect(planned(result, 'jamendo')).toEqual([drop]);
  expect(planned(result, 'clap')).toEqual([drop]);
  // The models actually listen there: 10 s at 16 kHz (AST, Jamendo) and at 48 kHz (CLAP).
  const reads = vi.mocked(fast.decoder.read).mock.calls;
  expect(reads.some(([start, seconds, rate]) => start === drop && Math.abs(seconds - 10) < 1e-6 && rate === 48000)).toBe(true);
  expect(reads.some(([start, seconds, rate]) => start === drop && Math.abs(seconds - 10) < 1e-6 && rate === 16000)).toBe(true);
  const full = await run('full').run();
  expect(planned(full, 'ast')).toEqual(instrumentWindowStarts(duration));
  expect(planned(full, 'jamendo')).toEqual(instrumentWindowStarts(duration));
  expect(planned(full, 'ast')).not.toContain(full.structure!.drops[0]);
});
it('drops the structure when a chunk decodes short, so mix points never shift', async () => {
  const f = fixture(150, { mode: 'fast' });
  const read = vi.mocked(f.decoder.read).getMockImplementation()!;
  vi.mocked(f.decoder.read).mockImplementation(async (start, seconds, rate) => start === 0 && seconds === 60 ? new Float32Array(30 * rate) : read(start, seconds, rate));
  const result = await f.run();
  expect(result.structure).toBeUndefined();
  expect(result.notes).toContain('Track structure was unavailable. Reanalyze to retry.');
});
