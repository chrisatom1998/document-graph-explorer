import { describe, expect, it } from 'vitest';
import { canonicalLunaLabel, lunaEvidence, deterministicLuna, mergeLunaResponse, parseLunaSamples } from './lunaEvidence';
import { createRecognition } from './recognition';
import { sample } from './lunaEvidence.fixture';
const response = (normalizations: unknown[] = []) => ({ samples: [{ ref: 'Sample 1', normalizations, review: 'recommend', reason: 'The second detector is ambiguous and its coverage is unknown.' }] });
describe('Luna evidence boundary', () => {
  it('bounds every detector coverage path and marks omitted windows', () => {
    const segments = Array.from({ length: 150 }, (_, i) => ({ start: i, end: i + 1, score: .6 }));
    const evidence = lunaEvidence({ version: 2, durationSeconds: 150, analyzedSeconds: 90, notes: [],
      instruments: [{ label: 'piano', score: .6, segments }] }, 0);
    expect(evidence.truncated).toBe(true);
    expect(evidence.labels.find(l => l.sourceModel === 'Instrument model')?.coverage).toEqual(segments.slice(0, 128).map(({ start, end }) => ({ start, end })));
  });
  it('does not treat maybe, uncalibrated, or other-dimension rows as supported', () => {
    const evidence = lunaEvidence({ version: 2, durationSeconds: 30, analyzedSeconds: 30, notes: [],
      instruments: [{ label: 'piano', score: .8 }, { label: 'synthesizer', score: .8 }, { label: 'kick', score: .8 }],
      soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false, djTags: [
        { group: 'source', label: 'piano', score: .9, model: 'Trained head (maybe)' },
        { group: 'source', label: 'synthesizer', score: .9, model: 'Trained head' },
        { group: 'source', label: 'banjo', score: .8, model: 'Music CLAP' },
        { group: 'production', label: 'kick', score: .8, model: 'Trained head' },
      ] } }, 0);
    const row = (sourceModel: string, originalLabel: string) => evidence.labels.find(l => l.sourceModel === sourceModel && l.originalLabel === originalLabel);
    expect(row('Trained head (maybe)', 'piano')?.supported).toBe(false);
    expect(row('Instrument model', 'piano')?.supported).toBe(false);
    expect(row('Music CLAP', 'banjo')?.supported).toBe(false);
    expect(row('Instrument model', 'kick')?.supported).toBe(false);
    expect(row('Trained head', 'synthesizer')?.supported).toBe(true);
    expect(row('Instrument model', 'synthesizer')?.supported).toBe(true);
    expect(row('Trained head', 'kick')?.supported).toBe(true);
    const routed = deterministicLuna(lunaEvidence({ version: 2, durationSeconds: 30, analyzedSeconds: 30, notes: [],
      instruments: [{ label: 'piano', score: .8 }],
      soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false, djTags: [
        { group: 'source', label: 'piano', score: .9, model: 'Trained head (maybe)' },
        { group: 'source', label: 'synthesizer', score: .9, model: 'Trained head' },
      ] } }, 0));
    expect(routed.signals).toContain('few-supported-labels');
    expect(routed.signals).not.toContain('detector-disagreement');
  });
  it('preserves a saved audio model proposal and its actual excerpt without inventing a score', () => {
    const evidence = lunaEvidence({ version: 2, durationSeconds: 30, analyzedSeconds: 30, instruments: [], notes: [],
      copilotProperties: { model: 'gpt-audio-1.5', tags: { source: ['voice'], production: [], character: [] }, audioExcerpt: { startSeconds: 0, durationSeconds: 10 } } }, 0);
    expect(evidence.labels).toContainEqual(expect.objectContaining({ sourceModel: 'gpt-audio-1.5', originalLabel: 'voice', score: null, supported: false, coverage: [{ start: 0, end: 10 }] }));
  });
  it('does not attach one window score to a different excerpt', () => {
    const recognition = createRecognition(20, 'full');
    recognition.evidence = [.2, .8].map((score, i) => ({ id: `r${i}`, modelId: 'ast', dimension: 'source', labelId: 'voice', score,
      start: i * 10, end: (i + 1) * 10, validSeconds: 10, inputSeconds: 10, aggregation: 'window', padding: 'none' }));
    const result = lunaEvidence({ version: 2, durationSeconds: 20, analyzedSeconds: 20, instruments: [], notes: [], recognition }, 0);
    expect(result.labels.filter(l => l.sourceModel === 'ast').map(l => ({ score: l.score, coverage: l.coverage }))).toEqual([
      { score: .2, coverage: [{ start: 0, end: 10 }] }, { score: .8, coverage: [{ start: 10, end: 20 }] },
    ]);
  });
  it('prefers exact taxonomy and existing aliases without model calls', () => {
    expect(canonicalLunaLabel('source', 'Vocals')).toBe('voice');
    expect(canonicalLunaLabel('source', 'guitar')).toBe('guitar');
    expect(canonicalLunaLabel('source', 'telepathic organ')).toBeNull();
    expect(deterministicLuna(sample).labels[0]).toMatchObject({ canonicalLabel: 'voice', method: 'deterministic', sourceModel: 'detector-a', originalLabel: 'Vocals', coverage: [{ start: 0, end: 4 }] });
  });
  it('strips unknown payload fields, bounds evidence, and rejects raw audio masquerading as evidence', () => {
    expect(parseLunaSamples([{ ...sample, wav: 'private-audio', path: 'private' }])[0]).toEqual(sample);
    expect(() => parseLunaSamples([{ ...sample, labels: Array(65).fill(sample.labels[0]) }])).toThrow();
    expect(() => parseLunaSamples([{ ...sample, labels: [{ ...sample.labels[0], coverage: [{ start: 0, end: 11 }] }] }])).toThrow();
  });
  it('only resolves unresolved labels, preserving provenance and rejecting invented classes, groups and duplicates', () => {
    const result = mergeLunaResponse(response([{ id: 'e2', canonicalLabel: 'piano' }]), [sample])[0];
    expect(result.labels[1]).toEqual({ ...sample.labels[1], canonicalLabel: 'piano', method: 'luna' });
    for (const rows of [[{ id: 'e1', canonicalLabel: 'piano' }], [{ id: 'e2', canonicalLabel: 'new class' }], [{ id: 'e2', canonicalLabel: 'warm' }], [{ id: 'e2', canonicalLabel: null }, { id: 'e2', canonicalLabel: 'piano' }]]) expect(() => mergeLunaResponse(response(rows), [sample])).toThrow();
    expect(sample.labels[1].originalLabel).toBe('unclear keys');
  });
  it('never overrides locked fields or individual reviewed labels', () => {
    const locked = { ...sample, locked: { source: true, production: true, character: true } };
    expect(deterministicLuna(locked).labels.every(l => l.method === 'protected')).toBe(true);
    expect(deterministicLuna(locked).signals).toEqual([]);
    expect(() => mergeLunaResponse(response([{ id: 'e2', canonicalLabel: 'piano' }]), [locked])).toThrow();
    const protectedSample = { ...sample, protectedLabels: { ...sample.protectedLabels, source: ['piano'] } };
    expect(mergeLunaResponse(response([{ id: 'e2', canonicalLabel: 'piano' }]), [protectedSample])[0].labels[1].canonicalLabel).toBeNull();
  });
  it('requires complete unique samples and rejects fabricated confidence percentages', () => {
    expect(() => mergeLunaResponse({ samples: [] }, [sample])).toThrow();
    const bad = response(); bad.samples[0].reason = '99% sure';
    expect(() => mergeLunaResponse(bad, [sample])).toThrow();
  });
});
