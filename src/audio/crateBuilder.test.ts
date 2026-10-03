import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import { buildCrate, parseCratePlan } from './crateBuilder';
import { EMPTY_SAMPLE_QUERY } from './sampleQuery';
const node = (id: string, bpm?: number, confirmed = false): DocNode => ({ id, title: id, kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok', audio: { version: 2, durationSeconds: 4, analyzedSeconds: 4, instruments: [], notes: [], ...(bpm ? { tempo: { bpm, confidence: .9 } } : {}), ...(confirmed ? { confirmedInstruments: ['synthesizer'] } : {}) } });
describe('crate planning', () => {
  it('uses only eligible local sounds and prefers confirmed evidence', () => {
    const plan = parseCratePlan({ groups: [{ role: 'synths', count: 2, query: { ...EMPTY_SAMPLE_QUERY, minBpm: 136, maxBpm: 144 } }], clarification: null });
    const result = buildCrate([node('unknown'), node('wrong tempo', 92), node('b', 140), node('a confirmed', 140, true)], plan);
    expect(result.entries.map(e => e.node.id)).toEqual(['a confirmed', 'b']);
    expect(result.missing).toEqual([]);
  });
  it('never duplicates a sound across roles or silently fills missing slots', () => {
    const plan = parseCratePlan({ groups: [{ role: 'first', count: 1, query: EMPTY_SAMPLE_QUERY }, { role: 'second', count: 2, query: EMPTY_SAMPLE_QUERY }], clarification: null });
    const result = buildCrate([node('one'), node('two')], plan, undefined, ['one']);
    expect(result.entries.map(e => e.node.id)).toEqual(['two']);
    expect(result.missing).toEqual(['second: found 0 of 2. No unsupported matches were added.']);
  });
  it('rejects invalid role sizes and query constraints', () => {
    expect(() => parseCratePlan({ groups: [{ role: 'x', count: 100, query: EMPTY_SAMPLE_QUERY }], clarification: null })).toThrow();
    expect(() => parseCratePlan({ groups: [{ role: 'x', count: 1, query: { ...EMPTY_SAMPLE_QUERY, minBpm: 200, maxBpm: 100 } }], clarification: null })).toThrow();
  });
});
