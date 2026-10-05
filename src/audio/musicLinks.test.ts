import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import type { MusicAnalysis } from './musicTypes';
import { sanitizeMusicAnalysis } from './musicTypes';
import { buildMusicEdges, musicPairEdges, refreshMusicEdges, MUSIC_NEIGHBOR_LIMIT, MUSIC_NEIGHBORS_PER_KIND } from './musicLinks';
import { instrumentScores } from './instrumentLabels';
import { sanitizeGraphExport } from '../persistence/validateImport';
import { createRecognition } from './recognition';
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
  it('labels half time explicitly and excludes uncertain tempo', () => {
    const half = musicPairEdges(node('a',{tempo:tempo(60)}),node('b',{tempo:tempo(120)}));
    expect(half[0].evidence[0]).toContain('Half/double-time');
    expect(half[0].weight).toBeLessThan(musicPairEdges(node('a',{tempo:tempo(120)}),node('b',{tempo:tempo(120)}))[0].weight);
    expect(musicPairEdges(node('a',{tempo:tempo(120,0.2)}),node('b',{tempo:tempo(120)}))).toHaveLength(0);
  });
  it('links same, relative, and neighboring keys but not unrelated or uncertain keys', () => {
    const a=node('a',{key:key(0)});
    for(const k of [key(0),key(9,'minor'),key(5),key(7)]) expect(musicPairEdges(a,node('b',{key:k})).map(e=>e.kind)).toEqual(['key']);
    for(const k of [key(6),key(0,'major',0.3)]) expect(musicPairEdges(a,node('b',{key:k}))).toHaveLength(0);
  });
  it('links tracks that share tags the panel shows as likely, ranked below confirmed matches', () => {
    const tagged = (id: string, tags: { group: 'character' | 'production'; label: string; score: number; model?: 'Trained head' | 'Trained head (maybe)' }[]) =>
      node(id, { soundProfile: { version: 1, character: [], djTags: tags.map(t => ({ model: 'Trained head', ...t })) } as MusicAnalysis['soundProfile'] });
    const a = tagged('a', [{ group: 'character', label: 'airy', score: .9 }, { group: 'production', label: 'vinyl scratch', score: .8 }]);
    const b = tagged('b', [{ group: 'character', label: 'airy', score: .7 }, { group: 'production', label: 'vinyl scratch', score: .6 }]);
    const [edge] = musicPairEdges(a, b);
    expect(edge).toMatchObject({ kind: 'sound' });
    expect(edge.evidence[0]).toContain('Shared sound tags: airy, vinyl scratch (model estimates shown as likely on both tracks)');
    expect(edge.weight).toBeLessThan(.85);
    // More shared tags rank higher; a maybe-level head or a possible-tier score never links.
    expect(edge.weight).toBeGreaterThan(musicPairEdges(a, tagged('c', [{ group: 'character', label: 'airy', score: .7 }]))[0].weight);
    expect(musicPairEdges(a, tagged('d', [{ group: 'character', label: 'airy', score: .9, model: 'Trained head (maybe)' }]))).toEqual([]);
    expect(musicPairEdges(a, tagged('e', [{ group: 'character', label: 'airy', score: .45 }]))).toEqual([]);
    // The candidate search finds tag-only pairs too.
    expect(buildMusicEdges([a, b]).map(e => e.kind)).toEqual(['sound']);
  });
  it('does not create graph edges from unconfirmed machine source tags', () => {
    const source = (id: string) => node(id, {
      recognition: createRecognition(100, 'full'),
      instruments: [{ label: 'piano', score: .99, status: 'likely' }],
      soundProfile: { version: 1, character: [], djTags: [{ group: 'source', label: 'piano', score: .9, model: 'Trained head' }] } as MusicAnalysis['soundProfile'],
    });
    expect(musicPairEdges(source('a'), source('b'))).toEqual([]);
  });
  it('weights likely tag links by the tested detector, not raw similarity', () => {
    const tagged = (id: string, tags: { group: 'character'; label: string; score: number; model?: 'Trained head' | 'Music CLAP' }[]) =>
      node(id, { soundProfile: { version: 1, character: [], djTags: tags.map(t => ({ model: 'Trained head' as const, ...t })) } as MusicAnalysis['soundProfile'] });
    const mixed = (id: string) => tagged(id, [{ group: 'character', label: 'airy', score: .51 }, { group: 'character', label: 'airy', score: .95, model: 'Music CLAP' }]);
    const tested = (id: string) => tagged(id, [{ group: 'character', label: 'airy', score: .51 }]);
    expect(musicPairEdges(mixed('a'), mixed('b'))[0].weight).toBe(musicPairEdges(tested('c'), tested('d'))[0].weight);
    expect(musicPairEdges(mixed('a'), mixed('b'))[0].weight).toBeCloseTo(.55 * .51);
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
it('keeps name-derived instrument links after an unsure machine-label review', () => {
  const review = { dimension: 'source' as const, labelId: 'oboe', decision: 'uncertain' as const, scope: 'track' as const, at: '2026-10-03T00:00:00Z', evidenceRunId: 'run' };
  const a = { ...node('a', { soundReviews: [review] }), path: 'Piano Loop.wav' };
  const b = { ...node('b'), path: 'Piano Hit.wav' };
  const edges = musicPairEdges(a, b);
  expect(edges.map(e => e.kind)).toContain('instrument');
  expect(edges.find(e => e.kind === 'instrument')?.evidence[0]).toContain('piano');
});
it('links strong voice detections without promoting uncertain vocal guesses', () => {
 const a=node('a',{instruments:[{label:'voice',score:.93,status:'likely'}]});
 const b=node('b',{instruments:[{label:'voice',score:.88,status:'likely'}]});
 expect(musicPairEdges(a,b)[0].evidence[0]).toContain('Shared instruments: voice');
 expect(musicPairEdges(a,node('c',{instruments:[{label:'voice',score:.7,status:'possible'}]}))).toEqual([]);
 expect(sanitizeMusicAnalysis(a.audio)?.instruments[0].label).toBe('voice');
});
it('does not restore an explicitly rejected or uncertain source through filename hints',()=>{
 for(const decision of ['rejected','uncertain'] as const) {
  const a={...node('a',{soundReviews:[{dimension:'source',labelId:'piano',decision,scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'r'}]}),path:'piano.wav'};
  expect(musicPairEdges(a,{...node('b'),path:'piano.wav'}).filter(e=>e.kind==='instrument')).toEqual([]);
 }
});
it('uses explicit DJ corrections over filename hints and raw instrument guesses',()=>{
 const a={...node('a',{confirmedDjTags:{source:[],production:[],character:[]},instruments:[{label:'piano',score:.99,status:'likely'}]}),path:'piano.wav'};
 const b={...node('b'),path:'piano.wav'};
 expect(musicPairEdges(a,b).filter(edge=>edge.kind==='instrument')).toEqual([]);
 const confirmed={...node('confirmed',{confirmedDjTags:{source:['piano'],production:[],character:[]}}),path:'synth.wav'};
 expect(musicPairEdges(confirmed,node('other',{confirmedDjTags:{source:['piano'],production:[],character:[]}})).find(edge=>edge.kind==='instrument')?.evidence[0]).toContain('Confirmed by you on both tracks');
});

const reviewed = (production: string[] = [], character: string[] = []) => ({ source: [], production, character });
it('matches reviewed effects and character without matching unsupported or unknown properties', () => {
  const a = node('a', { confirmedDjTags: reviewed(['riser'], ['metallic']) });
  const b = node('b', { confirmedDjTags: reviewed(['riser'], ['metallic']) });
  const edge = musicPairEdges(a,b).find(e=>e.kind==='sound')!;
  expect(edge.evidence[0]).toContain('riser (production / effect)');
  expect(edge.evidence[0]).toContain('metallic (character)');
  expect(musicPairEdges(a,node('unknown'))).toEqual([]);
  expect(musicPairEdges(a,node('different',{confirmedDjTags:reviewed(['impact'],['warm'])}))).toEqual([]);
  const raw = node('raw',{soundProfile:{version:1,character:['metallic'],roles:[],disagreement:false,models:[],djTags:[{group:'production',label:'riser',score:.99}]}});
  expect(musicPairEdges(a,raw)).toEqual([]);
});
it('latest rejected and unsure reviews invalidate links and confirmation restores them', () => {
  const a = node('a', { confirmedDjTags: reviewed([], ['metallic']) });
  const b = node('b', { confirmedDjTags: reviewed([], ['metallic']) });
  const initial = buildMusicEdges([a,b]);
  expect(initial).toHaveLength(1);
  for(const decision of ['rejected','uncertain'] as const) {
    const review = {dimension:'character' as const,labelId:'metallic',decision,scope:'track' as const,at:'2026-10-04T00:00:00Z',evidenceRunId:'r'};
    const changed = {...a,audio:{...a.audio!,soundReviews:[review]}};
    expect(refreshMusicEdges([changed,b],initial)).toEqual([]);
    expect(refreshMusicEdges([{...changed,audio:{...changed.audio,soundReviews:[review,{...review,decision:'confirmed'}]}},b],initial)).toHaveLength(1);
  }
});
it('preserves document and authored edges and de-duplicates refreshes', () => {
  const a=node('a',{tempo:tempo(120)}); const b=node('b',{tempo:tempo(120)});
  const doc={...node('doc'),fileType:'txt' as const,audio:undefined};
  const manual={id:'manual',source:'a',target:'b',kind:'reference' as const,authored:true,weight:1,evidence:['mine']};
  const semantic={id:'semantic',source:'a',target:'doc',kind:'semantic' as const,weight:.8,evidence:[]};
  const edges=refreshMusicEdges([a,b,doc],[manual,semantic]);
  expect(refreshMusicEdges([a,b,doc],edges)).toEqual(edges);
  expect(edges).toContain(manual); expect(edges).toContain(semantic);
  expect(edges.filter(e=>e.kind==='tempo')).toHaveLength(1);
});
it('bounds both endpoints, keeps ordering deterministic, and handles tiny buckets', () => {
  const nodes=Array.from({length:120},(_,i)=>node(String(i),{tempo:tempo(120),key:key(i%12),confirmedInstruments:['piano'],confirmedDjTags:reviewed([],['metallic'])}));
  const edges=buildMusicEdges(nodes);
  expect(buildMusicEdges([...nodes].reverse())).toEqual(edges);
  for(const n of nodes) {
    const incident=edges.filter(e=>e.source===n.id||e.target===n.id);
    expect(new Set(incident.map(e=>e.source===n.id?e.target:e.source)).size).toBeLessThanOrEqual(MUSIC_NEIGHBOR_LIMIT);
    for(const kind of ['tempo','key','instrument','sound']) expect(incident.filter(e=>e.kind===kind).length).toBeLessThanOrEqual(MUSIC_NEIGHBORS_PER_KIND);
  }
  expect(buildMusicEdges([nodes[0]])).toEqual([]);
  expect(buildMusicEdges(nodes.slice(0,2)).length).toBeGreaterThan(0);
});
it('weights audio confidence and name hints below reviewed instruments', () => {
  const named={...node('named'),path:'Piano.wav'};
  const confirmed=node('confirmed',{confirmedInstruments:['piano']});
  expect(musicPairEdges(named,confirmed)[0].weight).toBe(.45);
  expect(musicPairEdges(named,confirmed)[0].evidence[0]).toContain('instrument hints');
  expect(musicPairEdges(node('a',{tempo:tempo(120,.5)}),node('b',{tempo:tempo(120,.9)}))[0].weight).toBe(.5);
  for(const bad of [NaN,Infinity,0,-120]) expect(musicPairEdges(node('a',{tempo:tempo(bad)}),node('b',{tempo:tempo(bad)}))).toEqual([]);
});
it('round trips reviewed sound relationships and prevents stale imported edges', () => {
 const nodes=[node('a',{confirmedDjTags:reviewed([],['metallic'])}),node('b',{confirmedDjTags:reviewed([],['metallic'])})];
 const restored=sanitizeGraphExport(JSON.parse(JSON.stringify({version:1,nodes,edges:buildMusicEdges(nodes)})));
 expect(restored.edges[0].kind).toBe('sound');
 expect(refreshMusicEdges(restored.nodes,restored.edges)).toEqual(restored.edges);
});
