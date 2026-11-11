import { describe, expect, it } from 'vitest';
import type { DocNode, Edge } from '../../model/types';
import { bestCrate, buildForYou, gradientFor, linkedSounds, soundTagsOf, tagText } from './forYouModel';

const clip = (id: string, extra: Partial<DocNode> = {}): DocNode => ({
  id, kind: 'document', title: id, fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: -1, degree: 0, status: 'ok', ...extra,
});
const audio = (key: 'minor' | 'major' | null, tonic: number, bpm: number | null): DocNode['audio'] => ({
  version: 2, analyzedSeconds: 10, durationSeconds: 10, instruments: [], notes: [],
  ...(key ? { key: { tonic, mode: key, strength: 0.9 } } : {}),
  ...(bpm ? { tempo: { bpm, confidence: 0.9 } } : {}),
});
const edge = (source: string, target: string, weight: number): Edge => ({ id: `${source}->${target}:similar`, source, target, kind: 'similar', weight, evidence: ['x'] });

describe('buildForYou', () => {
  it('reports nothing for an empty graph', () => {
    const m = buildForYou([], [], null, null);
    expect(m).toMatchObject({ sounds: [], neighbourhoods: null, focus: null, related: [], tags: [], crate: null });
  });

  it('counts neighbourhoods only once clustering has assigned them', () => {
    const unclustered = buildForYou([clip('a'), clip('b')], [], null, null);
    expect(unclustered.neighbourhoods).toBeNull();
    const clustered = buildForYou([clip('a', { cluster: 0 }), clip('b', { cluster: 0 }), clip('c', { cluster: 3 })], [], null, null);
    expect(clustered.neighbourhoods).toBe(2);
  });

  it('keeps documents out of the sound count and falls back to them only when there is no audio', () => {
    const doc = clip('d', { fileType: 'txt' });
    const mixed = buildForYou([clip('a'), doc], [], null, null);
    expect(mixed.sounds.map(n => n.id)).toEqual(['a']);
    expect(mixed.documents).toBe(1);
    const docsOnly = buildForYou([doc], [], null, null);
    expect(docsOnly.sounds).toEqual([]);
    expect(docsOnly.focus?.id).toBe('d');
  });

  it('prefers the selected clip, then the playing one, then the best connected', () => {
    const nodes = [clip('a', { degree: 1 }), clip('b', { degree: 5 }), clip('c')];
    expect(buildForYou(nodes, [], 'c', 'a').focus?.id).toBe('c');
    expect(buildForYou(nodes, [], null, 'a').focus?.id).toBe('a');
    expect(buildForYou(nodes, [], null, null).focus?.id).toBe('b');
  });

  it('lists linked clips strongest first and says when it fell back to the rest of the library', () => {
    const nodes = [clip('a'), clip('b'), clip('c'), clip('d')];
    const edges = [edge('a', 'b', 0.4), edge('c', 'a', 0.9)];
    expect(linkedSounds('a', nodes, edges).map(n => n.id)).toEqual(['c', 'b']);
    const linked = buildForYou(nodes, edges, 'a', null);
    expect(linked.focusLinked).toBe(true);
    expect(linked.related.map(n => n.id)).toEqual(['c', 'b']);
    const unlinked = buildForYou(nodes, [], 'a', null);
    expect(unlinked.focusLinked).toBe(false);
    expect(unlinked.related.map(n => n.id)).toEqual(['b', 'c', 'd']);
  });
});

describe('bestCrate', () => {
  it('is null when no clip has a key, never a guess', () => {
    expect(bestCrate([clip('a', { audio: audio(null, 0, 120) }), clip('b')])).toBeNull();
  });

  it('picks the most common detected key and reports only measured tempos', () => {
    const a = clip('a', { audio: audio('minor', 9, 122) });
    const b = clip('b', { audio: audio('minor', 9, 126) });
    const c = clip('c', { audio: audio('major', 0, 90) });
    const d = clip('d', { audio: audio('minor', 9, null) });
    const crate = bestCrate([a, b, c, d]);
    expect(crate?.clips.map(n => n.id)).toEqual(['a', 'b', 'd']);
    expect(crate?.bpmMin).toBe(122);
    expect(crate?.bpmMax).toBe(126);
  });

  it('leaves the tempo range empty when the crate has no tempos', () => {
    const crate = bestCrate([clip('a', { audio: audio('major', 0, null) })]);
    expect(crate).toMatchObject({ bpmMin: null, bpmMax: null });
  });
});

describe('gradientFor', () => {
  it('is stable per clip and follows the cluster when there is one', () => {
    expect(gradientFor({ id: 'x', cluster: -1 })).toEqual(gradientFor({ id: 'x', cluster: -1 }));
    expect(gradientFor({ id: 'x', cluster: 2 })).toEqual(gradientFor({ id: 'y', cluster: 2 }));
  });
});

describe('sound tags keep how they were found', () => {
  const base = { version: 2 as const, analyzedSeconds: 4, durationSeconds: 4, instruments: [] as never[], notes: [] as string[] };

  it('has none without analysis', () => {
    expect(soundTagsOf(clip('a'))).toEqual([]);
  });

  it('marks a label that only the file name supports as name-derived, never plain', () => {
    const tags = soundTagsOf(clip('kick one', { path: 'drums/kick one.wav', audio: base }));
    const kick = tags.find(t => t.label === 'kick');
    expect(kick?.basis).toBe('name');
    expect(tagText(kick!)).toBe('kick (from name)');
  });

  it('qualifies a model label between the track floor and the likely cutoff as possible, and states a likely one plainly', () => {
    const head = (score: number) => ({ ...base, durationSeconds: 8, analyzedSeconds: 8, soundProfile: { version: 1 as const, character: [], roles: [], models: [], disagreement: false, djTags: [{ group: 'production' as const, label: 'kick', score, model: 'Trained head' as const }] } });
    const possible = soundTagsOf(clip('p', { audio: head(0.45) })).find(t => t.label === 'kick');
    expect(possible?.basis).toBe('possible');
    expect(tagText(possible!)).toBe('kick (possible)');
    const likely = soundTagsOf(clip('l', { audio: head(0.8) })).find(t => t.label === 'kick');
    expect(likely?.basis).toBe('likely');
    expect(tagText(likely!)).toBe('kick');
  });

  it('shows a listener-confirmed label plainly', () => {
    const audio = { ...base, confirmedDjTags: { source: ['kick'], production: [], character: [] } };
    const kick = soundTagsOf(clip('x', { audio })).find(t => t.label === 'kick');
    expect(kick).toMatchObject({ basis: 'confirmed' });
    expect(tagText(kick!)).toBe('kick');
  });

  it('orders certain tags before uncertain ones and keeps the most certain basis per label', () => {
    const confirmed = { ...base, confirmedDjTags: { source: ['kick'], production: [], character: [] } };
    const model = buildForYou([clip('a', { audio: confirmed, degree: 2 }), clip('kick two', { path: 'kick two.wav', audio: base })], [edge('a', 'kick two', 1)], 'a', null);
    expect(model.tags[0]).toMatchObject({ label: 'kick', basis: 'confirmed' });
    expect(model.tags.filter(t => t.label === 'kick')).toHaveLength(1);
  });
});
