import {expect,it} from 'vitest';
import {filenameSoundFallback} from './filenameSoundFallback';
import {confidentSoundSummary} from './confidentSoundSummary';
import {sanitizeMusicAnalysis,type MusicAnalysis} from './musicTypes';
import {soundMatchLabels} from './soundMatchLabels';
import type {SoundReview} from './recognition';
import {setHiddenSoundTagsShown} from './hiddenSoundTagsSwitch';
import {TAGGER_POLICY,TAGGER_REVISION} from './tagger';
const audio=():MusicAnalysis=>({version:2,durationSeconds:8,analyzedSeconds:8,instruments:[],notes:[]});
const labels=(name:string,a=audio())=>filenameSoundFallback(a,{title:name},confidentSoundSummary(a));
it('uses explicit glass hit semantics with provenance and no invented score',()=>{
  const a=audio(),before=JSON.stringify(a);
  expect(labels('249196_glass_hit.wav',a)).toEqual([{dimension:'effect',label:'glass hit',origin:'From filename'}]);
  expect(JSON.stringify(a)).toBe(before);
});
it('reuses instrument names and catalog aliases, with token boundaries',()=>{
  expect(labels('piano_bright.wav').map(x=>x.label)).toEqual(['piano','bright']);
  expect(labels('reverse_impact.wav').map(x=>x.label)).toEqual(['reverse effect']);
  expect(labels('whitespace_glasshouse_123.wav')).toEqual([]);
});
it('reads the nearest folders without deriving tempo or key from numbers',()=>{
  expect(labels('C:/piano/glass_hit/303_128_C5.wav')).toEqual([
    {dimension:'source',label:'piano',origin:'From folder name'},{dimension:'effect',label:'impact',origin:'From folder name'}]);
  expect(labels('C:/Users/me/303_128_C5.wav')).toEqual([]);
});
it('shows name tags next to audio tags on samples, without repeating a tag the audio already shows',()=>{
  const a=audio();a.soundProfile={version:1,models:[],character:[],roles:[],disagreement:false,djTags:[{group:'source',label:'piano',score:.5,model:'Trained head'},{group:'production',label:'glass hit',score:.5,model:'Trained head'}]};
  expect(labels('flute_piano.wav',a).map(x=>x.label)).toEqual(['flute']);
  const b=audio();b.soundProfile={version:1,models:[],character:[],roles:[],disagreement:false,djTags:[{group:'character',label:'dark',score:.7,model:'Trained head'}]};
  expect(labels('piano_bright.wav',b).map(x=>x.label)).toEqual(['piano','bright']);
});
it('keeps the older narrow fallback for songs: file name only, empty dimensions only, no pack shorthand',()=>{
  const song=(name:string,a=audio())=>{a.durationSeconds=a.analyzedSeconds=240;return filenameSoundFallback(a,{title:name},confidentSoundSummary(a));};
  expect(song('Song_Kck_Snr_Vox.wav')).toEqual([]);
  expect(song('Strings/piano_bright.wav').map(x=>x.label)).toEqual(['piano','bright']);
  const a=audio();a.soundProfile={version:1,models:[],character:[],roles:[],disagreement:false,djTags:[{group:'character',label:'dark',score:.7,model:'Trained head'}]};
  expect(song('piano_bright.wav',a).map(x=>x.label)).toEqual(['piano']);
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
  expect(labels('harmony_vocals.wav').filter(x=>x.dimension==='effect')).toEqual([{dimension:'effect',label:'choir',origin:'From filename'}]);
  expect(labels('acid_bass_loop.wav').filter(x=>x.dimension==='effect')).toEqual([{dimension:'effect',label:'acid synth',origin:'From filename'}]);
});

it('reads pack shorthand, camelCase and plurals',()=>{
  expect(labels('PO_KickHatPerc130-01.wav').map(x=>x.label)).toEqual(['kick','hi-hat','percussion']);
  expect(labels('EMOK3DHit-ClHat01.wav').map(x=>x.label)).toEqual(['impact','hi-hat']);
  expect(labels('Snr_Tight_02.wav').map(x=>x.label)).toEqual(['snare']);
  expect(labels('K02EPiano117D-03.wav').map(x=>x.label)).toEqual(['electric piano']);
  expect(labels('Claps_Big.wav').map(x=>x.label)).toEqual(['clap']);
  expect(labels('Dirty_Reese_140.wav').map(x=>x.label)).toEqual(['gritty','reese bass']);
});
it('lets a folder fill only what the file name and nearer folders left open',()=>{
  expect(labels('Pack/Drums/Kicks/Kick_01.wav')).toEqual([{dimension:'effect',label:'kick',origin:'From filename'}]);
  expect(labels('Pack/Vocals/Chops/Take_03.wav')).toEqual([
    {dimension:'effect',label:'chops',origin:'From folder name'},{dimension:'source',label:'voice',origin:'From folder name'}]);
  expect(labels('Pack/Vocals/Chops/Kick_03.wav').map(x=>x.label)).toEqual(['kick','voice']);
});
it('drops a name tag the tested tagger clearly hears as absent',()=>{
  const tag=TAGGER_POLICY.tags.find(t=>t.tested&&t.label==='kick'&&!t.minSeconds)!;
  const scores=Object.fromEntries(TAGGER_POLICY.tags.map(t=>[t.output,0]));
  const a=audio();a.tagger={revision:TAGGER_REVISION,windows:1,scores:{...scores,[tag.output]:tag.threshold*.05}};
  expect(labels('Kick_01.wav',a)).toEqual([]);
  a.tagger.scores[tag.output]=tag.threshold*.5;
  expect(labels('Kick_01.wav',a).map(x=>x.label)).toEqual(['kick']);
});
it('leaves hidden tags out of name tags when the hidden-tags switch is off',()=>{
  expect(labels('cowbell_hit.wav').map(x=>x.label)).toContain('cowbell');
  setHiddenSoundTagsShown(false);
  try{expect(labels('cowbell_hit.wav').map(x=>x.label)).not.toContain('cowbell');}finally{setHiddenSoundTagsShown(true);}
});
