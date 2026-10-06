import { describe, expect, it } from 'vitest';
import type { DocNode, Edge } from '../model/types';
import { musicNeighbours, sharedTitlePrefix, shownTempoKey, stripTitlePrefix } from './musicDisplay';

const track = (id: string, title: string, audio: Partial<NonNullable<DocNode['audio']>> = {}): DocNode => ({
  id, title, path: `${title}.wav`, kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, degree: 0, cluster: 0, status: 'ok',
  audio: { version: 2, analyzedSeconds: 8, durationSeconds: 8, instruments: [], notes: [], ...audio },
} as unknown as DocNode);
const edge = (source: string, target: string, kind: Edge['kind'], weight: number, evidence: string): Edge =>
  ({ id: `${source}->${target}:${kind}`, source, target, kind, weight, evidence: [evidence] });

describe('sharedTitlePrefix', () => {
  it('finds the words every title shares and always leaves a remainder', () => {
    expect(sharedTitlePrefix(['SHADOW UK1 Melodic Loop Fight Gm 140', 'SHADOW UK1 Melodic Loop Ice Dm 150'])).toBe('SHADOW UK1 Melodic Loop ');
    expect(sharedTitlePrefix(['Pack Loop', 'Pack Loop Two'])).toBe('Pack ');
    expect(sharedTitlePrefix(['Alpha', 'Beta'])).toBe('');
    expect(sharedTitlePrefix(['Only one title'])).toBe('');
  });
  it('strips the prefix from every title that shares it, whatever its case or spacing', () => {
    const prefix = sharedTitlePrefix(['PACK Loop One', 'pack loop Two']);
    expect(stripTitlePrefix('PACK Loop One', prefix)).toBe('One');
    expect(stripTitlePrefix('pack  loop Two', prefix)).toBe('Two');
    expect(stripTitlePrefix('Other Loop Three', prefix)).toBe('Other Loop Three');
    expect(stripTitlePrefix('Pack Loop', prefix)).toBe('Pack Loop');
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
    // 150 vs 140 BPM is beyond beatmatching range, so b is linked but not mixable.
    expect(rows.map((r) => [r.id, r.mixable])).toEqual([['b', false], ['c', false]]);
    expect(rows[0].reasons.map((r) => r.text)).toEqual(['Sounds 76% alike', 'Adjacent key', '+10 BPM', 'Both: synthesizer, trumpet', 'Both: pulsing, sustained, airy +1']);
    expect(rows[1].reasons.map((r) => r.text)).toEqual(['Similar name']);
  });
  it('lists mixable tracks first, with key and tempo chips from the mix ranking and graph-only reasons added', () => {
    const a = track('a', 'Pack Fight Gm 140'), b = track('b', 'Pack Ice Dm 150'), d = track('d', 'Pack Drift Dm 142');
    const edges = [edge('a', 'b', 'similar', .9, "Sounds alike: the two recordings' sound fingerprints are 90% similar."), edge('a', 'd', 'title', .7, 'Shared title phrase: “pack”.')];
    const rows = musicNeighbours(a, edges, [a, b, d], { a: 0, b: 1, d: 2 });
    expect(rows.map((r) => [r.id, r.mixable])).toEqual([['d', true], ['b', false]]);
    expect(rows[0].reasons.map((r) => r.text)).toEqual(['Adjacent key', '+2 BPM', 'Similar name']);
  });
  it('names version links as the same recording or another version', () => {
    const a = track('a', 'Night Drive'), b = track('b', 'Night Drive copy'), c = track('c', 'Night Drive (Club Remix)');
    const edges = [edge('a', 'b', 'version', .95, 'Same recording (a copy or re-encode): 100% of the shorter file lines up with the other, and the mix matches.'),
      edge('a', 'c', 'version', .7, 'Another version of the same song: the titles match, the name marks a remix or edit.')];
    const rows = musicNeighbours(a, edges, [a, b, c], { a: 0, b: 1, c: 2 });
    expect(Object.fromEntries(rows.map((r) => [r.id, r.reasons.map((x) => x.text)]))).toEqual({ b: ['Same recording'], c: ['Other version'] });
  });
  it('shows the name tag tempo and key ahead of the audio estimate', () => {
    const shown = shownTempoKey(track('a', 'Pack Fight Gm 140', { tempo: { bpm: 70, confidence: .9 }, key: { tonic: 0, mode: 'minor', strength: .8 } }));
    expect(shown.bpm).toBe(140);
    expect(shown.key).toEqual({ tonic: 7, mode: 'minor' });
  });
});
