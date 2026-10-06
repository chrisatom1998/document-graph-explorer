import { describe, expect, it } from 'vitest';
import { FullMixEvidence, fullMixFeatures, sanitizeFullMixAnalysis, sanitizeFullMixModel, type FullMixModel } from './fullMixHeads';

const clap = (i: number) => Array.from({ length: 512 }, (_, k) => (k === i ? 3 : 0));
/** One head reading only CLAP dimension 0 (guitar), one reading only the AST score (voice). */
function model(top = 2): FullMixModel {
  const length = 512 + 1 + 1;
  const guitar = Array(length).fill(0); guitar[0] = 10;
  const voice = Array(length).fill(0); voice[512] = 1;
  return sanitizeFullMixModel({ version: 1, revision: 'test', inputs: { clap: 512, ast: ['voice'], jamendo: ['piano'] }, aggregation: { top },
    heads: [{ label: 'guitar', weights: guitar, bias: -5, threshold: 0.8 }, { label: 'voice', weights: voice, bias: 0, threshold: 0.5 }] })!;
}

describe('full-mix heads', () => {
  it('rejects malformed models', () => {
    expect(model()).toBeDefined();
    const ok = model();
    expect(sanitizeFullMixModel({ ...ok, heads: [{ ...ok.heads[0], weights: [1, 2] }] })).toBeUndefined();
    expect(sanitizeFullMixModel({ ...ok, heads: [{ ...ok.heads[0], threshold: 1 }] })).toBeUndefined();
    expect(sanitizeFullMixModel({ ...ok, inputs: { ...ok.inputs, clap: 256 } })).toBeUndefined();
    expect(sanitizeFullMixModel({ ...ok, aggregation: { top: 0 } })).toBeUndefined();
  });

  it('builds features only when all three models have scored the window', () => {
    const m = model();
    expect(fullMixFeatures(m, { ast: { voice: .5 }, clap: clap(0) })).toBeUndefined();
    const x = fullMixFeatures(m, { ast: { voice: .5 }, jamendo: {}, clap: clap(0) })!;
    expect(x[0]).toBeCloseTo(1);            // unit-length CLAP
    expect(x[512]).toBeCloseTo(0);          // logit(0.5)
    expect(x[513]).toBeLessThan(-13);       // a missing Jamendo class counts as a zero score
  });

  it('scores whole windows, in any arrival order, and votes over the top windows', () => {
    const evidence = new FullMixEvidence(model(2));
    // Three windows: guitar strong in two, voice weak everywhere.
    for (const [start, i] of [[0, 0], [5, 0], [10, 1]] as const) {
      evidence.add(start, start + 10, { clap: clap(i) });
      evidence.add(start, start + 10, { jamendo: {} });
      evidence.add(start, start + 10, { ast: { voice: .1 } });
    }
    evidence.add(20, 26, { clap: clap(0), jamendo: {}, ast: { voice: .99 } });   // a short tail window is never scored
    const result = evidence.results()!;
    expect(result.windows).toBe(3);
    expect(result.labels.map(l => l.label)).toEqual(['guitar']);
    expect(result.labels[0].score).toBeGreaterThanOrEqual(.5);
    expect(result.labels[0].segments).toEqual([{ start: 0, end: 10 }, { start: 5, end: 15 }]);
  });

  it('needs more than one confident window when voting over two', () => {
    const evidence = new FullMixEvidence(model(2));
    evidence.add(0, 10, { clap: clap(0), jamendo: {}, ast: {} });
    evidence.add(5, 15, { clap: clap(1), jamendo: {}, ast: {} });
    expect(evidence.results()!.labels).toEqual([]);
    const single = new FullMixEvidence(model(1));
    single.add(0, 10, { clap: clap(0), jamendo: {}, ast: {} });
    single.add(5, 15, { clap: clap(1), jamendo: {}, ast: {} });
    expect(single.results()!.labels.map(l => l.label)).toEqual(['guitar']);
  });

  it('sanitizes stored results', () => {
    expect(sanitizeFullMixAnalysis({ revision: 'r', windows: 2, labels: [{ label: 'guitar', score: .7, segments: [{ start: 0, end: 10 }, { start: 5, end: 99 }] }, { label: 'x', score: 2, segments: [] }] }, 20))
      .toEqual({ revision: 'r', windows: 2, labels: [{ label: 'guitar', score: .7, segments: [{ start: 0, end: 10 }] }] });
    expect(sanitizeFullMixAnalysis({ revision: 'r', windows: 0, labels: [] }, 20)).toBeUndefined();
  });
});
