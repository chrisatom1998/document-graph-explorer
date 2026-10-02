import { expect, it } from 'vitest';
import { combineSoundModels } from './ensemble';
import { descriptionScores, averageDescriptions, selectDescriptions } from './profileDescriptions';
import { sanitizeSoundProfile } from './soundProfile';
import { sanitizeMusicAnalysis } from './musicTypes';
const complete = { ast: true, jamendo: true, clap: true };
it('retains synth source and separately describes acoustic resemblance', () => {
 const result = combineSoundModels([], { synthesizer: .65 }, [{ group: 'source', label: 'trumpet', score: .6 }, { group: 'source', label: 'synthesizer', score: .3 }], complete);
 expect(result.source).toMatchObject({ label: 'synthesizer', basis: 'MTG-Jamendo', corroborated: false });
 expect(result.resemblance).toBe('trumpet');
});
it('keeps strong AST instruments and openly reports conflicting instrument models', () => {
 const result = combineSoundModels([{ label: 'trumpet', score: .95, status: 'likely' }], { drums: .45 }, [{group:'source',label:'trumpet',score:.6}], complete);
 expect(result.source).toMatchObject({ label: 'trumpet', corroborated: true });expect(result.disagreement).toBe(true);
});
it('does not turn a CLAP resemblance into a confirmed instrument', () => {
 const result = combineSoundModels([], { piano: .25 }, [{ group: 'source', label: 'trumpet', score: .6 }], complete);
 expect(result.source).toBeUndefined();expect(result.resemblance).toBe('trumpet');
});
it('compares separate description groups and abstains on weak, tied or null winners', () => {
 const result = selectDescriptions([
  {group:'role',label:'pad',score:.6},{group:'role',label:'lead',score:.4},
  {group:'tone',label:'bright',score:.6},{group:'tone',label:'warm',score:.59},
  {group:'space',label:'dry',score:.2},{group:'articulation',label:null,score:.8},
  {group:'articulation',label:'sustained',score:.7},
 ]);
 expect(result.roles).toEqual(['pad']);expect(result.character).toEqual([]);
 expect(selectDescriptions(averageDescriptions([[{group:'role',label:'pad',score:.6}],[]])).roles).toEqual(['pad']);
});
it('does not count duplicate prompt entries or correlated excerpts as independent models', () => {
 const repeated = {group:'source' as const,label:'synthesizer',score:.4};
 expect(averageDescriptions([[repeated,repeated],[repeated]])[0].score).toBe(.4);
 const p=combineSoundModels([],{},[repeated],complete);expect(p.source).toBeUndefined();
});
it('handles invalid embeddings without inventing matches', () => {
 expect(descriptionScores([0,0],[{group:'source',label:'piano',vector:[1,0]}])).toEqual([]);
 expect(descriptionScores([1,0],[{group:'source',label:'piano',vector:[0,1]}])[0].score).toBe(0);
});
it('round trips model attribution and removes unsafe or unknown profile fields', () => {
 const profile=combineSoundModels([], {synthesizer:.6}, [{group:'role',label:'pad',score:.5}], {...complete,clap:false});
 const clean=sanitizeSoundProfile({...profile,character:['<script>','airy'],roles:['invented','pad'],models:[...profile.models,{model:'fake',candidates:[]}]});
 expect(clean?.character).toEqual(['airy']);expect(clean?.roles).toEqual(['pad']);expect(clean?.models).toHaveLength(3);
 expect(sanitizeMusicAnalysis({version:2,durationSeconds:4,analyzedSeconds:4,instruments:[],notes:[],soundProfile:profile})?.soundProfile).toEqual(profile);
});
it('uses agreement to retain a substantial AST candidate without promoting graph evidence', () => {
 const ast=[{label:'trumpet',score:.84,status:'possible' as const}];
 const result=combineSoundModels(ast,{drums:.42},[{group:'source',label:'trumpet',score:.6},{group:'source',label:'synthesizer',score:.27}],complete);
 expect(result.source).toMatchObject({label:'trumpet',basis:'AudioSet AST',corroborated:true});
 expect(result.disagreement).toBe(true);expect(ast[0].status).toBe('possible');
});
it('does not use weak or tied CLAP agreement to override an instrument model', () => {
 const ast=[{label:'trumpet',score:.84,status:'possible' as const}];
 for(const scores of [[.34,.2],[.6,.59]]){
  const result=combineSoundModels(ast,{synthesizer:.6},[{group:'source',label:'trumpet',score:scores[0]},{group:'source',label:'synthesizer',score:scores[1]}],complete);
  expect(result.source?.label).toBe('synthesizer');
 }
});
it('retains voice alongside a stronger synthesizer without forcing a vocal style', () => {
 const profile=combineSoundModels([{label:'synthesizer',score:.97,status:'likely'},{label:'voice',score:.9,status:'likely'}],{synthesizer:.8,voice:.7},[],complete);
 expect(profile.source?.label).toBe('synthesizer');
 expect(profile.voice).toEqual({basis:'AudioSet AST',corroborated:true});
 expect(sanitizeSoundProfile(profile)).toEqual(profile);
});
it('accepts Jamendo voice and limits vocal styles to voice detections', () => {
 const descriptions=[{group:'vocal' as const,label:'vocal chops',score:.32},{group:'vocal' as const,label:'singing',score:.25}];
 const profile=combineSoundModels([],{voice:.75},descriptions,complete);
 expect(profile.source?.label).toBe('voice');
 expect(profile.voice?.style).toBe('vocal chops');
 expect(sanitizeSoundProfile(profile)).toEqual(profile);
 expect(combineSoundModels([],{synthesizer:.75,voice:.2},descriptions,complete).voice).toBeUndefined();
});
it('does not turn uncertain voice scores, tied styles or synthetic imitations into vocal chops', () => {
 expect(combineSoundModels([],{voice:.4},[],complete).voice).toBeUndefined();
 for(const competitor of [{label:'singing',score:.49},{label:null,score:.6},{label:'instrumental',score:.6}]){
  const profile=combineSoundModels([],{voice:.75},[{group:'vocal',label:'vocal chops',score:.5},{group:'vocal',...competitor}],complete);
  expect(profile.voice?.style).toBeUndefined();
 }
 const clean=sanitizeSoundProfile({version:1,models:[],voice:{basis:'fake',style:'anything'}});
 expect(clean?.voice).toBeUndefined();
});

it('uses a clear CLAP vocal match for processed voice without changing instrument or graph evidence', () => {
 const ast=[{label:'synthesizer',score:.91,status:'likely' as const}];
 const descriptions=[{group:'vocal' as const,label:'vocal chops',score:.38},{group:'vocal' as const,label:null,score:.21}];
 const profile=combineSoundModels(ast,{synthesizer:.7},descriptions,complete);
 expect(profile.source?.label).toBe('synthesizer');
 expect(profile.voice).toEqual({basis:'Music CLAP',corroborated:false,style:'vocal chops'});
 expect(ast).toHaveLength(1);
 expect(combineSoundModels(ast,{},[{...descriptions[0],score:.34},descriptions[1]],complete).voice).toBeUndefined();
 expect(combineSoundModels(ast,{},[descriptions[0],{...descriptions[1],score:.32}],complete).voice).toBeUndefined();
});
it('promotes a clear sampled-vocal match above an unsupported weak synth guess', () => {
 const descriptions=[{group:'sample' as const,label:'vocal chops',score:.38},{group:'sample' as const,label:'guitar sample',score:.32}];
 const result=combineSoundModels([],{synthesizer:.4,drums:.31},descriptions,complete);
 expect(result.source).toEqual({label:'voice',basis:'Music CLAP',corroborated:false});
 expect(result.voice?.style).toBe('vocal chops');
 expect(result.disagreement).toBe(true);
 expect(result.models.find(m=>m.model==='MTG-Jamendo')?.candidates[0].label).toBe('synthesizer');
 expect(sanitizeMusicAnalysis({version:2,durationSeconds:3,analyzedSeconds:3,instruments:[],notes:[],soundProfile:result})?.soundProfile).toEqual(result);
 for(const score of [.34,.365]){
  expect(combineSoundModels([],{synthesizer:.4},[{...descriptions[0],score},descriptions[1]],complete).source?.label).toBe('synthesizer');
 }
});
it('requires independent support for a second source when vocal chops also occur', () => {
 const descriptions=[{group:'sample' as const,label:'vocal chops',score:.4},{group:'sample' as const,label:'guitar sample',score:.3}];
 expect(combineSoundModels([{label:'synthesizer',score:.9,status:'likely'}],{synthesizer:.4},descriptions,complete).source?.label).toBe('synthesizer');
 expect(combineSoundModels([],{synthesizer:.8},descriptions,complete).source?.label).toBe('voice');
 expect(combineSoundModels([],{synthesizer:.4},[...descriptions,{group:'source',label:'synthesizer',score:.5}],complete).source?.label).toBe('synthesizer');
});
it('rejects instrumental sample matches and synth vowel imitations', () => {
 for(const label of ['guitar sample','piano sample','drum machine',null]){
  expect(selectDescriptions([{group:'sample',label:'vocal chops',score:.4},{group:'sample',label,score:.5}]).vocalSource).toBe(false);
 }
});

it('does not mistake a solo chop for a drum mixture on one tagger alone', () => {
 const descriptions=[{group:'sample' as const,label:'vocal chops',score:.46},{group:'sample' as const,label:'drum machine',score:.3}];
 for (const drums of [.4,.85]) {
  const result=combineSoundModels([],{drums,synthesizer:.32},descriptions,complete);
  expect(result.source?.label).toBe('voice');
  expect(result.voice?.style).toBe('vocal chops');
  expect(result.models.find(m=>m.model==='MTG-Jamendo')?.candidates[0].label).toBe('drum kit');
 }
});
it('retains real drum evidence alongside vocal chops and can choose a supported runner-up', () => {
 const descriptions=[{group:'sample' as const,label:'vocal chops',score:.46},{group:'sample' as const,label:'drum machine',score:.3}];
 const strong=combineSoundModels([{label:'drum kit',score:.91,status:'likely'}],{drums:.7},descriptions,complete);
 expect(strong.source?.label).toBe('drum kit');
 expect(strong.voice?.style).toBe('vocal chops');
 const agreement=combineSoundModels([{label:'drum kit',score:.65,status:'possible'}],{synthesizer:.8,drums:.6},descriptions,complete);
 expect(agreement.source).toEqual({label:'drum kit',basis:'MTG-Jamendo',corroborated:true});
});
it('keeps standalone drums and ambiguous chops from being forced into a vocal label', () => {
 expect(combineSoundModels([],{drums:.8},[],complete).source?.label).toBe('drum kit');
 expect(combineSoundModels([],{drums:.8},[{group:'sample',label:'vocal chops',score:.32}],complete).source?.label).toBe('drum kit');
});
