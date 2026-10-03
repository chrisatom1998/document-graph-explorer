import { describe, expect, it } from 'vitest';
import { fingerprint } from './fingerprint';
import { auditPresetCoverage, hashPcm, importReferenceLibrary, sha256, validateReferenceManifest, type ImportedReference, type ReferenceRecord } from './referenceLibrary';
import { matchSource, type Candidate, type RejectionPolicy } from './matching';
import { calibrateRejection, evaluateSourceRetrieval, validateSourceEvaluation, type SourceEvaluationManifest } from './evaluation';

const digest = 'a'.repeat(64);
function record(id = 'control', kind: ReferenceRecord['kind'] = 'synthetic-control'): ReferenceRecord {
  return { id, familyId: id, kind, asset: { uri: `${id}.wav`, sha256: digest }, rights: { basis: 'generated test control', localAnalysisAllowed: true },
    identity: kind === 'preset-render' ? { synth: 'TEST ONLY', version: '0', bank: 'test fixture', preset: id } : null,
    render: kind === 'original-sample' ? null : { midiNote: 60, velocity: 85, heldSeconds: 1, releaseSeconds: 0.5, sampleRate: 8192, channels: 1, synthSettings: 'generated test waveform', effects: { mode: 'bypassed', settings: 'none' } },
    provenance: { method: kind === 'synthetic-control' ? 'synthetic-generator' : 'render-log', evidenceUri: 'test-fixture://generator', artifactSha256: digest, reviewer: 'test', reviewedAt: '2026-10-03T00:00:00Z' } };
}
/** Algorithm controls, not vendor/preset recordings. Independent pitch and duration changes. */
function control(pitch = 0, speed = 1, crop = 0, duration = 1.5, flavor = 0) {
  const rate = 8192;
  const data = Float32Array.from({ length: Math.floor(duration * rate / speed) }, (_, i) => {
    const time = crop + i / rate * speed; const ratio = 2 ** (pitch / 12);
    const frequency = [256, 384, 320][Math.min(2, Math.floor(time / 0.5))];
    const phase = 2 * Math.PI * frequency * ratio * i / rate;
    const envelope = 0.25 * (0.65 + 0.35 * Math.cos(2 * Math.PI * 2 * time));
    return envelope * (flavor === 0 ? Math.sin(phase) + 0.35 * Math.sin(phase * 2) : Math.sin(phase * 1.37) + 0.7 * Math.sin(phase * 3.17));
  });
  return { sampleRate: rate, channels: [data] };
}
function candidate(id: string, audio = control(), trust: ImportedReference['trust'] = 'synthetic'): Candidate {
  return { reference: { record: record(id, trust === 'verified' ? 'preset-render' : 'synthetic-control'), trust }, fingerprint: fingerprint(audio) };
}
const policy: RejectionPolicy = { calibrationId: 'synthetic-test-only', minScore: 0.8, minFamilyMargin: 0.01, minCoverage: 0.9, minFrames: 8 };

describe('source matching provenance and exact artifacts', () => {
  it('validates complete references, rejecting hints and missing FX/releases/rights', () => {
    const r = record('vendor-name-in-filename', 'preset-render');
    expect(validateReferenceManifest({ version: 1, libraryId: 'test', records: [r] })).toEqual([]);
    for (const patch of [{ identity: null }, { render: { ...r.render, releaseSeconds: undefined } }, { rights: { basis: 'filename', localAnalysisAllowed: false } }, { provenance: { ...r.provenance, artifactSha256: 'b'.repeat(64) } }]) {
      expect(validateReferenceManifest({ version: 1, libraryId: 'test', records: [{ ...r, ...patch }] }).length).toBeGreaterThan(0);
    }
  });
  it('reports render-library coverage and rejects inconsistent family identities', () => {
    const r = record('preset', 'preset-render');
    expect(auditPresetCoverage([{ record: r, trust: 'verified' }])[0]).toMatchObject({ readyForCalibration: false, pitches: [60], velocities: [85] });
    const refs: ImportedReference[] = [];
    for (const note of [48, 60]) for (const velocity of [60, 100]) for (const heldSeconds of [0.5, 2]) for (const mode of ['factory', 'bypassed'] as const) {
      const variation = structuredClone(r); variation.id = `${note}-${velocity}-${heldSeconds}-${mode}`;
      Object.assign(variation.render!, { midiNote: note, velocity, heldSeconds }); variation.render!.effects.mode = mode;
      refs.push({ record: variation, trust: 'verified' });
    }
    expect(auditPresetCoverage(refs)[0].readyForCalibration).toBe(true);
    const wrong = structuredClone(r); wrong.id = 'wrong'; wrong.identity!.preset = 'different';
    expect(validateReferenceManifest({ version: 1, libraryId: 'test', records: [r, wrong] }).join(' ')).toContain('inconsistent identity');
  });
  it('rejects duplicate ids and synthetic vendor identity', () => {
    const r = record();
    expect(validateReferenceManifest({ version: 1, libraryId: 'test', records: [r, r] }).join(' ')).toContain('unique');
    expect(validateReferenceManifest({ version: 1, libraryId: 'test', records: [{ ...r, identity: { synth: 'guess' } }] }).join(' ')).toContain('only preset');
  });
  it('checks bytes and leaves declarations unverified without an evidence verifier', async () => {
    const bytes = Uint8Array.of(1, 2, 3); const hash = await sha256(bytes); const r = record('preset', 'preset-render');
    r.asset.sha256 = hash; r.provenance.artifactSha256 = hash;
    const manifest = { version: 1, libraryId: 'test', records: [r] };
    expect((await importReferenceLibrary(manifest, async () => bytes))[0].trust).toBe('declared');
    expect((await importReferenceLibrary(manifest, async () => bytes, async () => true))[0].trust).toBe('verified');
    r.provenance.method = 'user-attestation';
    expect((await importReferenceLibrary(manifest, async () => bytes, async () => true))[0].trust).toBe('declared');
    await expect(importReferenceLibrary(manifest, async () => Uint8Array.of(0))).rejects.toThrow('hash mismatch');
  });
  it('uses standard SHA-256 and rate/channel sensitive PCM identity', async () => {
    expect(await sha256(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const channel = Float32Array.of(0, 0.5, -0.1);
    const hash = await hashPcm(8192, [channel]);
    expect(await hashPcm(8192, [channel.slice()])).toBe(hash);
    expect(await hashPcm(16384, [channel])).not.toBe(hash);
    expect(await hashPcm(8192, [channel, channel])).not.toBe(hash);
    await expect(hashPcm(8192, [Float32Array.of(NaN)])).rejects.toThrow('invalid');
  });
  it('requires verified matching provenance for exact origin and exposes hash conflicts', () => {
    const c = candidate('fixture', control(), 'verified');
    expect(matchSource(c.fingerprint, [c], {}, { fileSha256: digest }).decision).toBe('verified-origin');
    c.reference.trust = 'declared';
    expect(matchSource(c.fingerprint, [c], {}, { fileSha256: digest }).decision).toBe('resemblance');
    c.reference.trust = 'verified';
    expect(matchSource(c.fingerprint, [c, candidate('conflicting', control(), 'verified')], {}, { fileSha256: digest }).decision).toBe('resemblance');
    c.processing = { description: 'distortion', parentReferenceId: 'fixture' };
    expect(matchSource(c.fingerprint, [c], {}, { fileSha256: digest }).decision).not.toBe('verified-origin');
    expect(matchSource(c.fingerprint, [c], {}, { fileSha256: digest }).exact).toBeNull();
  });
  it('supports exact decoded PCM as a separate evidence basis', () => {
    const c = candidate('control'); c.pcmSha256 = 'b'.repeat(64);
    expect(matchSource(c.fingerprint, [c], {}, { pcmSha256: c.pcmSha256 }).exact?.basis).toBe('pcm-sha256');
    expect(matchSource(c.fingerprint, [c], {}, { pcmSha256: c.pcmSha256 }).decision).toBe('resemblance');
  });
});

describe('bounded robust DSP retrieval using synthetic controls', () => {
  const source = candidate('source'); const other = candidate('distractor', control(0, 1, 0, 1.5, 1));
  it.each([{ pitch: 0, speed: 1, crop: 0 }, { pitch: 5, speed: 1, crop: 0 }, { pitch: 0, speed: 1.25, crop: 0 }, { pitch: 0, speed: 1, crop: 0.256 }, { pitch: -3, speed: 1.25, crop: 0.256 }])('retrieves pitch/time/crop control %j', ({ pitch, speed, crop }) => {
    const result = matchSource(fingerprint(control(pitch, speed, crop, 1.5 - crop)), [other, source], { pitchSemitones: [pitch], timeScales: [speed] });
    expect(result.ranked[0].referenceId).toBe('source');
    expect(result.ranked[0].components.spectral).toBeGreaterThan(0.8);
    expect(result.ranked[0].alignment.pitchSemitones).toBe(pitch);
    expect(result.ranked[0].alignment.referenceSecondsPerQuerySecond).toBe(speed);
    expect(result.ranked[0].alignment.referenceOffsetSeconds).toBeCloseTo(crop, 1);
    expect(result.decision).toBe('resemblance');
  });
  it('rejects silence and insufficient clips, bounding invalid data/search', () => {
    const silence = fingerprint({ sampleRate: 8192, channels: [new Float32Array(8192)] });
    expect(matchSource(silence, [source], { policy }).decision).toBe('unknown');
    expect(() => fingerprint({ sampleRate: 8192, channels: [Float32Array.of(1)] })).toThrow('0.25');
    expect(() => fingerprint({ sampleRate: 8192, channels: [new Float32Array(8192 * 21)] })).toThrow('20 seconds');
    expect(() => fingerprint({ sampleRate: 8192, channels: [Float32Array.of(NaN)] })).toThrow('invalid');
    expect(() => matchSource(source.fingerprint, [source], { timeScales: [0] })).toThrow('bounded');
    expect(() => matchSource({ ...source.fingerprint, envelope: Float32Array.of(NaN) }, [source])).toThrow('fingerprint');
  });
  it('rejects ambiguous cross-family matches and requires explicit calibration', () => {
    expect(matchSource(source.fingerprint, [source]).decision).toBe('resemblance');
    expect(matchSource(source.fingerprint, [source, candidate('twin')], { policy }).decision).toBe('unknown');
    expect(() => matchSource(source.fingerprint, [source], { policy: { ...policy, calibrationId: '' } })).toThrow('calibration');
  });
  it('reports closest verified preset without converting spectral similarity into origin', () => {
    const c = candidate('TEST ONLY', control(), 'verified');
    const result = matchSource(c.fingerprint, [c, other], { policy });
    expect(result.decision).toBe('closest-reference-preset');
    c.processing = { description: 'user-supplied candidate render with EQ', parentReferenceId: c.reference.record.id };
    expect(matchSource(c.fingerprint, [c], { policy }).ranked[0].processing?.description).toContain('EQ');
    expect(matchSource(c.fingerprint, [c], { policy }).decision).not.toBe('verified-origin');
  });
  it('compares caller-rendered processed variants without claiming de-effecting', () => {
    const raw = control();
    const processed = { ...raw, channels: raw.channels.map(c => Float32Array.from(c, v => Math.tanh(v * 8))) };
    const variant = candidate('source-distorted', processed);
    variant.reference.record.familyId = source.reference.record.familyId;
    variant.processing = { description: 'synthetic tanh distortion, drive 8', parentReferenceId: source.reference.record.id };
    const result = matchSource(fingerprint(processed), [other, source, variant]);
    expect(result.ranked[0].referenceId).toBe('source-distorted');
    expect(result.ranked[0].processing?.description).toContain('distortion');
    expect(result.decision).toBe('resemblance');
  });
  it('keeps score finite and bounded when stereo/envelope/modulation disagree', () => {
    const pcm = control(); const data = pcm.channels[0];
    const stereo = fingerprint({ sampleRate: 8192, channels: [data, Float32Array.from(data, v => v * 0.5)] });
    const result = matchSource(stereo, [source]);
    expect(result.ranked[0].score).toBeGreaterThan(0);
    expect(result.ranked[0].score).toBeLessThanOrEqual(1);
    expect(result.ranked[0].components.stereo).toBeLessThan(1);
  });
});

function evaluation(): SourceEvaluationManifest {
  return { version: 1, frozenAt: '2026-10-03T00:00:00Z', gallery: ['A', 'B', 'C', 'D', 'E', 'F'].map(f => ({ referenceId: f, familyId: f })),
    items: [
      { id: 'known', familyId: 'A', targetFamilyId: 'A', split: 'test' as const },
      { id: 'unknown', familyId: 'outside', targetFamilyId: null, split: 'test' as const },
      { id: 'cal-known', familyId: 'B', targetFamilyId: 'B', split: 'calibration' as const },
      { id: 'cal-unknown', familyId: 'outside-cal', targetFamilyId: null, split: 'calibration' as const },
    ].map((i, n) => ({ ...i, originalId: i.id, audioSha256: String(n).repeat(64), domain: 'synthetic', transformations: [] })) };
}
describe('held-out source retrieval and open-set evaluation', () => {
  it('measures top1/top5 and unfamiliar false IDs without pretending scores are probabilities', () => {
    const metrics = evaluateSourceRetrieval(evaluation(), [{ itemId: 'known', rankedReferenceIds: ['B', 'A'], acceptedReferenceId: 'B' }, { itemId: 'unknown', rankedReferenceIds: ['C'], acceptedReferenceId: 'C' }], 'test', 'synthetic');
    expect(metrics).toMatchObject({ top1: 0, top5: 1, openSetFalseId: 1, acceptedAccuracy: 0, domain: 'synthetic' });
    expect(metrics.note).toContain('not preset');
    expect(evaluateSourceRetrieval(evaluation(), [], 'test', 'real').top1).toBeNull();
  });
  it('rejects family, original, and identical-audio leakage across splits', () => {
    for (const field of ['familyId', 'originalId', 'audioSha256'] as const) {
      const m = evaluation(); m.items[2][field] = m.items[0][field];
      if (field === 'familyId') m.items[2].targetFamilyId = m.items[0].targetFamilyId;
      expect(() => validateSourceEvaluation(m)).toThrow('leakage');
    }
  });
  it('rejects missing/duplicate/unknown predictions and inconsistent open-set truth', () => {
    const p = { itemId: 'known', rankedReferenceIds: ['A'], acceptedReferenceId: 'A' };
    expect(() => evaluateSourceRetrieval(evaluation(), [p], 'test', 'synthetic')).toThrow('one prediction');
    expect(() => evaluateSourceRetrieval(evaluation(), [p, p], 'test', 'synthetic')).toThrow('duplicate');
    expect(() => evaluateSourceRetrieval(evaluation(), [{ ...p, rankedReferenceIds: ['invention'] }], 'test', 'synthetic')).toThrow('prediction');
    const m = evaluation(); m.items[0].targetFamilyId = null;
    expect(() => validateSourceEvaluation(m)).toThrow('open-set');
  });
  it('calibrates only distinct calibration families and requires unfamiliar examples', () => {
    const observations = [
      { itemId: 'cal-known', score: 0.95, familyMargin: 0.3, coverage: 1, frames: 20, topFamilyId: 'B' },
      { itemId: 'cal-unknown', score: 0.7, familyMargin: 0.15, coverage: 1, frames: 20, topFamilyId: 'B' },
    ];
    expect(calibrateRejection(evaluation(), observations, 'synthetic', 'fixture-calibration').minScore).toBeLessThanOrEqual(0.95);
    expect(() => calibrateRejection(evaluation(), [{ ...observations[0], itemId: 'known' }, observations[1]], 'synthetic', 'x')).toThrow('observations');
    const m = evaluation(); m.items = m.items.filter(i => i.id !== 'cal-unknown');
    expect(() => calibrateRejection(m, observations.slice(0, 1), 'synthetic', 'x')).toThrow('unfamiliar');
  });
});
