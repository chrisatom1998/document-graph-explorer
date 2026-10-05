import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeDecodedMusic, fusionClapDescriptions, type MusicRequest } from './analyzeDecodedMusic';
import { descriptionScores } from './profileDescriptions';
import { FUSION_LABELS, MAX_FUSION_WINDOWS, sanitizeFusion, type FusionDecision, type FusionScorer } from './fusion';
import { ResultCache } from './recognition';
import { sanitizeMusicAnalysis } from './musicTypes';
const identity = { modelSha256: 'a'.repeat(64), policySha256: 'b'.repeat(64), scorerSha256: 'c'.repeat(64) };
const decisions = (): FusionDecision[] => FUSION_LABELS.map(label => ({ label, state: 'uncertain', source: 'learned-head', headProbability: .5, decisionProbability: .5, eligible: true, positiveGroups: 12, negativeGroups: 13 }));
function fixture(duration = 20, config: { silent?: boolean; fail?: string; mode?: 'fast' | 'full'; cache?: ResultCache; scorer?: FusionScorer } = {}) {
  const calls: string[] = [];
  const decoder = { durationSeconds: duration, close() {}, read: async (_start: number, seconds: number, rate: number) => new Float32Array(Math.round(seconds*rate)).fill(config.silent ? 0 : .1) };
  const request: MusicRequest = async <T>(message: Record<string, unknown>) => {
    const kind = String(message.kind); calls.push(kind);
    if (kind === config.fail) throw new Error('fixture failure');
    return (kind === 'instruments' ? { scores: { piano: .9 }, musicScore: .9 } : kind === 'jamendo' ? { piano: .8 } : kind === 'profile' ? [{ group: 'source', label: 'piano', score: .7 }] : { notes: [] }) as T;
  };
  const score = vi.fn(async () => decisions());
  const scorer: FusionScorer = config.scorer ?? { identity, score };
  return { calls, score, run: (fusion = true) => analyzeDecodedMusic(decoder, request, { mode: config.mode, audioFingerprint: 'input', cache: config.cache, ...(fusion ? { fusion: scorer } : {}) }) };
}
describe('optional per-window fusion foundation', () => {
  it('hands the scorer exactly the frozen CLAP catalog, even after new tagging prompts are added', () => {
    const prompts = JSON.parse(readFileSync('public/sound-model/prompts.json', 'utf8'));
    const { clapDescriptionOrder } = JSON.parse(readFileSync('public/fusion-model/model.json', 'utf8'));
    const scores = descriptionScores(prompts[0].vector, prompts);
    expect(scores).toHaveLength(prompts.length);
    const sent = fusionClapDescriptions([...scores, { group: 'dj-learned', label: 'kick', score: .9 }]);
    expect(sent.map(d => [d.group, d.label, d.alternative ?? null, d.learnedGroup ?? null, d.decision ?? null])).toEqual(clapDescriptionOrder);
  });
  it('keeps default scheduling and five native jobs unchanged', async () => {
    const f = fixture(); const result = await f.run(false);
    expect(f.calls).toEqual(['jamendo','rhythm','tonal','instruments','instruments','instruments','jamendo','jamendo','profile','profile','profile']);
    expect(result.fusion).toBeUndefined(); expect(result.recognition?.jobs).toHaveLength(5);
  });
  it('joins exact windows, scores before the next window, and preserves native results', async () => {
    const baseline = await fixture().run(false); const f = fixture(); const r = await f.run();
    expect(f.calls).toEqual(['rhythm','tonal',...Array(3).fill(['instruments','jamendo','profile']).flat()]);
    expect(f.score).toHaveBeenCalledTimes(3);
    expect(r.fusion?.counts).toEqual({ complete: 3, failed: 0, unsupported: 0, empty: 0 });
    expect(r.fusion?.windows.map(w => [w.start,w.end])).toEqual([[0,10],[5,15],[10,20]]);
    expect(r.instruments).toEqual(baseline.instruments); expect(r.soundProfile).toEqual(baseline.soundProfile);
    expect(r.recognition?.jobs).toEqual(baseline.recognition?.jobs);
    expect(sanitizeMusicAnalysis(r)?.fusion).toEqual(r.fusion);
  });
  it('reuses native cache but always reruns supplied scorer and sends bound native identities', async () => {
    const cache = new ResultCache(128); await fixture(20,{ cache }).run();
    let observed: Parameters<FusionScorer['score']>[0] | undefined;
    const f = fixture(20,{ cache, scorer: { identity, score: async input => { observed = input; return decisions(); } } });
    await f.run(); expect(f.calls).toEqual(['rhythm','tonal']);
    expect(observed?.native).toHaveLength(3);
    expect(observed?.native.every(n => n.cacheHit && n.cacheKey.includes('input') && n.weightsVersion && n.preprocessingVersion)).toBe(true);
    expect(observed?.raw.ast.instruments.piano).toBe(.9);
  });
  it.each(['profile','instruments','jamendo'])('records model failure (%s) as unavailable, never negative', async fail => {
    const f = fixture(20,{fail}); const r = await f.run();
    expect(f.score).not.toHaveBeenCalled(); expect(r.fusion?.counts.failed).toBe(3);
    expect(r.fusion?.windows.every(w => w.decisions.length === 20 && w.decisions.every(d => d.state === 'unavailable'))).toBe(true);
  });
  it('records silence and unsupported short input explicitly', async () => {
    const silent = fixture(10,{silent:true}); const r = await silent.run();
    expect(r.fusion?.counts.empty).toBe(1); expect(silent.score).not.toHaveBeenCalled();
    const short = fixture(1); expect((await short.run()).fusion?.counts.unsupported).toBe(1); expect(short.score).not.toHaveBeenCalled();
  });
  it('scores only actual fast-mode intersections and lists unmatched native windows', async () => {
    const f = fixture(75,{mode:'fast'}); const r = await f.run();
    expect(r.fusion?.counts).toEqual({ complete: 1, unsupported: 2, empty: 0, failed: 0 }); expect(f.score).toHaveBeenCalledTimes(1);
  });
  it('isolates malformed scorer output from native results and cache', async () => {
    const f = fixture(10,{scorer:{identity,score:async input => { input.raw.ast.instruments.piano = 0; return []; }}});
    const r = await f.run(); expect(r.fusion?.counts.failed).toBe(1); expect(r.instruments.find(i=>i.label==='piano')?.score).toBeGreaterThan(0);
  });
  it('rejects malformed imported states, claimed validation, counts, and excessive detail', async () => {
    const r = await fixture(10).run(); const f = r.fusion!;
    for (const mutated of [{...f,validation:'heldout-passed'}, {...f,planned:0}, {...f,omittedWindows:1}, {...f,windows:Array(MAX_FUSION_WINDOWS+1).fill(f.windows[0])}, {...f,windows:[{...f.windows[0], decisions:decisions().slice(1)}]}]) expect(sanitizeFusion(mutated,10)).toBeUndefined();
    expect(sanitizeFusion({...f, identity:{...identity, scorerSha256:'x'}},10)).toBeUndefined();
  });
});

it('records cancellation as unfinished windows and never manufactures negatives', async () => {
  const controller = new AbortController(); let partial: import('./musicTypes').MusicAnalysis | undefined;
  const decoder = { durationSeconds: 10, close() {}, read: async (_s:number, seconds:number, rate:number) => new Float32Array(seconds*rate).fill(.1) };
  const request: MusicRequest = async <T>() => ({ notes: [] }) as T;
  await expect(analyzeDecodedMusic(decoder, request, { signal: controller.signal, fusion:{identity,score:async()=>decisions()}, onPartial:p=>{partial=p; controller.abort();} })).rejects.toMatchObject({name:'AbortError'});
  expect(partial?.fusion).toMatchObject({planned:1,windows:[],counts:{complete:0,failed:0,unsupported:0,empty:0}});
  expect(partial?.recognition?.status).toBe('cancelled');
});

it('preserves exact total counts when persisted detail is deliberately bounded', async () => {
  const one = (await fixture(10).run()).fusion!;
  const windows = Array.from({length:MAX_FUSION_WINDOWS}, (_,i)=>({...one.windows[0],start:i*5,end:i*5+10}));
  const bounded = {...one,planned:MAX_FUSION_WINDOWS+1,counts:{...one.counts,complete:MAX_FUSION_WINDOWS+1},windows,omittedWindows:1};
  expect(sanitizeFusion(bounded,3000)).toEqual(bounded);
  expect(sanitizeFusion({...bounded,counts:{...bounded.counts,complete:1}},3000)).toBeUndefined();
});
