import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import { EMPTY_SAMPLE_QUERY as empty, parseSampleQuery, searchSamples, sampleLabels } from './sampleSearch';

const clip = (id: string, overrides: Partial<NonNullable<DocNode['audio']>> = {}): DocNode => ({
  id, kind: 'document', title: id, fileType: 'audio', topics: [], keywords: [], entities: [],
  wordCount: 0, cluster: -1, degree: 0, status: 'ok',
  audio: { version: 2, durationSeconds: 4, analyzedSeconds: 4, instruments: [], notes: [], ...overrides },
});
const tags = { source: ['voice'], production: ['vocal chops'], character: [] };
describe('sample assistant local retrieval', () => {
  it('ranks confirmed labels above filename hints and reports the distinction', () => {
    const result = searchSamples([clip('vocal chops.wav'), clip('confirmed', { confirmedDjTags: tags })], { ...empty, terms: ['vocal chops'] });
    expect(result.map(r => r.node.id)).toEqual(['confirmed', 'vocal chops.wav']);
    expect(result[0].reasons[0]).toContain('Confirmed by you');
    expect(result[1].reasons[0]).toContain('Filename hint');
  });
  it('does not let filename hints override an explicit negative correction', () => {
    const n = clip('vocal chops.wav', { confirmedDjTags: { source: [], production: [], character: [] } });
    expect(searchSamples([n], { ...empty, terms: ['vocal chops'] })).toEqual([]);
  });
  it('does not let automatic instruments override confirmed DJ labels', () => {
    const n = clip('confirmed', { confirmedDjTags: tags, instruments: [{ label: 'synthesizer', score: .99, status: 'likely' }] });
    expect(searchSamples([n], { ...empty, terms: ['synthesizer'] })).toEqual([]);
  });
  it('uses the latest source review over an earlier instrument confirmation', () => {
    const n = clip('stale instrument', { confirmedInstruments: ['synthesizer'], soundReviews: [{ labelId: 'synthesizer', dimension: 'source', decision: 'rejected', scope: 'track', at: '2026-10-03T00:00:00Z', evidenceRunId: 'old' }] });
    expect(searchSamples([n], { ...empty, terms: ['synthesizer'] })).toEqual([]);
  });
  it('requires reliable measured BPM rather than filename BPM', () => {
    const result = searchSamples([clip('128 bpm.wav'), clip('weak', { tempo: { bpm: 128, confidence: .1 } }), clip('measured', { tempo: { bpm: 128, confidence: .9 } })], { ...empty, minBpm: 120, maxBpm: 130 });
    expect(result.map(r => r.node.id)).toEqual(['measured']);
  });
  it('requires all terms and excludes unwanted labels', () => {
    const n = clip('good', { confirmedDjTags: tags });
    expect(searchSamples([n], { ...empty, terms: ['voice', 'vocal chops'] })).toHaveLength(1);
    expect(searchSamples([n], { ...empty, terms: ['voice', 'airy'] })).toHaveLength(0);
    expect(searchSamples([n], { ...empty, exclude: ['voice'] })).toHaveLength(0);
  });
  it('keeps unknown duration/key out of filtered results', () => {
    const n = clip('known'); const unknown = { ...n, id: 'unknown', audio: undefined };
    expect(searchSamples([n, unknown], { ...empty, maxSeconds: 5 }).map(r => r.node.id)).toEqual(['known']);
    expect(searchSamples([n], { ...empty, key: 'A minor' })).toHaveLength(0);
  });
  it('finds feature similarities without matching the reference or unrelated audio', () => {
    const result = searchSamples([clip('reference', { confirmedDjTags: tags }), clip('match', { confirmedDjTags: tags }), clip('unrelated')], { ...empty, similar: true }, 'reference');
    expect(result.map(r => r.node.id)).toEqual(['match']);
    expect(result[0].reasons[0]).toContain('Shared labels');
    expect(searchSamples([clip('one')], { ...empty, similar: true }, 'missing')).toEqual([]);
  });
  it('returns no results for a clarification, rather than broadening the search', () => {
    expect(searchSamples([clip('one')], { ...empty, clarification: 'Choose a reference.' })).toEqual([]);
  });
  it('rejects malformed, reversed or absent constraints and strips unknown fields', () => {
    expect(() => parseSampleQuery({ ...empty, maxSeconds: -1 })).toThrow();
    expect(() => parseSampleQuery({ ...empty, minBpm: 130, maxBpm: 100 })).toThrow();
    expect(() => parseSampleQuery({ terms: [] })).toThrow();
    expect(parseSampleQuery({ ...empty, path: '/private' })).toEqual(empty);
  });
});

it.each(['rejected','uncertain'] as const)('does not revive %s sources through DJ labels or filename hints',decision=>{
 const review={labelId:'piano',dimension:'source' as const,decision,scope:'track' as const,at:'2026-10-03T00:00:00Z',evidenceRunId:'run'};
 const node=clip('piano.wav',{confirmedDjTags:{source:['piano'],production:[],character:[]},soundReviews:[review]});
 expect(sampleLabels(node).some(t=>t.label==='piano')).toBe(false);
 expect(searchSamples([node],{...empty,terms:['piano']})).toEqual([]);
 const legacy=clip('piano.wav',{instruments:[{label:'piano',score:.99,status:'likely'}],soundReviews:[review]});
 expect(searchSamples([legacy],{...empty,terms:['piano']})).toEqual([]);
});
it('keeps explicit empty source corrections above filename hints',()=>{
 expect(searchSamples([clip('piano.wav',{confirmedInstruments:[]})],{...empty,terms:['piano']})).toEqual([]);
});
it('suppresses superseded automatic DJ source tags while retaining unrelated character',()=>{
 const node=clip('sound',{confirmedInstruments:['trumpet'],soundProfile:{djTags:[{group:'source',label:'piano',score:.9,model:'Music CLAP'},{group:'character',label:'bright',score:.9,model:'Music CLAP'}]} as NonNullable<DocNode['audio']>['soundProfile']});
 expect(sampleLabels(node).map(t=>t.label)).toEqual(['bright','trumpet']);
});

it('retains explicit human confirmation of a broad instrument',()=>{
 expect(sampleLabels(clip('sample',{confirmedDjTags:{source:['guitar'],production:[],character:[]}}))).toContainEqual({label:'guitar',source:'confirmed'});
});
it('does not revive a rejected source through an older AI suggestion',()=>{
 const node=clip('sample',{soundReviews:[{labelId:'piano',dimension:'source',decision:'rejected',scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'run'}],copilotProperties:{model:'test-model',tags:{source:['piano'],production:[],character:[]}}});
 expect(sampleLabels(node).some(t=>t.label==='piano')).toBe(false);
});
