import { describe, it, expect, vi } from 'vitest';
import { prepareExperimentalPaSST, experimentalPaSSTEnabled } from './index';
import { FUSION_LABELS, type FusionScorer, type FusionAnalysis } from '../fusion';
import { fusionPresentation } from '../fusionPresentation';
import { PASST_POLICY } from './identity';
const input = { interval: { start: 0, end: 10 }, raw: { ast: { instruments: {} }, jamendo: {}, clap: { descriptions: [] } }, native: [] };
function fixtures() {
 const identity = { modelSha256: 'a'.repeat(64), policySha256: 'b'.repeat(64), scorerSha256: 'c'.repeat(64) };
 const decisions = FUSION_LABELS.map(label => ({ label, state: 'negative' as const, headProbability: .2, decisionProbability: null, source: 'guarded-binary-baseline' as const, eligible: false, positiveGroups: 0, negativeGroups: 0 }));
 const baseline: FusionScorer = { identity, score: vi.fn(async () => structuredClone(decisions)) };
 const decoder = { durationSeconds: 10, read: vi.fn(async () => new Float32Array(320000)), close: vi.fn() };
 const analysis = (scorer: FusionScorer, d = decisions): FusionAnalysis => ({ version: 1, scope: 'window', validation: 'unvalidated', identity: scorer.identity, planned: 1, counts: { complete: 1, failed: 0, unsupported: 0, empty: 0 }, omittedWindows: 0, windows: [{ start: 0, end: 10, status: 'complete', decisions: d }] });
 return { baseline, decisions, decoder, analysis };
}
describe('provisional PaSST routing and fallback', () => {
 it('defaults off without reading audio, fetching or loading a model', async () => {
  expect(experimentalPaSSTEnabled()).toBe(false); const f=fixtures(), predict=vi.fn();
  const prepared=prepareExperimentalPaSST({...f,predict});expect(prepared.scorer).toBe(f.baseline);await prepared.scorer.score(input);expect(f.decoder.read).not.toHaveBeenCalled();expect(predict).not.toHaveBeenCalled();
 });
 it('routes only the four measured gains and never qualifies experimental GUI positives', async () => {
  const f=fixtures(), predict=vi.fn(async()=>Array(20).fill(1));const p=prepareExperimentalPaSST({...f,enabled:true,predict});const d=await p.scorer.score(input);
  expect(d.filter((v,i)=>JSON.stringify(v)!==JSON.stringify(f.decisions[i])).map(v=>v.label)).toEqual(['bass','clarinet','organ','piano']);expect(Object.entries(PASST_POLICY).filter(([,v])=>v.enabled).map(([k])=>k)).toEqual(['bass','clarinet','organ','piano']);
  const a=f.analysis(p.scorer);a.windows[0].decisions=d;expect(fusionPresentation(a,10,'full')).toMatchObject({qualified:false,positive:[]});expect(p.usedFallback()).toBe(false);
 });
 it.each(['throw','malformed','incomplete'])('retains all exact baseline decisions on %s, then restores its identity', async mode => {
  const f=fixtures();if(mode==='incomplete')f.decoder.read.mockResolvedValue(new Float32Array(100));const predict=vi.fn(async()=>{if(mode==='throw')throw Error('Missing model / SHA mismatch / runtime unavailable');return [NaN];});const p=prepareExperimentalPaSST({...f,enabled:true,predict});
  expect(await p.scorer.score(input)).toEqual(f.decisions);expect(p.usedFallback()).toBe(true);const restored=p.restore(f.analysis(p.scorer));expect(restored?.identity).toEqual(f.baseline.identity);expect(restored?.windows[0].decisions).toEqual(f.decisions);expect(restored?.validation).toBe('unvalidated');await p.scorer.score(input);expect(f.decoder.read).toHaveBeenCalledTimes(1);
 });
 it('propagates cancellation without turning it into successful baseline output', async () => {
  const f=fixtures(), p=prepareExperimentalPaSST({...f,enabled:true,predict:vi.fn()});await expect(p.scorer.score(input,AbortSignal.abort())).rejects.toThrow();expect(f.baseline.score).not.toHaveBeenCalled();expect(p.usedFallback()).toBe(false);
 });
});
