import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import type { MusicAnalysis } from './musicTypes';
import { sanitizeMusicAnalysis } from './musicTypes';
import { buildMusicEdges, musicPairEdges } from './musicLinks';
import { instrumentScores } from './instrumentLabels';
import { sanitizeGraphExport } from '../persistence/validateImport';
const node = (id: string, features: Partial<MusicAnalysis> = {}): DocNode => ({ id, title: 'same filename', kind: 'document', fileType: 'audio', wordCount: 0, topics: [], entities: [], keywords: [], degree: 0, cluster: 0, status: 'ok', audio: { version: 2, durationSeconds: 100, analyzedSeconds: 60, instruments: [], notes: [], ...features } });
const tempo = (bpm: number, confidence = 0.9) => ({bpm, confidence});
const key = (tonic: number, mode: 'major' | 'minor' = 'major', strength = 0.9) => ({tonic, mode, strength});
describe('musical relationships', () => {
  it('matches equivalent sharp and flat names while preserving their spelling in explanations', () => {
    const a = { ...node('a'), path: 'Bleacher_D#m.wav' };
    const b = { ...node('b'), path: 'other_Ebm.wav' };
    const edges = musicPairEdges(a, b);
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe('key');
    expect(edges[0].evidence[0]).toContain('D♯ minor and E♭ minor');
    expect(musicPairEdges(a, { ...node('c'), path: 'other_Em.wav' })).toHaveLength(0);
  });
  it('uses saved corrections for links without presenting them as model detections', () => {
    const confirmedInstruments = ['synthesizer'];
    const a = node('a', { confirmedInstruments, instruments: [{ label: 'gong', score: 0.9, status: 'likely' }] });
    const b = node('b', { confirmedInstruments });
    expect(musicPairEdges(a, b)[0].evidence[0]).toContain('Confirmed by you on both tracks');
    expect(musicPairEdges(a, node('c', { instruments: [{ label: 'gong', score: 0.9, status: 'likely' }] }))).toEqual([]);
    const restored = sanitizeMusicAnalysis({ ...a.audio, confirmedInstruments: ['synthesizer', 'synthesizer', 'made up', 12] });
    expect(restored?.confirmedInstruments).toEqual(['synthesizer']);
    expect(restored?.instruments[0].label).toBe('gong');
  });
  it('links close tempos regardless of key or instrument and reports actual BPM', () => {
    const edges = musicPairEdges(node('a',{tempo:tempo(118)}),node('b',{tempo:tempo(121)}));
    expect(edges.map(e=>e.kind)).toEqual(['tempo']);expect(edges[0].evidence[0]).toContain('118.0 and 121.0');
  });
  it('does not conflate half time or uncertain tempo with similar tempo', () => {
    expect(musicPairEdges(node('a',{tempo:tempo(60)}),node('b',{tempo:tempo(120)}))).toHaveLength(0);
    expect(musicPairEdges(node('a',{tempo:tempo(120,0.2)}),node('b',{tempo:tempo(120)}))).toHaveLength(0);
  });
  it('links same, relative, and neighboring keys but not unrelated or uncertain keys', () => {
    const a=node('a',{key:key(0)});
    for(const k of [key(0),key(9,'minor'),key(5),key(7)]) expect(musicPairEdges(a,node('b',{key:k})).map(e=>e.kind)).toEqual(['key']);
    for(const k of [key(6),key(0,'major',0.3)]) expect(musicPairEdges(a,node('b',{key:k}))).toHaveLength(0);
  });
  it('links shared instruments independently and ignores low-score guesses', () => {
    const a=node('a',{instruments:[{label:'piano',score:0.9,status:'likely'}]});
    expect(musicPairEdges(a,node('b',{instruments:[{label:'piano',score:0.8,status:'likely'}]}))[0].kind).toBe('instrument');
    expect(musicPairEdges(a,node('b',{instruments:[{label:'piano',score:0.1,status:'possible'}]}))).toHaveLength(0);
  });
  it('uses independent multi-label scores and excludes generic Music labels', () => {
    const scores=instrumentScores([2,2,20],{'0':'Piano','1':'Drum kit','2':'Music'});
    expect(scores.piano).toBeGreaterThan(0.8);expect(scores['drum kit']).toBeGreaterThan(0.8);expect(scores).not.toHaveProperty('Music');
  });
  it('requires specific reliable instruments rather than weak guesses, families, or older scans', () => {
    const a = node('a', { instruments: [{ label: 'piano', score: 0.9, status: 'likely' }] });
    expect(musicPairEdges(a, node('b', { instruments: [{ label: 'piano', score: 0.7, status: 'possible' }] }))).toEqual([]);
    expect(musicPairEdges(a, node('b', { version: 1, instruments: [{ label: 'piano', score: 0.9 }] }))).toEqual([]);
    const family = { instruments: [{ label: 'brass instrument', score: 0.9, status: 'likely' as const }] };
    expect(musicPairEdges(node('a', family), node('b', family))).toEqual([]);
    expect(musicPairEdges(node('a', { instruments: [{ label: 'cello', score: 0.9, status: 'likely' }] }), node('b', { instruments: [{ label: 'violin / fiddle', score: 0.9, status: 'likely' }] }))).toEqual([]);
  });
  it('does not create synth relationships from matching weak suggestions', () => {
    const instruments = [{ label: 'synthesizer', status: 'possible' as const, score: 0.115 }];
    expect(musicPairEdges(node('a', { instruments }), node('b', { instruments }))).toEqual([]);
  });
  it('never links matching filenames without audio evidence', () => expect(musicPairEdges(node('a'),node('b'))).toEqual([]));
  it('keeps relation types distinct and bounded for large groups', () => {
    const nodes=Array.from({length:40},(_,i)=>node(String(i),{tempo:tempo(120),key:key(0),instruments:[{label:'piano',score:0.9,status:'likely'}]}));
    const edges=buildMusicEdges(nodes);expect(new Set(edges.map(e=>e.kind)).size).toBe(3);
    expect(edges.length).toBeLessThanOrEqual(40*6*3);
    expect(new Set(edges.map(e=>e.id)).size).toBe(edges.length);
  });
  it('round trips feature estimates and typed relationships safely', () => {
    const nodes=[node('a',{key:key(0)}),node('b',{key:key(0)})];
    const exported=sanitizeGraphExport({version:1,nodes,edges:buildMusicEdges(nodes)});
    expect(exported.nodes[0].audio?.key).toEqual(key(0));expect(exported.edges[0].kind).toBe('key');
    expect(sanitizeMusicAnalysis({...nodes[0].audio,tempo:{bpm:Infinity,confidence:1}})?.tempo).toBeUndefined();
    expect(sanitizeMusicAnalysis({...nodes[0].audio,key:{tonic:99,mode:'major',strength:1}})?.key).toBeUndefined();
  });
});
it('does not equate a repeated pitch with a confirmed musical key', () => {
  expect(musicPairEdges(node('a', { detectedPitch: { pitchClass: 2, confidence: 0.95 } }), node('b', { key: key(2, 'minor') }))).toEqual([]);
});

it('uses name tags for relationships while preserving conflicting audio estimates', () => {
  const a = { ...node('a', { tempo: tempo(70), key: key(5, 'minor') }), path: 'Synths/Action_Dm_140.wav' };
  const b = { ...node('b'), path: 'Synths/Other_Dm_140.wav' };
  const edges = musicPairEdges(a, b);
  expect(edges.map(e => e.kind)).toEqual(['tempo', 'key', 'instrument']);
  expect(edges.every(e => e.evidence[0].includes('Name tags are not verified audio detections'))).toBe(true);
  expect(edges[0].evidence[0]).toContain('140.0 and 140.0');
  expect(a.audio?.tempo?.bpm).toBe(70);
  expect(a.audio?.key?.tonic).toBe(5);
});
it('keeps user-confirmed instruments above folder clues', () => {
  const a = { ...node('a', { confirmedInstruments: ['trumpet'] }), path: 'Synths/clip.wav' };
  const b = { ...node('b'), path: 'Synths/other.wav' };
  expect(musicPairEdges(a, b)).toEqual([]);
});
it('links strong voice detections without promoting uncertain vocal guesses', () => {
 const a=node('a',{instruments:[{label:'voice',score:.93,status:'likely'}]});
 const b=node('b',{instruments:[{label:'voice',score:.88,status:'likely'}]});
 expect(musicPairEdges(a,b)[0].evidence[0]).toContain('Shared instruments: voice');
 expect(musicPairEdges(a,node('c',{instruments:[{label:'voice',score:.7,status:'possible'}]}))).toEqual([]);
 expect(sanitizeMusicAnalysis(a.audio)?.instruments[0].label).toBe('voice');
});
