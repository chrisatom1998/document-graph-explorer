import {expect,it} from 'vitest';
import {filenameSoundFallback} from './filenameSoundFallback';
import {confidentSoundSummary} from './confidentSoundSummary';
import {sanitizeMusicAnalysis,type MusicAnalysis} from './musicTypes';
import {soundMatchLabels} from './soundMatchLabels';
import type {SoundReview} from './recognition';
const audio=():MusicAnalysis=>({version:2,durationSeconds:8,analyzedSeconds:8,instruments:[],notes:[]});
const labels=(name:string,a=audio())=>filenameSoundFallback(a,{title:name},confidentSoundSummary(a));
it('uses explicit glass hit semantics with provenance and no invented score',()=>{
  const a=audio(),before=JSON.stringify(a);
  expect(labels('249196_glass_hit.wav',a)).toEqual([{dimension:'effect',label:'glass hit',origin:'From filename'}]);
  expect(JSON.stringify(a)).toBe(before);
});
it('reuses instrument names and catalog aliases, with token boundaries',()=>{
  expect(labels('piano_bright.wav').map(x=>x.label)).toEqual(['piano','bright']);
  expect(labels('reverse_impact.wav').map(x=>x.label)).toEqual(['reverse impact']);
  expect(labels('whitespace_glasshouse_123.wav')).toEqual([]);
});
it('ignores folders and numeric IDs, without deriving tempo or key',()=>{
  expect(labels('C:/piano/glass_hit/303_128_C5.wav')).toEqual([]);
});
it('keeps the inclusive audio floor and does not contradict audio sources',()=>{
  const a=audio();a.soundProfile={version:1,models:[],character:[],roles:[],disagreement:false,djTags:[{group:'source',label:'piano',score:.5,model:'Trained head'},{group:'production',label:'glass hit',score:.5,model:'Trained head'}]};
  expect(labels('flute_glass_hit.wav',a)).toEqual([]);
  a.soundProfile.djTags!.forEach(t=>t.score=.399999);
  expect(labels('flute_glass_hit.wav',a).map(x=>x.label)).toEqual(['flute','glass hit']);
});
it('only fills missing dimensions',()=>{
  const a=audio();a.soundProfile={version:1,models:[],character:[],roles:[],disagreement:false,djTags:[{group:'character',label:'dark',score:.7,model:'Trained head'}]};
  expect(labels('piano_bright.wav',a).map(x=>x.label)).toEqual(['piano']);
});
it.each(['rejected','uncertain'] as const)('respects latest %s source and effect reviews',decision=>{
  const a=audio();a.soundReviews=[{dimension:'source',labelId:'piano',decision,scope:'track',evidenceRunId:'qa',at:'2026-10-04T00:00:00Z'},{dimension:'effect',labelId:'impact',decision,scope:'track',evidenceRunId:'qa',at:'2026-10-04T00:00:00Z'}];
  expect(labels('piano_glass_hit.wav',a)).toEqual([]);
});
it('respects empty correction snapshots',()=>{
  const a=audio();a.confirmedDjTags={source:[],production:[],character:[]};
  expect(labels('piano_glass_hit_bright.wav',a)).toEqual([]);
});

const review=(dimension:SoundReview['dimension'],labelId:string,decision:SoundReview['decision']):SoundReview=>({dimension,labelId,decision,scope:'track',evidenceRunId:'qa',at:'2026-10-07T00:00:00Z'});
it.each(['cymbal','cymbal hit'])('keeps the latest effect confirmation %s in one dimension even when the filename names its source alias',label=>{
  const a=audio();a.soundReviews=[review('source','cymbals','confirmed'),review('effect',label,'confirmed')];
  for(const current of [a,sanitizeMusicAnalysis(a)!]){
    expect(confidentSoundSummary(current)).toEqual([{dimension:'effect',label:'cymbal',origin:'confirmed by you'}]);
    expect.soft(labels('Cymbal.wav',current)).toEqual([]);
    expect(soundMatchLabels({title:'Cymbal.wav',audio:current})).toEqual([{group:'production',label:'cymbal',origin:'confirmed',weight:.85}]);
  }
});
it.each(['cymbal','cymbals'])('keeps the latest source confirmation %s without adding its effect alias from the filename',label=>{
  const a=audio();a.soundReviews=[review('effect','cymbal','confirmed'),review('source',label,'confirmed')];
  for(const current of [a,sanitizeMusicAnalysis(a)!]){
    expect(confidentSoundSummary(current)).toEqual([{dimension:'source',label,origin:'confirmed by you'}]);
    expect(labels('Cymbal.wav',current)).toEqual([]);
    expect(soundMatchLabels({title:'Cymbal.wav',audio:current})).toEqual([{group:'source',label,origin:'confirmed',weight:.85}]);
  }
});
it.each(['rejected','uncertain'] as const)('keeps a latest effect %s authoritative over source filename hints',decision=>{
  const a=audio();a.soundReviews=[review('source','cymbals','confirmed'),review('effect','cymbal hit',decision)];
  for(const current of [a,sanitizeMusicAnalysis(a)!]){
    expect(labels('Cymbal.wav',current)).toEqual([]);
    expect(soundMatchLabels({title:'Cymbal.wav',audio:current})).toEqual([]);
  }
});
it('preserves unrelated filename source and character hints after an effect-alias confirmation',()=>{
  const a=audio();a.soundReviews=[review('effect','cymbal','confirmed')];
  for(const current of [a,sanitizeMusicAnalysis(a)!])expect(labels('Cymbal_Piano_Bright.wav',current)).toEqual([
    {dimension:'source',label:'piano',origin:'From filename'},
    {dimension:'character',label:'bright',origin:'From filename'},
  ]);
});
it('names merged look-alike tags by their surviving label and group',()=>{
  expect(labels('big_downlifter.wav')).toEqual([{dimension:'character',label:'falling',origin:'From filename'}]);
  expect(labels('synth_stab_01.wav').filter(x=>x.dimension!=='source')).toEqual([{dimension:'effect',label:'synth hit',origin:'From filename'}]);
  expect(soundMatchLabels({title:'downlifter.wav',audio:audio()}).map(t=>t.label)).toEqual(['falling']);
  expect(labels('turntable.wav')).toEqual([{dimension:'effect',label:'vinyl scratch',origin:'From filename'}]);
});
