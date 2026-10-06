import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import type { MusicAnalysis } from './musicTypes';
import { buildMusicEdges, musicPairEdges, refreshMusicEdges } from './musicLinks';
import { soundMatchLabels } from './soundMatchLabels';
import { createRecognition, recordEvidence } from './recognition';
import { sanitizeGraphExport } from '../persistence/validateImport';

const node = (id: string, audio: Partial<MusicAnalysis> = {}): DocNode => ({
  id, title: id, kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [],
  wordCount: 0, degree: 0, cluster: 0, status: 'ok',
  audio: { version: 2, durationSeconds: 10, analyzedSeconds: 10, instruments: [], notes: [], ...audio },
});

const jamendo = (id: string, score: number, duration = 10, window = 10) => {
  const n = node(id, { durationSeconds: duration, analyzedSeconds: duration });
  n.audio!.recognition = createRecognition(duration, 'full');
  recordEvidence(n.audio!.recognition, 'jamendo', { start: 0, end: window },
    [{ dimension: 'source', labelId: 'synthesizer', score }]);
  return n;
};

describe('sound-link policy with Jamendo labels and corrections', () => {
  it('links likely full-window Jamendo sources at their display strength and keeps similar explanations separate', () => {
    const a = jamendo('a', .8), b = jamendo('b', .9);
    expect(soundMatchLabels(a)).toContainEqual({ group: 'source', label: 'synthesizer', origin: 'sounds', weight: .7 });
    const instrument = buildMusicEdges([a, b]).find(e => e.kind === 'instrument')!;
    expect(instrument.weight).toBe(.7);
    expect(instrument.evidence[0]).toContain('synthesizer: model estimate / model estimate');
    a.audio!.embedding = vector(1); b.audio!.embedding = vector(.99);
    const edges = buildMusicEdges([a, b]);
    expect(edges.map(e => e.kind)).toEqual(['instrument', 'similar']);
    expect(edges[1].evidence[0]).not.toContain('synthesizer');
    expect(edges[1].evidence[0]).toContain('Similar sound is not proof');
  });
  it('requires corroboration for lone possible Jamendo generic labels', () => {
    const a = jamendo('a', .45), b = jamendo('b', .45);
    expect(soundMatchLabels(a)).toContainEqual({ group: 'source', label: 'synthesizer', origin: 'maybe', weight: .55 });
    expect(buildMusicEdges([a, b])).toEqual([]);
    a.audio!.embedding = vector(1); b.audio!.embedding = vector(.99);
    expect(buildMusicEdges([a, b]).find(e => e.kind === 'instrument')?.weight).toBe(.55);
  });
  it.each([[9.999, 9.999], [10, 9.999]])('does not promote Jamendo outside a full 10s recording/window (%s/%s)', (duration, window) => {
    expect(soundMatchLabels(jamendo('a', .9, duration, window))).toEqual([]);
    expect(buildMusicEdges([jamendo('a', .9, duration, window), jamendo('b', .9, duration, window)])).toEqual([]);
  });
  it.each(['rejected', 'uncertain'] as const)('honors latest %s Jamendo corrections after export/reload, while keeping authored and fingerprint edges', decision => {
    const a = jamendo('a', .9), b = jamendo('b', .9);
    a.audio!.embedding = vector(1); b.audio!.embedding = vector(.99);
    const initial = buildMusicEdges([a, b]);
    const authored = { id: 'authored', source: 'a', target: 'b', kind: 'reference' as const, authored: true, weight: 1, evidence: ['Session notes'] };
    const review = { dimension: 'source' as const, labelId: 'synthesizer', decision, scope: 'track' as const, at: '2026-10-06T00:00:00Z', evidenceRunId: a.audio!.recognition!.runId };
    a.audio!.soundReviews = [{ ...review, decision: 'confirmed' }, review];
    const restored = sanitizeGraphExport(JSON.parse(JSON.stringify({ version: 1, nodes: [a, b], edges: [...initial, authored] })));
    const refreshed = refreshMusicEdges(restored.nodes, restored.edges);
    expect(refreshed.map(e => e.kind)).toEqual(['reference', 'similar']);
    expect(refreshed[1].evidence[0]).not.toContain('synthesizer');
    expect(restored.nodes[0].audio!.soundReviews!.at(-1)!.decision).toBe(decision);
    expect(refreshMusicEdges(restored.nodes, refreshed)).toEqual(refreshed);
    restored.nodes[0].audio!.soundReviews!.push({ ...review, decision: 'confirmed' });
    expect(refreshMusicEdges(restored.nodes, refreshed).find(e => e.kind === 'instrument')?.evidence[0]).toContain('confirmed by you / model estimate');
  });
});
const vector = (cosine: number, index = 1, scale = 1) => {
  const v = new Array(512).fill(0); v[0] = cosine * scale; v[index] = Math.sqrt(1 - cosine ** 2) * scale; return v;
};
const guessed = (id: string, group: 'source' | 'production' | 'character', label: string) => node(id, {
  soundProfile: { version: 1, character: [], roles: [], models: [], disagreement: false, djTags: [{ group, label, score: .3 }] },
});

describe('audio relationship quality', () => {
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
  it('does not treat a lone generic guess as a sound relationship', () => {
    for (const [group, label] of [['source', 'synthesizer'], ['character', 'warm']] as const) {
      expect(musicPairEdges(guessed('a', group, label), guessed('b', group, label))).toEqual([]);
    }
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
    expect(edge.evidence[0]).toContain('not proof of an exact duplicate');
  });
});
