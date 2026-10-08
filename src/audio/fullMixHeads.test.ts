import { describe, expect, it, vi } from 'vitest';
import { FullMixEvidence, fullMixFeatures, sanitizeFullMixAnalysis, sanitizeFullMixModel, type FullMixModel } from './fullMixHeads';
import { NATIVE_WINDOW_EVIDENCE_LIMIT } from './nativeWindowEvidence';

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
    expect(result.labels[0].windowEvidence).toMatchObject({ complete: true, aggregation: { top: 2, threshold: .8 } });
    expect(result.labels[0].windowEvidence!.windows).toHaveLength(3);
    expect(result.labels[0].windowEvidence!.windows[2]).toMatchObject({ start: 10, end: 20, score: expect.any(Number) });
    expect(result.labels[0].windowEvidence!.windows[2].score).toBeLessThan(.8);
    expect(sanitizeFullMixAnalysis(result, 20)).toEqual(result);
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
      .toEqual({ revision: 'r', windows: 2, labels: [{ label: 'guitar', score: .7, segments: [{ start: 0, end: 10 }] }], decides: [] });
    expect(sanitizeFullMixAnalysis({ revision: 'r', windows: 0, labels: [] }, 20)).toBeUndefined();
  });
  it('bounds saved window probabilities and records that the remaining windows were omitted', () => {
    const evidence = new FullMixEvidence(model());
    for (let i = 0; i <= NATIVE_WINDOW_EVIDENCE_LIMIT; i++) evidence.add(i * 5, i * 5 + 10, { clap: clap(0), jamendo: {}, ast: {} });
    const result = evidence.results()!;
    expect(result.labels[0].windowEvidence!.windows).toHaveLength(NATIVE_WINDOW_EVIDENCE_LIMIT);
    expect(result.labels[0].windowEvidence!.complete).toBe(false);
    expect(sanitizeFullMixAnalysis(result, 1000)).toEqual(result);
  });
  it('does not trust incomplete or untyped probability provenance as a complete head score', () => {
    const label = { label: 'guitar', score: .9, segments: [], windowEvidence: { windows: [{ start: 0, end: 10, score: .9 }], complete: true, aggregation: { top: 2, threshold: .8 } } };
    const result = sanitizeFullMixAnalysis({ revision: 'r', windows: 2, labels: [label] }, 20)!;
    expect(result.labels[0].windowEvidence!.complete).toBe(false);
    const untyped = sanitizeFullMixAnalysis({ revision: 'r', windows: 1, labels: [{ ...label, windowEvidence: { windows: label.windowEvidence.windows, complete: true } }] }, 20)!;
    expect(untyped.labels[0].windowEvidence).toBeUndefined();
  });
});

describe('pinned full-mix heads', () => {
  it('ships a valid model whose revision and hash match the source pins', async () => {
    const { readFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const { FULL_MIX_REVISION, FULL_MIX_FILE } = await import('./fullMixHeads');
    const bytes = readFileSync(new URL(`../../public/sound-model/${FULL_MIX_FILE}`, import.meta.url));
    const manifest = JSON.parse(readFileSync(new URL('../../public/sound-model/manifest.json', import.meta.url), 'utf8'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256[FULL_MIX_FILE]);
    const model = sanitizeFullMixModel(JSON.parse(bytes.toString('utf8')))!;
    expect(model.revision).toBe(FULL_MIX_REVISION);
    expect(model.heads.map(h => h.label).sort()).toEqual(['bass', 'cymbals', 'drums', 'guitar', 'organ', 'piano', 'saxophone', 'synthesizer', 'trumpet', 'voice']);
    expect(model.heads.filter(h => h.replaces).map(h => h.label)).toEqual(['bass']);
  });
});

describe('loading the full-mix heads', () => {
  it('retries after a failed fetch instead of keeping the failure', async () => {
    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync(new URL('../../public/sound-model/full-mix.json', import.meta.url));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes)));
    vi.stubGlobal('fetch', fetchMock);
    try {
      vi.resetModules();
      const { loadFullMixHeads } = await import('./fullMixHeads');
      expect(await loadFullMixHeads()).toBeUndefined();
      await Promise.resolve();
      expect((await loadFullMixHeads())?.heads.length).toBe(10);
      expect(await loadFullMixHeads()).toBeDefined();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });
});
