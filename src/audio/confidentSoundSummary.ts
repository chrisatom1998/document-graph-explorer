import { confirmedInstrumentList, sourceReviewAllows } from './instrumentEvidence';
import { canonicalDjLabel } from './djTags';
import { fusionPresentation } from './fusionPresentation';
import type { MusicAnalysis } from './musicTypes';
import { dimensionLabels, type Dimension } from './recognition';
import { djReviewAllows, latestSoundReview, resolvedNonSourceLabels } from './soundReviewPolicy';

/** Presentation only: does not change stored evidence, acceptance, cache identity or graph links. */
export const SOUND_DISPLAY_POLICY = 'tested-models-only-v1';
export const SOUND_DISPLAY_FLOOR = .5;
export interface DisplaySound { dimension: Dimension; label: string; origin: 'confirmed by you' | 'model estimate'; scores?: {model:string;score:number}[] }
const validScore=(score:unknown):score is number=>typeof score==='number'&&Number.isFinite(score)&&score>=SOUND_DISPLAY_FLOOR&&score<=1;
const profileNames:Record<string,string>={'AudioSet AST':'AST score','MTG-Jamendo':'Jamendo score','Music CLAP':'CLAP similarity','Reviewed examples':'Reviewed-example similarity','Trained head':'Trained head score'};
/** Only these scores come from detectors that passed held-out testing; other models still show under Model scores. */
const TESTED_SCORES=new Set(['Trained head score','Baseline fallback score']);
const nativeNames={ast:'AST score',jamendo:'Jamendo score',clap:'CLAP similarity',rhythm:'Tempo score',tonal:'Key score'};
export function confidentSoundSummary(audio:MusicAnalysis, fusionMode?:string):DisplaySound[] {
  const result=new Map<string,DisplaySound>();
  const confirmed=confirmedInstrumentList(audio);
  const canonical=(dimension:Dimension,label:string)=>dimension==='character'?canonicalDjLabel('character',label)??label:dimension==='effect'?canonicalDjLabel('production',label)??label:label;
  const allowed=(dimension:Dimension,label:string)=>{
    if(dimension==='source')return sourceReviewAllows(audio,label);
    if(dimension==='character')return djReviewAllows(audio,'character',label);
    if(dimension==='effect')return djReviewAllows(audio,'production',label);
    const review=latestSoundReview(audio.soundReviews,dimension,label);return !review||review.decision==='confirmed';
  };
  const human=(dimension:Dimension,raw:string)=>{const label=canonical(dimension,raw);if(allowed(dimension,label))result.set(`${dimension}:${label}`,{dimension,label,origin:'confirmed by you'})};
  for(const label of confirmed??[])human('source',label);
  for(const t of resolvedNonSourceLabels(audio))if(t.source==='confirmed')human(t.group==='character'?'character':'effect',t.label);
  for(const r of audio.soundReviews??[])if(r.decision==='confirmed'&&r.dimension!=='source'&&r.dimension!=='effect'&&r.dimension!=='character')human(r.dimension,r.labelId);
  const estimate=(dimension:Dimension,raw:string,score:unknown,model:string)=>{
    const label=canonical(dimension,raw);
    const supported=dimensionLabels[dimension].includes(label)||(dimension==='effect'&&!!canonicalDjLabel('production',label));
    if(!supported||!validScore(score)||!allowed(dimension,label))return;
    if(dimension==='source'&&confirmed!==undefined)return;
    if(dimension!=='source'&&audio.confirmedDjTags!==undefined)return;
    const key=`${dimension}:${label}`,old=result.get(key);if(old?.origin==='confirmed by you')return;
    const item=old??{dimension,label,origin:'model estimate' as const,scores:[]};
    model=profileNames[model]??model;
    const same=item.scores!.find(s=>s.model===model);if(same)same.score=Math.max(same.score,score);else item.scores!.push({model,score});result.set(key,item);
  };
  // A current observation must reference matching evidence; orphan/historical score rows do not become labels.
  if(audio.recognition){const evidenceById=new Map(audio.recognition.evidence.map(e=>[e.id,e]));for(const observation of audio.recognition.observations){
    if(!['source','effect','character'].includes(observation.dimension))continue;
    for(const id of observation.evidenceIds){const e=evidenceById.get(id);if(e&&e.dimension===observation.dimension&&e.labelId===observation.labelId)estimate(e.dimension,e.labelId,e.score,nativeNames[e.modelId]+(e.derivedFrom?` (${e.derivedFrom.labelId} supports ${e.labelId})`:''));}
  }}else{
    for(const i of audio.instruments)estimate('source',i.label,i.score,'Instrument model');
    if(audio.instrumentPrediction)estimate('source',audio.instrumentPrediction.label,audio.instrumentPrediction.score,audio.instrumentPrediction.model??'Instrument model');
    for(const model of audio.soundProfile?.models??[])for(const candidate of model.candidates)if(dimensionLabels.source.includes(candidate.label))estimate('source',candidate.label,candidate.score,model.model);
  }
  // Profile tags carry their own source-specific display score. Bare character/source strings and AI drafts do not.
  for(const tag of audio.soundProfile?.djTags??[])estimate(tag.group==='source'?'source':tag.group==='character'?'character':'effect',tag.label,tag.score,tag.model??'Sound tag model');
  const fusion=fusionPresentation(audio.fusion,audio.durationSeconds,fusionMode??audio.recognition?.mode??'full');
  if(fusion?.qualified)for(const w of fusion.windows)for(const d of w.decisions)if(d.state!=='unavailable')estimate('source',d.label,d.decisionProbability,`${d.source==='learned-head'?'Trained head':'Baseline fallback'} score${d.state==='positive'?'':' (below policy acceptance)'}`);
  return [...result.values()].filter(s=>s.origin==='confirmed by you'||s.scores?.some(x=>TESTED_SCORES.has(x.model)));
}
