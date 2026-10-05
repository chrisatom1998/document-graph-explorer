import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import type { MusicAnalysis } from './musicTypes';
import { buildMusicEdges, musicPairEdges, refreshMusicEdges } from './musicLinks';
import { soundMatchLabels } from './soundMatchLabels';

const node = (id: string, audio: Partial<MusicAnalysis> = {}): DocNode => ({
  id, title: id, kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [],
  wordCount: 0, degree: 0, cluster: 0, status: 'ok',
  audio: { version: 2, durationSeconds: 10, analyzedSeconds: 10, instruments: [], notes: [], ...audio },
});
const vector = (cosine: number, index = 1, scale = 1) => {
  const v = new Array(512).fill(0); v[0] = cosine * scale; v[index] = Math.sqrt(1 - cosine ** 2) * scale; return v;
};
const guessed = (id: string, group: 'source' | 'production' | 'character', label: string) => node(id, {
  soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false, djTags: [{ group, label, score: .3 }] },
});

describe('audio relationship quality', () => {
  it('does not assign name-tag tempo or key to very short one-shots', () => {
    const a = { ...node('a', { durationSeconds: .6, analyzedSeconds: .6 }), path: '120BPM/Cm/kick.wav' };
    const b = { ...node('b', { durationSeconds: .6, analyzedSeconds: .6 }), path: '120BPM/Cm/snare.wav' };
    expect(musicPairEdges(a, b).filter(e => e.kind === 'tempo' || e.kind === 'key')).toEqual([]);
  });
  it('does not reuse stale short-clip measurements but leaves them stored', () => {
    const audio = { durationSeconds: .8, analyzedSeconds: .8, tempo: { bpm: 120, confidence: .9 }, key: { tonic: 0, mode: 'major' as const, strength: .9 } };
    const a = node('a', audio), b = node('b', audio);
    expect(refreshMusicEdges([a, b], [{ id: 'a->b:key', source: 'a', target: 'b', kind: 'key', weight: .9, evidence: ['stale'] }])).toEqual([]);
    expect(a.audio?.tempo).toEqual(audio.tempo); expect(a.audio?.key).toEqual(audio.key);
  });
  it('requires enough analyzed audio for a measured rhythm or mode', () => {
    const audio = { analyzedSeconds: .5, tempo: { bpm: 120, confidence: .9 }, key: { tonic: 0, mode: 'major' as const, strength: .9 } };
    expect(musicPairEdges(node('a', audio), node('b', audio))).toEqual([]);
  });
  it('can use a supported short rhythm estimate without inheriting a folder BPM', () => {
    const audio = { durationSeconds: 2.1, analyzedSeconds: 2.1, tempo: { bpm: 120, confidence: .9 } };
    const a = { ...node('a', audio), path: '90BPM/a.wav' };
    const b = node('b', audio);
    expect(musicPairEdges(a, b).find(e => e.kind === 'tempo')?.evidence[0]).toContain('120.0 and 120.0');
  });
  it('uses cosine rather than vector magnitude and ignores invalid fingerprints', () => {
    const a = node('a', { embedding: vector(1) });
    const unrelated = node('b', { embedding: vector(.2, 1, 10) });
    expect(musicPairEdges(a, unrelated)).toEqual([]);
    const same = node('c', { embedding: vector(1, 1, 5) });
    expect(musicPairEdges(a, same)[0].weight).toBeCloseTo(1);
    expect(same.audio?.embedding?.[0]).toBe(5);
    const invalid = vector(1); invalid[4] = Infinity;
    expect(musicPairEdges(a, node('d', { embedding: invalid }))).toEqual([]);
    expect(musicPairEdges(a, node('zero', { embedding: new Array(512).fill(0) }))).toEqual([]);
  });
  it('does not let a shared label bypass relative nearest-fingerprint eligibility', () => {
    const nodes = [node('a', { embedding: vector(1), confirmedInstruments: ['piano'] }),
      node('b', { embedding: vector(.99), confirmedInstruments: ['piano'] }),
      node('c', { embedding: vector(.75, 2), confirmedInstruments: ['piano'] })];
    expect(buildMusicEdges(nodes).filter(e => e.kind === 'similar').map(e => [e.source, e.target])).toEqual([['a', 'b']]);
    expect(buildMusicEdges(nodes).some(e => e.kind === 'instrument' && e.target === 'c')).toBe(true);
  });
  it('does not treat a lone generic guess as a sound relationship', () => {
    for (const [group, label] of [['source', 'synthesizer'], ['character', 'warm']] as const) {
      expect(musicPairEdges(guessed('a', group, label), guessed('b', group, label))).toEqual([]);
    }
  });
  it('does not leave generic guess links after a mediocre fingerprint is excluded', () => {
    const a = guessed('a', 'source', 'synthesizer'), b = guessed('b', 'source', 'synthesizer'), c = guessed('c', 'source', 'synthesizer');
    a.audio!.embedding = vector(1); b.audio!.embedding = vector(.99); c.audio!.embedding = vector(.75, 2);
    expect(buildMusicEdges([a, b, c]).some(e => e.source === 'c' || e.target === 'c')).toBe(false);
  });
  it('describes untested source guesses without claiming strong or repeated detections', () => {
    const edge = musicPairEdges(guessed('a', 'source', 'piano'), guessed('b', 'source', 'piano')).find(e => e.kind === 'instrument')!;
    expect(edge.evidence[0]).toContain('piano: untested model guess / untested model guess');
    expect(edge.evidence[0]).not.toContain('strong or repeated');
    expect(edge.weight).toBeLessThan(.5);
  });
  it('retains uncalibrated catalog similarity as a separate provenance', () => {
    const a = node('a', { soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false,
      djTags: [{ group: 'production', label: 'reversed vocal', score: .9, model: 'Music CLAP' }] } });
    expect(soundMatchLabels(a).find(m => m.label === 'reversed vocal')?.origin).toBe('unverified');
  });
  it('keeps discriminating shared properties ahead of ubiquitous metadata', () => {
    const tags = (production: string[] = []) => ({ source: [], production, character: ['metallic'] });
    const root = node('0-root', { confirmedDjTags: tags(['riser']) });
    const common = Array.from({ length: 8 }, (_, i) => node(`a${i}`, { confirmedDjTags: tags() }));
    const rare = node('z-rare', { confirmedDjTags: tags(['riser']) });
    const edges = buildMusicEdges([root, ...common, rare]);
    expect(edges.some(e => e.kind === 'sound' && e.source === '0-root' && e.target === 'z-rare')).toBe(true);
    expect(buildMusicEdges([rare, ...common.reverse(), root])).toEqual(edges);
  });
  it('explains harmonic relations without claiming the sounds are similar', () => {
    const edge = musicPairEdges(node('a', { key: { tonic: 0, mode: 'major', strength: .9 } }),
      node('b', { key: { tonic: 9, mode: 'minor', strength: .9 } }))[0];
    expect(edge.evidence[0]).toContain('Harmonic key relation');
    expect(edge.evidence[0]).toContain('does not establish similar sound or mix quality');
  });
  it('does not label identical embeddings as exact duplicate recordings', () => {
    const edge = musicPairEdges(node('a', { embedding: vector(1) }), node('b', { embedding: vector(1) }))[0];
    expect(edge.evidence[0]).toContain('not proof of exact duplicates');
  });
});
