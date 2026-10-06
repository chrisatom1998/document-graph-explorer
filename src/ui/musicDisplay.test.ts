import { describe, expect, it } from 'vitest';
import type { DocNode, Edge } from '../model/types';
import { camelotCode, musicNeighbours, sharedTitlePrefix, shownTempoKey } from './musicDisplay';

const track = (id: string, title: string, audio: Partial<NonNullable<DocNode['audio']>> = {}): DocNode => ({
  id, title, path: `${title}.wav`, kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, degree: 0, cluster: 0, status: 'ok',
  audio: { version: 2, analyzedSeconds: 8, durationSeconds: 8, instruments: [], notes: [], ...audio },
} as unknown as DocNode);
const edge = (source: string, target: string, kind: Edge['kind'], weight: number, evidence: string): Edge =>
  ({ id: `${source}->${target}:${kind}`, source, target, kind, weight, evidence: [evidence] });

describe('camelotCode', () => {
  it('maps keys onto the Camelot wheel', () => {
    expect(camelotCode({ tonic: 9, mode: 'minor' })).toBe('8A');
    expect(camelotCode({ tonic: 0, mode: 'major' })).toBe('8B');
    expect(camelotCode({ tonic: 2, mode: 'minor' })).toBe('7A');
    expect(camelotCode({ tonic: 7, mode: 'minor' })).toBe('6A');
    expect(camelotCode({ tonic: 7, mode: 'major' })).toBe('9B');
    expect(camelotCode({ tonic: 8, mode: 'minor' })).toBe('1A');
    expect(camelotCode({ tonic: 4, mode: 'major' })).toBe('12B');
  });
});

describe('sharedTitlePrefix', () => {
  it('finds the words every title shares and always leaves a remainder', () => {
    expect(sharedTitlePrefix(['SHADOW UK1 Melodic Loop Fight Gm 140', 'SHADOW UK1 Melodic Loop Ice Dm 150'])).toBe('SHADOW UK1 Melodic Loop ');
    expect(sharedTitlePrefix(['Pack Loop', 'Pack Loop Two'])).toBe('Pack ');
    expect(sharedTitlePrefix(['Alpha', 'Beta'])).toBe('');
    expect(sharedTitlePrefix(['Only one title'])).toBe('');
  });
});

describe('musicNeighbours', () => {
  it('groups links per track, ranks by strength and explains each link', () => {
    const a = track('a', 'Pack Fight Gm 140'), b = track('b', 'Pack Ice Dm 150', { tempo: { bpm: 150, confidence: .9 } }), c = track('c', 'Pack Bells');
    const nodes = [a, b, c], nodeIndex = { a: 0, b: 1, c: 2 };
    const edges = [
      edge('a', 'c', 'title', .9, 'Shared title phrase: “pack”.'),
      edge('a', 'b', 'tempo', .6, 'Similar estimated tempo: 140.0 and 150.0 BPM.'),
      edge('a', 'b', 'similar', .76, "Sounds alike: the two recordings' sound fingerprints are 76% similar."),
      edge('a', 'b', 'key', .65, 'Harmonic key relation: G minor and D minor: neighboring keys on the circle of fifths.'),
      edge('a', 'b', 'instrument', .5, 'Shared instruments: synthesizer, trumpet. Not confirmed instrumentation.'),
      edge('a', 'b', 'sound', .4, 'Shared sound properties: pulsing (character), sustained (character), airy (character), bright (character). Not confirmed.'),
    ];
    const rows = musicNeighbours(a, edges, nodes, nodeIndex);
    expect(rows.map((r) => r.id)).toEqual(['b', 'c']);
    expect(rows[0].reasons.map((r) => r.text)).toEqual(['Sounds 76% alike', 'Adjacent key', '+10 BPM', 'Both: synthesizer, trumpet', 'Both: pulsing, sustained, airy +1']);
    expect(rows[1].reasons.map((r) => r.text)).toEqual(['Similar name']);
  });
  it('shows the name tag tempo and key ahead of the audio estimate', () => {
    const shown = shownTempoKey(track('a', 'Pack Fight Gm 140', { tempo: { bpm: 70, confidence: .9 }, key: { tonic: 0, mode: 'minor', strength: .8 } }));
    expect(shown.bpm).toBe(140);
    expect(shown.key).toEqual({ tonic: 7, mode: 'minor' });
  });
});
