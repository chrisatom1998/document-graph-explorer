import {expect,it} from 'vitest';
import {sampleLabels,searchSamples,EMPTY_SAMPLE_QUERY} from './sampleSearch';
import {copilotEvidence} from './copilotEvidence';
import {musicEvidence} from '../chat/musicCopilot';
import {sanitizeMusicAnalysis,type MusicAnalysis} from './musicTypes';
import type {DocNode} from '../model/types';
import type {SoundReview} from './recognition';
const node=(decision:SoundReview['decision'],snapshot=false):DocNode=>({id:'review-test',kind:'document',fileType:'audio',title:'distorted riser.wav',topics:[],entities:[],keywords:[],wordCount:0,cluster:0,degree:0,status:'ok',audio:{version:2,durationSeconds:8,analyzedSeconds:8,instruments:[],notes:[],confirmedInstruments:['piano'],...(snapshot?{confirmedDjTags:{source:['piano'],production:['riser'],character:['distorted']}}:{}),soundProfile:{version:1,character:['distorted'],roles:[],disagreement:false,models:[],djTags:[{group:'character',label:'distorted',score:.7},{group:'production',label:'riser',score:.7}]},copilotProperties:{model:'old-draft',tags:{source:[],production:['riser'],character:['distorted']}},soundReviews:['character','effect'].flatMap(dimension=>(['confirmed',decision] as const).map(d=>({dimension:dimension as 'character'|'effect',labelId:dimension==='character'?'distorted':'riser',decision:d,scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'old-run'})))}});
it.each(['rejected','uncertain'] as const)('latest %s effect/character reviews block model, snapshot, AI and filename revival',decision=>{
 for(const snapshot of [false,true]){
  const n=node(decision,snapshot),before=structuredClone(n.audio);
  expect(sampleLabels(n)).toEqual([{label:'piano',source:'confirmed'}]);
  for(const term of ['distorted','riser'])expect(searchSamples([n],{...EMPTY_SAMPLE_QUERY,terms:[term]})).toEqual([]);
  const evidence=copilotEvidence(n,0)!;
  expect(evidence.estimates).toEqual([]);expect(evidence.confirmedTags??[]).not.toContain('distorted');expect(evidence.confirmedTags??[]).not.toContain('riser');
  expect(musicEvidence(n)).not.toMatch(/distorted|riser/);
  expect(evidence.confirmedInstruments).toEqual(['piano']);expect(n.audio).toEqual(before);
 }
});
it('reconfirmation is human evidence across consumers even when fresh machine evidence is absent',()=>{
 const n=node('confirmed',true);n.audio!.soundProfile=undefined;n.audio!.confirmedDjTags=undefined;n.audio!.copilotProperties=undefined;
 n.audio=sanitizeMusicAnalysis(n.audio) as MusicAnalysis;
 for(const label of ['riser','distorted']){
  expect(sampleLabels(n)).toContainEqual({label,source:'confirmed'});
  expect(searchSamples([n],{...EMPTY_SAMPLE_QUERY,terms:[label],confirmedOnly:true})[0].reasons).toContain('Confirmed by you: '+label);
  expect(copilotEvidence(n,0)?.confirmedTags).toContain(label);
  expect(musicEvidence(n)).toContain(label);
 }
 expect(n.audio!.soundReviews).toHaveLength(4);expect(n.audio!.instruments).toEqual([]);
});
it('unreviewed labels keep their original provenance and unrelated dimensions remain independent',()=>{
 const n=node('rejected');n.audio!.soundReviews=[{dimension:'source',labelId:'piano',decision:'rejected',scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'old'}];
 expect(sampleLabels(n)).toContainEqual({label:'distorted',source:'estimated'});
 expect(sampleLabels(n)).toContainEqual({label:'riser',source:'estimated'});
 expect(sampleLabels(n).some(t=>t.label==='piano')).toBe(false);
});
it.each(['rejected','uncertain','confirmed'] as const)('preserves %s precedence after replacing raw analysis and serializing a reload',decision=>{
 const n=node(decision,true),reviews=structuredClone(n.audio!.soundReviews);
 n.audio={...n.audio!,notes:['new run'],instruments:[{label:'guitar',status:'possible',score:.4}],soundReviews:reviews};
 n.audio=sanitizeMusicAnalysis(JSON.parse(JSON.stringify(n.audio)))!;
 for(const label of ['distorted','riser'])expect(sampleLabels(n).find(t=>t.label===label)?.source).toBe(decision==='confirmed'?'confirmed':undefined);
 expect(n.audio.soundReviews).toEqual(reviews);expect(n.audio.instruments).toEqual([{label:'guitar',status:'possible',score:.4}]);
 expect(n.audio.soundProfile?.djTags).toHaveLength(2);
 expect(copilotEvidence(n,0)?.confirmedInstruments).toEqual(['piano']);
});
it('blocks rejected aliases and preserves unrelated filename hints',()=>{
 const n=node('rejected');n.title='distortion upsweep original-demo.wav';
 for(const term of ['distortion','upsweep'])expect(searchSamples([n],{...EMPTY_SAMPLE_QUERY,terms:[term]})).toEqual([]);
 expect(searchSamples([n],{...EMPTY_SAMPLE_QUERY,terms:['original']})).toHaveLength(1);
});
it('honors the pre-existing atmosphere effect and non-catalog character reviews without inventing source corrections',()=>{
 const n=node('rejected');n.audio!.soundProfile!.roles=['atmosphere'];n.audio!.soundReviews=[{dimension:'effect',labelId:'atmosphere',decision:'rejected',scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'old'}];n.title='atmosphere.wav';
 expect(searchSamples([n],{...EMPTY_SAMPLE_QUERY,terms:['atmosphere']})).toEqual([]);
 expect(musicEvidence(n)).not.toContain('atmosphere');
 n.audio!.soundReviews.push({...n.audio!.soundReviews[0],decision:'confirmed'});
 expect(copilotEvidence(n,0)?.confirmedTags).toContain('atmosphere');
});
it('filters stale profile comparison candidates in a projection while preserving their original scores',async()=>{
 const {reviewedSoundProfile}=await import('./soundReviewPolicy');
 const n=node('rejected');n.audio!.soundProfile!.models=[{model:'Reviewed examples',complete:true,candidates:[{label:'riser',score:.95},{label:'distorted',score:.95},{label:'piano',score:.6}]}];
 const raw=structuredClone(n.audio!.soundProfile);
 expect(reviewedSoundProfile(n.audio!)?.models[0].candidates).toEqual([{label:'piano',score:.6}]);
 expect(n.audio!.soundProfile).toEqual(raw);
});
