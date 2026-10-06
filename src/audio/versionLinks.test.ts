import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import { buildVersionEdges, titleRelation, versionRelation, versionTitle } from './versionLinks';
import { computeVersionPrint, VERSION_PRINT_SAMPLE_RATE } from './versionPrint';
import { versionGroup } from '../ui/TrackVersions';
import { buildMusicEdges } from './musicLinks';

const title = (name: string) => versionTitle({ title: name });

describe('version titles', () => {
  it('strips artist, remix notes, key and tempo tags', () => {
    expect(title('Brad Sucks - Dirtbag (Zenboy1955 2021 Remix).mp3')).toEqual({ names: ['dirtbag'], marked: true, artist: 'brad sucks' });
    expect(title('Zenboy1955_-_Dirtbag_2021_remix.mp3')).toMatchObject({ names: ['dirtbag'], marked: true });
    expect(title('Nickillus_-_Bad_Attraction_-_Brad_Sucks_-_Nickillus_remix_2019.mp3').names).toContain('bad attraction');
    expect(title('02. Daft Punk - Around the World [Extended Mix] 121bpm Am.flac')).toEqual({ names: ['around the world'], marked: true, artist: 'daft punk' });
  });

  it('keeps different sample-pack loops apart', () => {
    const action = title('SHADOW_UK1_Melodic_Loop_Action_Dm_140.wav'), action2 = title('SHADOW_UK1_Melodic_Loop_Action2_Dm_140.wav');
    expect(action.names).toEqual(['shadow uk1 melodic loop action']);
    expect(titleRelation(action, action2)).toBeUndefined();
  });

  it('matches the same song across artist-first and title-only names', () => {
    expect(titleRelation(title('sparky_-_Bad_attraction.mp3'), title('Reiswerk_-_Bad_Attraction.mp3'))).toBe('same');
    expect(titleRelation(title('williamberry_-_Dirtbag_(I_am_gone).mp3'), title('Robbero_-_Dirtbag.mp3'))).toBe('contained');
    expect(titleRelation(title('Artist - Love.mp3'), title('Artist - Lovesick.mp3'))).toBeUndefined();
    expect(title('untitled.wav').names).toEqual([]);
    expect(title('Reiswerk_-_Making_me_nervous_feat._brad_sucks.mp3').names).toEqual(['making me nervous']);
    expect(title('SHADOW_UK1_Melodic_Loop_DubSkank_Dm.wav')).toMatchObject({ names: ['shadow uk1 melodic loop dub skank'], marked: false });
  });
});

const RATE = VERSION_PRINT_SAMPLE_RATE;
function tune(notes: number[], transpose = 0, gain = .3): Float32Array {
  const out = new Float32Array(24 * RATE);
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE, note = notes[Math.floor(t / .5) % notes.length] + transpose, hz = 440 * 2 ** ((note - 69) / 12);
    out[i] = gain * (Math.sin(2 * Math.PI * hz * t) + .5 * Math.sin(4 * Math.PI * hz * t) + .4 * Math.sin(2 * Math.PI * hz / 4 * t)) / 2;
  }
  return out;
}
async function track(id: string, name: string, samples: Float32Array, embedding?: number[]): Promise<DocNode> {
  const versionPrint = await computeVersionPrint(async (start, seconds) => samples.slice(Math.round(start * RATE), Math.round((start + seconds) * RATE)), samples.length / RATE);
  return { id, kind: 'document', title: name, path: name, fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: -1, degree: 0, status: 'ok',
    audio: { version: 2, analyzedSeconds: 24, durationSeconds: samples.length / RATE, instruments: [], notes: [], versionPrint, ...(embedding ? { embedding } : {}) } };
}
const A = [62, 65, 69, 67, 65, 64, 62, 60, 62, 69, 72, 70, 69, 67, 65, 64];
const B = [60, 64, 67, 72, 71, 67, 64, 62, 60, 59, 55, 59, 62, 65, 64, 62];
const C = [57, 57, 64, 64, 66, 66, 64, 62, 62, 61, 61, 59, 59, 57, 52, 57];
const vector = (seed: number) => Array.from({ length: 512 }, (_, i) => Math.sin(i * seed + seed));

describe('version links', () => {
  it('links copies of one recording as the same recording and leaves other songs alone', async () => {
    const nodes = [await track('a', 'track-a.wav', tune(A)), await track('b', 'export-final.mp3', tune(A, 0, .1)), await track('c', 'up two.mp3', tune(A, 2)), await track('d', 'other.wav', tune(B))];
    const edges = buildVersionEdges(nodes);
    expect(edges.map(e => e.id).sort()).toEqual(['a->b:version', 'a->c:version', 'b->c:version']);
    expect(edges.every(e => versionRelation(e) === 'duplicate')).toBe(true);
    expect(edges.find(e => e.id === 'a->c:version')!.evidence[0]).toMatch(/pitched up about 2 semitones/);
    expect(versionGroup('a', nodes, edges).map(m => [m.node.id, m.relation])).toEqual([['b', 'duplicate'], ['c', 'duplicate']]);
    // Copies get only their version link, not a pile of matching tempo, key and sound links.
    expect(buildMusicEdges(nodes).filter(e => e.source === 'a' && e.target === 'b').map(e => e.kind)).toEqual(['version']);
  });

  it('groups different songs with one title as other versions when they also sound alike', async () => {
    const v = vector(3), w = v.map((x, i) => x + .25 * Math.cos(i));
    const nodes = [await track('a', 'DJ One - Night Drive (Original Mix).mp3', tune(A), v), await track('b', 'DJ Two - Night Drive (Club Remix).mp3', tune(B), w),
      await track('c', 'DJ Two - Sunrise.mp3', tune(C), w)];
    const edges = buildVersionEdges(nodes);
    expect(edges.map(e => [e.id, versionRelation(e)])).toEqual([['a->b:version', 'remix']]);
    expect(edges[0].evidence[0]).toMatch(/titles match/);
    expect(versionGroup('b', nodes, edges)).toMatchObject([{ node: { id: 'a' }, relation: 'remix' }]);
  });

  it('chains a remix of a copy through the group as another version', async () => {
    const nodes = [await track('a', 'a.wav', tune(A)), await track('b', 'b.wav', tune(A, 0, .1))];
    const edges = [...buildVersionEdges(nodes), { id: 'b->c:version', source: 'b', target: 'c', kind: 'version' as const, weight: .7, evidence: ['Another version of the same song: the titles match.'] }];
    const c = { ...nodes[1], id: 'c', title: 'c.wav' };
    expect(versionGroup('a', [...nodes, c], edges)).toMatchObject([{ node: { id: 'b' }, relation: 'duplicate' }, { node: { id: 'c' }, relation: 'remix', via: { id: 'b' } }]);
  });

  it('checks a title inside a longer title even without version prints', () => {
    const plain = (id: string, name: string): DocNode => ({ id, kind: 'document', title: name, path: name, fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: -1, degree: 0, status: 'ok',
      audio: { version: 2, analyzedSeconds: 10, durationSeconds: 10, instruments: [], notes: [] } });
    const edges = buildVersionEdges([plain('a', 'williamberry_-_Dirtbag_(I_am_gone).mp3'), plain('b', 'Robbero_-_Dirtbag_(Robbero_Remix).mp3'), plain('c', 'Robbero_-_Sunrise.mp3')]);
    expect(edges.map(e => [e.id, versionRelation(e)])).toEqual([['a->b:version', 'remix']]);
  });
});
