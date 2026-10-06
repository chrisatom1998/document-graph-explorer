import {beforeEach,expect,it,vi} from 'vitest';
import {FUSION_LABELS,type FusionDecision} from './fusion';
import type {MusicAnalysis} from './musicTypes';

// The fusion release check is covered in fusionPresentation.test.ts; here every window counts as qualified.
const windows:{start:number;end:number;status:'complete';decisions:FusionDecision[]}[]=[];
vi.mock('./fusionPresentation',()=>({fusionPresentation:()=>({qualified:true,windows})}));
const {confidentSoundSummary,FULL_MIX_HEADS,FULL_MIX_HEAD_SCORE,FULL_MIX_MIN_TESTED_SCORE,FULL_MIX_VOICE_VETO}=await import('./confidentSoundSummary');

const decide=(label:string,head:number,source:FusionDecision['source']):FusionDecision=>source==='learned-head'
  ?{label:label as FusionDecision['label'],state:head>=.5?'positive':'uncertain',source,headProbability:head,decisionProbability:head,eligible:true,positiveGroups:3,negativeGroups:4}
  :{label:label as FusionDecision['label'],state:'negative',source,headProbability:head,decisionProbability:null,eligible:false,positiveGroups:0,negativeGroups:0};
const song=(duration:number,scores:Record<string,[number,FusionDecision['source']]>,start=0):MusicAnalysis=>{
  windows.length=0;
  windows.push({start,end:Math.min(start+10,duration),status:'complete',decisions:FUSION_LABELS.map(l=>scores[l]?decide(l,...scores[l]):decide(l,0,'learned-head'))});
  return {version:2,durationSeconds:duration,analyzedSeconds:duration,instruments:[],notes:[]};
};
const shown=(a:MusicAnalysis)=>confidentSoundSummary(a,'full').map(s=>s.label);
beforeEach(()=>{windows.length=0});

it('shows baseline-kept guitar and violin heads at their full-mix thresholds',()=>{
 const g=FULL_MIX_HEADS.guitar,v=FULL_MIX_HEADS.violin;
 const a=confidentSoundSummary(song(10,{guitar:[g,'guarded-binary-baseline'],violin:[v,'guarded-binary-baseline']}),'full');
 expect(a.map(s=>[s.label,s.scores?.[0]])).toEqual([['guitar',{model:FULL_MIX_HEAD_SCORE,score:g}],['violin',{model:FULL_MIX_HEAD_SCORE,score:v}]]);
 expect(shown(song(10,{guitar:[g-.01,'guarded-binary-baseline']}))).toEqual([]);
});
it('leaves heads the release already uses, untested labels, short clips and partial windows alone',()=>{
 // Saxophone did not pass the held-out check, so its head stays hidden.
 expect(shown(song(30,{saxophone:[.99,'guarded-binary-baseline']}))).toEqual([]);
 expect(shown(song(8,{guitar:[.99,'guarded-binary-baseline']}))).toEqual([]);
 expect(shown(song(15,{guitar:[.99,'guarded-binary-baseline']},10))).toEqual([]);
});
it('needs a higher tested score for trumpet and cello on full mixes only',()=>{
 const t=FULL_MIX_MIN_TESTED_SCORE.trumpet,c=FULL_MIX_MIN_TESTED_SCORE.cello;
 expect(shown(song(10,{trumpet:[t-.01,'learned-head'],cello:[c-.01,'learned-head']}))).toEqual([]);
 expect(shown(song(10,{trumpet:[t,'learned-head'],cello:[c,'learned-head']}))).toEqual(['cello','trumpet']);
 // Below one full window the track floor still applies.
 expect(shown(song(6,{cello:[.52,'learned-head']}))).toEqual(['cello']);
 expect(shown(song(10,{cello:[.52,'learned-head']}))).toEqual([]);
});
it('lets the fusion voice head veto other voice estimates on full mixes',()=>{
 const sung=(duration:number,head:number):MusicAnalysis=>({...song(duration,{voice:[head,'learned-head']}),
   soundProfile:{djTags:[{group:'source',label:'voice',model:'Trained head',score:.95}]}} as unknown as MusicAnalysis);
 expect(shown(sung(30,FULL_MIX_VOICE_VETO-.01))).toEqual([]);
 expect(shown(sung(30,FULL_MIX_VOICE_VETO))).toEqual(['voice']);
 // Short clips have no whole window to veto with.
 expect(shown(sung(8,.01))).toEqual(['voice']);
 // A voice the user confirmed is never hidden.
 const confirmed={...sung(30,.01),soundReviews:[{dimension:'source',labelId:'voice',decision:'confirmed'}]} as unknown as MusicAnalysis;
 expect(shown(confirmed)).toEqual(['voice']);
});
