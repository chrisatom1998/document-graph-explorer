import { describe, expect, it } from 'vitest';
import { parseCopilotSuggestions, sanitizeCopilotProperties } from './copilotProperties';
import { sanitizeMusicAnalysis } from './musicTypes';
import { copilotEvidence } from './copilotEvidence';
import { EMPTY_SAMPLE_QUERY, searchSamples } from './sampleSearch';
import type { DocNode } from '../model/types';

const tags = { source: ['voice'], production: ['vocal chops'], character: [] };
const properties = { tags, model: 'gpt-6.1-sol' };
const node: DocNode = { id: 'one', title: 'one.wav', kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, degree: 0, cluster: -1, status: 'ok',
  audio: { version: 2, durationSeconds: 2, analyzedSeconds: 2, instruments: [], notes: [], copilotProperties: properties } };
const sample = copilotEvidence(node, 0)!;
describe('copilot properties', () => {
  it('persists suggestions without promoting them to confirmed labels or new AI evidence', () => {
    const audio = sanitizeMusicAnalysis(JSON.parse(JSON.stringify(node.audio)))!;
    expect(audio.copilotProperties).toEqual(properties);
    expect(audio.confirmedDjTags).toBeUndefined();
    expect(copilotEvidence({ ...node, audio }, 0)?.estimates).toEqual([]);
  });
  it('rejects invalid labels, groups, models and sample references', () => {
    expect(sanitizeCopilotProperties({ ...properties, model: '<script>' })).toBeUndefined();
    expect(sanitizeCopilotProperties({ ...properties, tags: { ...tags, source: ['invented'] } })).toBeUndefined();
    expect(() => parseCopilotSuggestions([{ ref: 'Sample 2', tags }], [sample])).toThrow();
    expect(() => parseCopilotSuggestions([{ ref: 'Sample 1', tags }, { ref: 'Sample 1', tags }], [sample, { ...sample, ref: 'Sample 2' }])).toThrow();
  });
  it('protects confirmed and explicitly empty human labels', () => {
    expect(parseCopilotSuggestions([{ ref: sample.ref, tags }], [{ ...sample, confirmedTags: [] }])).toEqual([]);
    expect(parseCopilotSuggestions([{ ref: sample.ref, tags }], [{ ...sample, confirmedInstruments: [] }])[0].tags.source).toEqual([]);
  });
  it('makes accepted suggestions searchable without calling them confirmed or audio measurements', () => {
    const query = { ...EMPTY_SAMPLE_QUERY, terms: ['vocal chops'] };
    expect(searchSamples([node], query)[0].reasons).toEqual(['AI-suggested property: vocal chops']);
    expect(searchSamples([node], { ...query, confirmedOnly: true })).toEqual([]);
    expect(searchSamples([{ ...node, audio: { ...node.audio!, confirmedDjTags: { source: [], production: [], character: [] } } }], query)).toEqual([]);
  });
});
