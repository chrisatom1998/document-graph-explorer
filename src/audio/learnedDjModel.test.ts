import { expect, it } from 'vitest';
import { learnedDjScores, sanitizeLearnedDjModel } from './learnedDjModel';
import { selectDjTags, applyReviewedDecisions } from './djTags';
import { combineSoundModels } from './ensemble';
const vector=(axis:number)=>Array.from({length:512},(_,i)=>i===axis?1:0);
const model=()=>sanitizeLearnedDjModel({version:1,encoder:'test',revision:'test',examples:[
 {id:'breath',vector:vector(0),labels:{source:['breath'],production:['vocal breath'],character:[]},knownLabels:['source:breath','production:vocal breath','production:synth lead'],provenance:'explicit human confirmation'},
 {id:'synth',vector:vector(1),labels:{source:[],production:['synth lead'],character:[]},knownLabels:['source:breath','production:vocal breath','production:synth lead'],provenance:'explicit human confirmation'},
]})!;
it('learns labels from reviewed examples and rejects an incorrect base tag on a matching clip',()=>{
 const scores=learnedDjScores(vector(0),model());
 const tags=selectDjTags([...scores,{group:'dj-type',label:'synth lead',score:.7}]);
 expect(tags.map(t=>t.label)).toContain('vocal breath');
 expect(tags.map(t=>t.label)).not.toContain('synth lead');
 expect(tags.every(t=>t.model==='Reviewed examples')).toBe(true);
 const profile=combineSoundModels([],{},[...scores,{group:'dj-type',label:'synth lead',score:.7}],{ast:true,jamendo:true,clap:true});
 expect(profile.source?.label).toBe('breath');
 expect(profile.djTags?.map(t=>t.label)).not.toContain('synth lead');
});
it('abstains on unrelated audio and contradictory annotations',()=>{
 expect(learnedDjScores(vector(2),model())).toEqual([]);
 const conflicting=model();conflicting.examples[1].vector=vector(0);
 expect(learnedDjScores(vector(0),conflicting)).toEqual([]);
});
it('does not treat a newly added category as a negative in earlier reviews',()=>{
 const trained=model();trained.examples[1].knownLabels.push('production:laser');
 expect(learnedDjScores(vector(0),trained).some(s=>s.label==='laser')).toBe(false);
});
it('validates learned assets and ignores labels outside the app catalog',()=>{
  expect(sanitizeLearnedDjModel({version:1,encoder:'x',revision:'x',examples:[{id:'bad',vector:[1]}]})).toBeUndefined();
  const missingProvenance={id:'missing',vector:vector(0),labels:{source:[],production:[],character:[]},knownLabels:[]};
  expect(sanitizeLearnedDjModel({version:1,encoder:'x',revision:'x',examples:[missingProvenance]})).toBeUndefined();
  expect(sanitizeLearnedDjModel({version:1,encoder:'x',revision:'x',examples:[{...missingProvenance,provenance:'assistant review'}]})).toBeUndefined();
  const bad=model();bad.examples[0].vector[0]=Infinity;expect(sanitizeLearnedDjModel(bad)).toBeUndefined();
 expect(applyReviewedDecisions([],[{group:'dj-learned',label:'made-up',score:1,learnedGroup:'production',decision:'include'}])).toEqual([]);
});
it('keeps learned attribution and production labels when saving a collection',async()=>{
 const {sanitizeMusicAnalysis}=await import('./musicTypes');
 const profile=combineSoundModels([],{},learnedDjScores(vector(0),model()),{ast:true,jamendo:true,clap:true});
 const restored=sanitizeMusicAnalysis({version:2,durationSeconds:1,analyzedSeconds:1,instruments:[],notes:[],soundProfile:profile});
 expect(restored?.soundProfile?.source?.basis).toBe('Reviewed examples');
 expect(restored?.soundProfile?.models.find(m=>m.model==='Reviewed examples')?.candidates.map(c=>c.label)).toContain('vocal breath');
 expect(restored?.soundProfile?.djTags?.find(t=>t.label==='vocal breath')?.model).toBe('Reviewed examples');
});

// Trained heads ship without reviewed examples; their tags carry their own name and
// never displace something the user reviewed.
it('adds a trained-head tag under its own name without overriding a reviewed example', async () => {
  const { applyReviewedDecisions } = await import('./djTags');
  const vector = Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0));
  const model = sanitizeLearnedDjModel({ version: 1, encoder: 'e', revision: 'r', examples: [],
    heads: [{ group: 'production', label: 'kick', weights: vector.map(v => v * 6), bias: 0, threshold: .6 }] })!;
  const scores = learnedDjScores(vector, model);
  expect(scores).toEqual([expect.objectContaining({ group: 'dj-learned', label: 'kick', learnedGroup: 'production', decision: 'include', basis: 'head' })]);
  // Below the reviewed-example gate of 0.88 it is still kept, because the head has its own measured threshold.
  const head = { ...scores[0], score: .7 };
  expect(applyReviewedDecisions([], [head])).toEqual([{ group: 'production', label: 'kick', score: .7, model: 'Trained head' }]);
  const reviewed = { group: 'production' as const, label: 'kick', score: .9, model: 'Reviewed examples' as const };
  expect(applyReviewedDecisions([reviewed], [head])).toEqual([reviewed]);
  // A head that stays under its threshold says nothing.
  expect(learnedDjScores(vector.map(v => -v), model)).toEqual([]);
});
it('carries a maybe-level head through to a maybe tag, and rejects a malformed maybe flag', async () => {
  const { applyReviewedDecisions } = await import('./djTags');
  const vector = Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0));
  const head = { group: 'production', label: 'snare', weights: vector.map(v => v * 6), bias: 0, threshold: .6 };
  const model = sanitizeLearnedDjModel({ version: 1, encoder: 'e', revision: 'r', examples: [], heads: [{ ...head, maybe: true }] })!;
  const [score] = learnedDjScores(vector, model);
  expect(score).toMatchObject({ label: 'snare', basis: 'head', maybe: true });
  expect(applyReviewedDecisions([], [score])[0].model).toBe('Trained head (maybe)');
  expect(sanitizeLearnedDjModel({ version: 1, encoder: 'e', revision: 'r', examples: [], heads: [{ ...head, maybe: 'yes' }] })).toBeUndefined();
});
