import {expect,it} from 'vitest';
import {filenameSoundFallback} from './filenameSoundFallback';
import {confidentSoundSummary} from './confidentSoundSummary';
import type {MusicAnalysis} from './musicTypes';
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
  a.soundProfile.djTags!.forEach(t=>t.score=.499999);
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
