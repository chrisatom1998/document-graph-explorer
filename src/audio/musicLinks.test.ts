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
  it('links tracks that share tags the panel lists, ranked below confirmed matches', () => {
    const tagged = (id: string, tags: { group: 'character' | 'production'; label: string; score: number; model?: 'Trained head' | 'Trained head (maybe)' }[]) =>
      node(id, { soundProfile: { version: 1, character: [], roles: [], disagreement: false, models: [], djTags: tags.map(t => ({ model: 'Trained head', ...t })) } as MusicAnalysis['soundProfile'] });
    const a = tagged('a', [{ group: 'character', label: 'airy', score: .9 }, { group: 'production', label: 'vinyl scratch', score: .8 }]);
    const b = tagged('b', [{ group: 'character', label: 'airy', score: .7 }, { group: 'production', label: 'vinyl scratch', score: .6 }]);
    const [edge] = musicPairEdges(a, b);
    expect(edge).toMatchObject({ kind: 'sound' });
    expect(edge.evidence[0]).toContain('airy (character), vinyl scratch (production / effect)');
    expect(edge.evidence[0]).toContain('Not confirmed by you');
    expect(edge.weight).toBeLessThan(.85);
    // A specific maybe-level effect still links below likely evidence. A lone
    // broad maybe-level character is insufficient without another useful clue.
    const maybe = musicPairEdges(a, tagged('d', [{ group: 'production', label: 'vinyl scratch', score: .9, model: 'Trained head (maybe)' }]))[0];
    expect(maybe.kind).toBe('sound');
    expect(maybe.weight).toBeLessThan(edge.weight);
    // The candidate search finds tag-only pairs too.
    expect(buildMusicEdges([a, b]).map(e => e.kind)).toEqual(['sound']);
  });
  it('links machine source tags the panel lists, but marks them unconfirmed and weaker than confirmed instruments', () => {
    const source = (id: string) => node(id, {
      recognition: createRecognition(100, 'full'),
      instruments: [{ label: 'piano', score: .99, status: 'likely' }],
      soundProfile: { version: 1, character: [], roles: [], disagreement: false, models: [], djTags: [{ group: 'source', label: 'piano', score: .9, model: 'Trained head' }] } as MusicAnalysis['soundProfile'],
    });
    const [edge] = musicPairEdges(source('a'), source('b'));
    expect(edge.kind).toBe('instrument');
    expect(edge.evidence[0]).toContain('model estimates or untested guesses');
    expect(edge.weight).toBeLessThan(.85);
  });
  it('weights listed tag links by origin, not by raw similarity', () => {
    const tagged = (id: string, tags: { group: 'character'; label: string; score: number; model?: 'Trained head' | 'Music CLAP' }[]) =>
      node(id, { soundProfile: { version: 1, character: [], roles: [], disagreement: false, models: [], djTags: tags.map(t => ({ model: 'Trained head' as const, ...t })) } as MusicAnalysis['soundProfile'] });
    const mixed = (id: string) => tagged(id, [{ group: 'character', label: 'airy', score: .51 }, { group: 'character', label: 'airy', score: .95, model: 'Music CLAP' }]);
    const tested = (id: string) => tagged(id, [{ group: 'character', label: 'airy', score: .51 }]);
    expect(musicPairEdges(mixed('a'), mixed('b'))[0].weight).toBe(musicPairEdges(tested('c'), tested('d'))[0].weight);
    expect(musicPairEdges(mixed('a'), mixed('b'))[0].weight).toBeCloseTo(.7);
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
  const estimated = musicPairEdges(a,raw).find(e=>e.kind==='sound')!;
  expect(estimated.weight).toBeLessThan(.85);
  expect(estimated.evidence[0]).toContain('Not confirmed by you');expect(estimated.evidence[0]).toContain('untested model guess');
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

describe('sounds-alike links', () => {
  const unit = (hot: number[]) => { const v = new Array(512).fill(0); hot.forEach((i, k) => { v[i] = 1 - k * .01; }); const n = Math.hypot(...v); return v.map(x => x / n); };
  it('links near-identical audio fingerprints with no shared labels, and leaves unrelated audio alone', () => {
    const a = node('a', { embedding: unit([1, 2, 3]) });
    const b = node('b', { embedding: unit([1, 2, 3, 4]) });
    const c = node('c', { embedding: unit([300, 301, 302]) });
    const edges = buildMusicEdges([a, b, c]).filter(e => e.kind === 'similar');
    expect(edges).toHaveLength(1);
    expect([edges[0].source, edges[0].target].sort()).toEqual(['a', 'b']);
    expect(edges[0].weight).toBeGreaterThan(.8);
    expect(musicPairEdges(a, c)).toEqual([]);
  });
});

describe('links follow the Sounds and Other model guesses lists', () => {
  const guessed = (id: string) => node(id, { soundProfile: { version: 1, character: [], roles: [], disagreement: false, models: [], djTags: [{ group: 'production', label: 'synth bass', score: .3 }, { group: 'character', label: 'rhythmic stabs', score: .3 }, { group: 'source', label: 'synthesizer', score: .3 }] } });
  it('links two sounds that share an untested guess, at a weaker strength than confirmed labels', () => {
    const edges = musicPairEdges(guessed('a'), guessed('b'));
    const sound = edges.find(e => e.kind === 'sound')!;
    expect(sound.evidence[0]).toContain('synth bass (production / effect)');
    expect(sound.evidence[0]).toContain('rhythmic stabs (character)');
    expect(sound.weight).toBeLessThan(.5);
    const instrument = edges.find(e => e.kind === 'instrument')!;
    expect(instrument.evidence[0]).toContain('synthesizer');
    expect(instrument.weight).toBeLessThan(.5);
  });
  it('does not link sounds whose lists share nothing', () => {
    const other = node('c', { soundProfile: { version: 1, character: [], roles: [], disagreement: false, models: [], djTags: [{ group: 'production', label: 'riser', score: .3 }] } });
    expect(musicPairEdges(guessed('a'), other).filter(e => e.kind === 'sound' || e.kind === 'instrument')).toEqual([]);
  });
});

/** Unit vectors around a few distinct directions, with small deterministic noise. */
function fingerprint(group: number, member: number): number[] {
  let seed = group * 7919 + member * 104729 + 1;
  const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - .5; };
  const v = Array.from({ length: 512 }, (_, i) => (Math.floor(i / 64) === group ? 1 : 0) + .6 * noise());
  const n = Math.hypot(...v);
  return v.map(x => x / n);
}
const sounding = (id: string, group: number, member: number, extra: Partial<MusicAnalysis> = {}) => node(id, { embedding: fingerprint(group, member), ...extra });
describe('sound-alike links: reasons and scale', () => {
  it('links tracks that sound alike, explains why, and leaves different sounds apart', () => {
    const nodes = [0, 1, 2].flatMap(g => [0, 1, 2].map(m => sounding(`g${g}m${m}`, g, m)));
    const edges = buildMusicEdges(nodes);
    const similar = edges.filter(e => e.kind === 'similar');
    expect(similar.length).toBeGreaterThan(0);
    for (const e of similar) expect(e.source.slice(0, 2)).toBe(e.target.slice(0, 2));
    expect(similar[0].evidence[0]).toMatch(/^Nearby audio fingerprints \(cosine similarity \d\.\d{2}\)\./);
    expect(buildMusicEdges([...nodes].reverse())).toEqual(edges);
  });
  it('names the tested tags and confirmations both tracks share', () => {
    const tags = { confirmedDjTags: { source: [], production: ['riser'], character: ['metallic'] } };
    const edge = buildMusicEdges([sounding('a', 0, 0, tags), sounding('b', 0, 1, tags), sounding('c', 3, 0)]).find(e => e.kind === 'similar')!;
    expect([edge.source, edge.target]).toEqual(['a', 'b']);
    expect(edge.evidence[0]).toContain('Both also have: riser (production / effect), metallic (character), confirmed by you on both tracks.');
  });
  it('says "some confirmed by you" when a shared tag is confirmed on one track only', () => {
    const tags = { confirmedDjTags: { source: [], production: ['riser'], character: [] } };
    const edge = buildMusicEdges([sounding('a', 0, 0, tags), sounding('b', 0, 1, { soundProfile: { version: 1, character: [], roles: [], disagreement: false, models: [], djTags: [{ group: 'production', label: 'riser', score: .9, model: 'Trained head' }] } })]).find(e => e.kind === 'similar');
    expect(edge!.evidence[0]).toContain('riser (production / effect), some confirmed by you.');
  });
  it('keeps tempo and file-name links between tracks that sound different', () => {
    const beat = { tempo: tempo(120), key: key(0) };
    const nodes = [sounding('a0', 0, 0, beat), sounding('a1', 0, 1), sounding('a2', 0, 2), sounding('b0', 1, 0, beat), sounding('b1', 1, 1), sounding('b2', 1, 2)];
    expect(buildMusicEdges(nodes).filter(e => e.source === 'a0' && e.target === 'b0').map(e => e.kind)).toEqual(['tempo', 'key']);
    const named = buildMusicEdges([{ ...sounding('x', 0, 0), path: 'Drums/Kick 140bpm.wav' }, { ...sounding('y', 1, 0), path: 'Drums/Snare 140bpm.wav' }]);
    expect(named.map(e => e.kind)).toEqual(['tempo']);
  });
  it('keeps each track within its sound-alike budget', () => {
    const nodes = Array.from({ length: 60 }, (_, i) => sounding(String(i).padStart(2, '0'), i % 4, i));
    const edges = buildMusicEdges(nodes);
    for (const n of nodes) expect(edges.filter(e => e.kind === 'similar' && (e.source === n.id || e.target === n.id)).length).toBeLessThanOrEqual(MUSIC_NEIGHBORS_PER_KIND);
  });
  it('stays bounded and deterministic for libraries too large to compare every pair', () => {
    const nodes = Array.from({ length: 1200 }, (_, i) => sounding(String(i).padStart(4, '0'), i % 8, i));
    const started = performance.now();
    const edges = buildMusicEdges(nodes);
    expect(performance.now() - started).toBeLessThan(20000);
    const similar = edges.filter(e => e.kind === 'similar');
    expect(similar.length).toBeGreaterThan(nodes.length / 2);
    for (const e of similar) expect(Number(e.source) % 8).toBe(Number(e.target) % 8);
  });
  it('stays fast when many tracks share one fingerprint', () => {
    const same = fingerprint(0, 0);
    const nodes = Array.from({ length: 3000 }, (_, i) => node(String(i).padStart(4, '0'), { embedding: same }));
    const started = performance.now();
    const similar = buildMusicEdges(nodes).filter(e => e.kind === 'similar');
    expect(performance.now() - started).toBeLessThan(20000);
    expect(similar.length).toBeGreaterThan(0);
  });
});
