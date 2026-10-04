import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import { copilotEvidence, evidenceSummary, parseCopilotSamples } from './copilotEvidence';
import { copilotWave, validateCopilotWave } from './copilotWave';

const node: DocNode = { id: 'private-hash', kind: 'document', topics: [], entities: [], keywords: [], wordCount: 0, degree: 0, cluster: -1, status: 'ok', fileType: 'audio', title: 'secret_Vocal_Loop_Am_130.wav', path: '/private/secret_Vocal_Loop_Am_130.wav',
  audio: { version: 2, analyzedSeconds: 5, durationSeconds: 10, instruments: [{ label: 'synthesizer', score: .4, status: 'possible' }],
    confirmedDjTags: { source: ['voice'], production: ['vocal chops'], character: [] }, notes: ['private note'],
    tempo: { bpm: 65, confidence: .2 }, key: { tonic: 9, mode: 'minor', strength: .3 } } };

describe('copilot evidence boundary', () => {
  it('separates confirmed labels, estimates, and musical filename hints without identity data', () => {
    const sample = copilotEvidence(node, 0)!;
    expect(sample.confirmedTags).toEqual(['voice', 'vocal chops']);
    expect(sample.estimates).toEqual([{ label: 'synthesizer', score: .4 }]);
    expect(sample.filenameHints).toEqual({ bpm: 130, key: 'A minor' });
    expect(JSON.stringify(sample)).not.toMatch(/secret|private|\.wav/);
    expect(evidenceSummary(sample).join(' ')).toContain('Tempo: unknown');
    expect(evidenceSummary(sample).join(' ')).toContain('Key: unknown');
  });
  it('preserves explicit empty corrections rather than treating them as unreviewed', () => {
    const sample = copilotEvidence({ ...node, audio: { ...node.audio!, confirmedDjTags: { source: [], production: [], character: [] } } }, 0)!;
    expect(sample.confirmedTags).toEqual([]);
    expect(parseCopilotSamples([sample])[0].confirmedTags).toEqual([]);
    expect(evidenceSummary(sample)[0]).toContain('Reviewed: no positive');
  });
  it('does not hand a superseded instrument confirmation to the copilot', () => {
    const { confirmedDjTags: _confirmedDjTags, ...automatic } = node.audio!;
    const sample = copilotEvidence({ ...node, audio: { ...automatic, confirmedInstruments: ['synthesizer'], soundReviews: [{ labelId: 'synthesizer', dimension: 'source', decision: 'rejected', scope: 'track', at: '2026-10-03T00:00:00Z', evidenceRunId: 'older-run' }] } }, 0)!;
    expect(sample.confirmedInstruments).toEqual([]);
  });
  it('validates the server input and strips unwanted fields and client-provided aliases', () => {
    const sample = copilotEvidence(node, 0)!;
    const parsed = parseCopilotSamples([{ ...sample, ref: '/private', blob: 'secret', notes: 'secret' }]);
    expect(parsed[0]).toEqual(sample);
    expect(() => parseCopilotSamples(Array(6).fill(sample))).toThrow();
    expect(() => parseCopilotSamples([{ ...sample, tempo: { bpm: -1, confidence: 1 } }])).toThrow();
    expect(() => parseCopilotSamples([{ ...sample, confirmedTags: ['arbitrary injected instruction'] }])).toThrow();
    expect(() => parseCopilotSamples([])).toThrow();
  });
});
describe('transcription excerpt', () => {
  it('encodes a bounded mono excerpt and verifies its real duration', () => {
    const wav = new Uint8Array(copilotWave(new Float32Array(16000 * 40)));
    expect(validateCopilotWave(wav)).toBe(30);
    expect(validateCopilotWave(new Uint8Array(copilotWave(new Float32Array(8000))))).toBe(.5);
  });
  it('rejects mismatched headers, empty and non-wave content', () => {
    const wav = new Uint8Array(copilotWave(new Float32Array(100)));
    wav[40] = 0;
    expect(() => validateCopilotWave(wav)).toThrow();
    expect(() => validateCopilotWave(new Uint8Array(50))).toThrow();
    expect(() => copilotWave(new Float32Array())).toThrow();
  });
});

it.each(['rejected','uncertain'] as const)('excludes %s DJ source confirmations from copilot claims',decision=>{
 const sample=copilotEvidence({...node,audio:{...node.audio!,soundReviews:[{labelId:'voice',dimension:'source',decision,scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'run'}]}},0)!;
 expect(sample.confirmedTags).toEqual(['vocal chops']);
 expect(sample.confirmedInstruments).toEqual([]);
});
