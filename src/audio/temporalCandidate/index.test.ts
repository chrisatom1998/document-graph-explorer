import { describe, expect, it, vi } from 'vitest';
import { FUSION_LABELS, type FusionAnalysis } from '../fusion';
import { fusionPresentation } from '../fusionPresentation';
import { releaseForScorer } from '../fusionRelease';
import { TEMPORAL_FEATURE_NAMES } from './temporalFeatures';
import { createExperimentalTemporalScorer, EXPERIMENTAL_TEMPORAL_CANDIDATE_ENABLED, sha256 } from './index';
const hash = 'a'.repeat(64), ast = Array.from({ length: 67 }, (_, i) => 'ast' + String(i).padStart(2, '0')), jamendo = Array.from({ length: 40 }, (_, i) => 'jam' + String(i).padStart(2, '0'));
const descriptions = Array.from({ length: 512 }, (_, i) => ({ group: 'source' as const, label: 'probe' + i, score: 0 }));
function artifact() {
  const family = 'full_native_no_jamendo_plus_dsp';
  return { featureNames: { [family]: [...ast.map(k => 'astLogit:' + k), ...descriptions.map((_, i) => 'clapScore:' + i), ...TEMPORAL_FEATURE_NAMES.map(n => 'dsp:' + n)] }, canonicalAstOrder: ast, jamendoOrder: jamendo, clapDescriptionOrder: descriptions.map(d => [d.group, d.label, null, null, null]),
    models: Object.fromEntries(FUSION_LABELS.map(label => [label, { configuration: { family, head: 'logistic' }, threshold: .5, parameters: { weights: Array(712).fill(0), bias: 2 }, positiveGroups: 1, negativeGroups: 1 }])) };
}
const decoder = () => ({ durationSeconds: 10, read: vi.fn(async () => new Float32Array(160000)), close: vi.fn() });
const input = () => ({ interval: { start: 0, end: 10 }, raw: { ast: { instruments: Object.fromEntries(ast.map(k => [k, .5])) }, jamendo: Object.fromEntries(jamendo.map(k => [k, .5])), clap: { descriptions: structuredClone(descriptions) } }, native: [] });
describe('disabled temporal experiment boundary', () => {
  it('does no work when omitted or explicitly disabled', async () => {
    expect(EXPERIMENTAL_TEMPORAL_CANDIDATE_ENABLED).toBe(false);
    const d = decoder(), options = { decoder: d, modelBytes: new Uint8Array(), expectedModelSha256: '', protocolSha256: '', scorerSha256: '' };
    expect(await createExperimentalTemporalScorer(options)).toBeUndefined();
    expect(await createExperimentalTemporalScorer({ ...options, enabled: false })).toBeUndefined(); expect(d.read).not.toHaveBeenCalled();
  });
  it('requires independently pinned bytes and never installs or activates GUI suggestions', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(artifact())), modelHash = await sha256(bytes), d = decoder();
    const options = { enabled: true, decoder: d, modelBytes: bytes, expectedModelSha256: modelHash, protocolSha256: hash, scorerSha256: hash };
    await expect(createExperimentalTemporalScorer({ ...options, expectedModelSha256: hash })).rejects.toThrow('bytes changed');
    const scorer = (await createExperimentalTemporalScorer(options))!;
    const decisions = await scorer.score(input()); expect(decisions.every(v => v.state === 'positive')).toBe(true); expect(releaseForScorer(scorer)).toBeUndefined();
    const analysis: FusionAnalysis = { version: 1, scope: 'window', validation: 'unvalidated', identity: scorer.identity, planned: 1, counts: { complete: 1, failed: 0, unsupported: 0, empty: 0 }, omittedWindows: 0, windows: [{ start: 0, end: 10, status: 'complete', decisions }] };
    expect(fusionPresentation(analysis, 10, 'full')).toMatchObject({ qualified: false, positive: [] });
    const malformed = input(); malformed.raw.clap.descriptions.reverse(); await expect(scorer.score(malformed)).rejects.toThrow('Descriptor order');
    const signal = AbortSignal.abort(); await expect(scorer.score(input(), signal)).rejects.toThrow();
  });
});
