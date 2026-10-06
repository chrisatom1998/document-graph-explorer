import { confirmedInstrumentList, sourceReviewAllows } from './instrumentEvidence';
import { canonicalDjLabel } from './djTags';
import { fusionPresentation } from './fusionPresentation';
import type { MusicAnalysis } from './musicTypes';
import { dimensionLabels, type Dimension } from './recognition';
import { SHORT_CLIP_MAX_SECONDS } from './shortClipModel';
import calibratedLabelList from './calibratedLabels.json';
import unverifiedBlocked from './unverifiedBlocked.json';
import { djReviewAllows, latestSoundReview, resolvedNonSourceLabels } from './soundReviewPolicy';
import { FULL_MIX_FAMILY, FULL_MIX_REVISION } from './fullMixHeads';

/** Display policy: does not change stored evidence, acceptance or cache identity. Graph links read these tags (soundMatchLabels,
 * musicLinks), so a display change also changes which instrument links a track can form, by design. */
export const SOUND_DISPLAY_POLICY = 'tested-models-tiers-v3';
/** A detector score at or above this shows as "likely" (and is the only floor for short clips). */
export const LIKELY_SOUND_CUTOFF = .5;
/** Longer recordings also show "possible" tags from this raw score up to the likely cutoff. Scores are not calibrated probabilities. */
export const TRACK_SOUND_FLOOR = .4;
/** @deprecated kept for older callers: the likely cutoff. */
export const SOUND_DISPLAY_FLOOR = LIKELY_SOUND_CUTOFF;
export type SoundTier = 'likely' | 'possible';
export interface DisplaySound { dimension: Dimension; label: string; origin: 'confirmed by you' | 'model estimate'; scores?: {model:string;score:number}[]; /** Only maybe-level detectors back it. */ maybe?: boolean; /** Model estimates only: possible = best tested score between the track floor and the likely cutoff. */ tier?: SoundTier;
  /** No tested detector exists for this label: shown from the raw CLAP catalog similarity (>= the track floor, after
   * the catalog's own margin check), always as "possible", on recordings longer than one-shots only. */
  uncalibrated?: boolean }
/** Labels that have a held-out-tested detector (learned.json / short-clip.json); kept in sync by add-maybe-heads.py and a test. */
export const CALIBRATED_LABELS: ReadonlySet<string> = new Set(calibratedLabelList as string[]);
/** Raw-CLAP fallback floor. Measured on 9,000 clips: at 0.40 only 23% of fallback tags agreed with the clip's own
 * labels, at 0.50 41% (docs/evaluations/open-vocab-2026-10-05/unverified-fallback-cost.json), so the floor is raised. */
export const UNVERIFIED_SOUND_FLOOR = .5;
/** Labels whose fallback tags were measured as almost always wrong (>= 15 firings, < 10% agreement): never shown. */
export const UNVERIFIED_BLOCKED: ReadonlySet<string> = new Set(unverifiedBlocked.blocked);
/** One-shots (≤ SHORT_CLIP_MAX_SECONDS) keep the 0.50 rule; longer audio uses the 0.40 floor. */
export const soundDisplayFloor=(durationSeconds:number|undefined)=>Number.isFinite(durationSeconds)&&durationSeconds!>SHORT_CLIP_MAX_SECONDS?TRACK_SOUND_FLOOR:LIKELY_SOUND_CUTOFF;
export const soundTier=(score:number):SoundTier=>score>=LIKELY_SOUND_CUTOFF?'likely':'possible';
const profileNames:Record<string,string>={'AudioSet AST':'AST score','MTG-Jamendo':'Jamendo score','Music CLAP':'CLAP similarity','Reviewed examples':'Reviewed-example similarity','Trained head':'Trained head score','Trained head (maybe)':'Trained head score (maybe)'};
/** Only these scores come from detectors that passed held-out testing; other models still show under Model scores. */
export const TESTED_SCORES=new Set(['Trained head score','Baseline fallback score']);
const MAYBE_SCORE='Trained head score (maybe)';
/** Jamendo (music-trained) window scores that passed a held-out full-mix check: thresholds were picked on half the
 * frozen OpenMIC test selection and checked on the other half (scripts/calibrate-full-mix-jamendo.py). Only recordings of at
 * least one full ten-second window qualify; shorter loops and one-shots were never measured. */
export const FULL_MIX_JAMENDO_SCORE='Jamendo score (tested on full mixes)';
export const FULL_MIX_MIN_SECONDS=10;
export const FULL_MIX_JAMENDO:Record<string,{label:string;threshold:number}>={
  synthesizer:{label:'synthesizer',threshold:.4},
  'drum kit':{label:'drums',threshold:.4},
  'drum machine':{label:'drums',threshold:.4},
};
TESTED_SCORES.add(FULL_MIX_JAMENDO_SCORE);
/** OpenMIC fusion heads that the accepted release keeps on its Jamendo baseline (no decision probability, so never
 * shown) but whose own head probability passed a held-out full-mix check: thresholds picked on half of the 900 OpenMIC
 * calibration clips and checked on the other half (scripts/dj-fix/calibrate.py). Whole ten-second windows only. */
export const FULL_MIX_HEAD_SCORE='Trained head score (tested on full mixes)';
export const FULL_MIX_HEADS:Record<string,number>={guitar:.4,violin:.4};
TESTED_SCORES.add(FULL_MIX_HEAD_SCORE);
/** On full mixes, the window fusion voice head vetoes other voice estimates when every complete 10 s window is below
 *  this (OpenMIC calibration: voice-present clips all >= 0.33; CLAP head showed voice on instrumental pads at < 0.12). */
export const FULL_MIX_VOICE_VETO=.1;
/** On recordings of at least one full window, these labels need a higher tested score than the track floor: their
 * false alarms on full mixes were measured the same way (scripts/dj-fix/calibrate.py). */
export const FULL_MIX_MIN_TESTED_SCORE:Record<string,number>={trumpet:.5,cello:.55};
/** Full-mix instrument heads (src/audio/fullMixHeads.ts), fitted on 10 s OpenMIC train windows and thresholded on
 * artist-held-out folds. Their stored score maps each head's own threshold to the likely cutoff (0.5). */
export const OPENMIC_HEAD_SCORE='Full-mix head score';
TESTED_SCORES.add(OPENMIC_HEAD_SCORE);
const nativeNames={ast:'AST score',jamendo:'Jamendo score',clap:'CLAP similarity',rhythm:'Tempo score',tonal:'Key score'};
export function confidentSoundSummary(audio:MusicAnalysis, fusionMode?:string):DisplaySound[] {
  const result=new Map<string,DisplaySound>();
  const floor=soundDisplayFloor(audio.durationSeconds);
  const validScore=(score:unknown):score is number=>typeof score==='number'&&Number.isFinite(score)&&score>=floor&&score<=1;
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
  const fullMix=Number.isFinite(audio.durationSeconds)&&audio.durationSeconds>=FULL_MIX_MIN_SECONDS;
  if(audio.recognition){const evidenceById=new Map(audio.recognition.evidence.map(e=>[e.id,e]));for(const observation of audio.recognition.observations){
    if(!['source','effect','character'].includes(observation.dimension))continue;
    for(const id of observation.evidenceIds){const e=evidenceById.get(id);if(!e||e.dimension!==observation.dimension||e.labelId!==observation.labelId)continue;
      estimate(e.dimension,e.labelId,e.score,nativeNames[e.modelId]+(e.derivedFrom?` (${e.derivedFrom.labelId} supports ${e.labelId})`:''));
      // Calibrated on whole 10 s windows only: a shorter (e.g. imported) row is not promoted.
      const rule=fullMix&&e.modelId==='jamendo'&&e.dimension==='source'&&e.end-e.start>=FULL_MIX_MIN_SECONDS-1e-6?FULL_MIX_JAMENDO[e.labelId]:undefined;
      if(rule&&e.score>=rule.threshold)estimate('source',rule.label,e.score,FULL_MIX_JAMENDO_SCORE);}
  }}else{
    for(const i of audio.instruments)estimate('source',i.label,i.score,'Instrument model');
    if(audio.instrumentPrediction)estimate('source',audio.instrumentPrediction.label,audio.instrumentPrediction.score,audio.instrumentPrediction.model??'Instrument model');
    for(const model of audio.soundProfile?.models??[])for(const candidate of model.candidates)if(dimensionLabels.source.includes(candidate.label))estimate('source',candidate.label,candidate.score,model.model);
  }
  // Only a complete sound scan: a partial one could hide (bass) evidence from windows the heads never scored.
  const heads=fullMix&&FULL_MIX_REVISION&&audio.instrumentScan?.complete&&audio.fullMix?.revision===FULL_MIX_REVISION?audio.fullMix:undefined;
  if(heads)for(const l of heads.labels)estimate('source',l.label,l.score,OPENMIC_HEAD_SCORE);
  // Profile tags carry their own source-specific display score. Bare character/source strings and AI drafts do not.
  const catalogClap=new Set<string>();
  for(const tag of audio.soundProfile?.djTags??[]){const dim:Dimension=tag.group==='source'?'source':tag.group==='character'?'character':'effect';if(tag.model==='Music CLAP')catalogClap.add(`${dim}:${canonical(dim,tag.label)}`);}
  for(const tag of audio.soundProfile?.djTags??[])estimate(tag.group==='source'?'source':tag.group==='character'?'character':'effect',tag.label,tag.score,tag.model??'Sound tag model');
  const fusion=fusionPresentation(audio.fusion,audio.durationSeconds,fusionMode??audio.recognition?.mode??'full');
  if(fusion?.qualified)for(const w of fusion.windows)for(const d of w.decisions){
    if(d.state!=='unavailable')estimate('source',d.label,d.decisionProbability,`${d.source==='learned-head'?'Trained head':'Baseline fallback'} score${d.state==='positive'?'':' (below policy acceptance)'}`);
    const head=FULL_MIX_HEADS[d.label];
    if(fullMix&&head!==undefined&&w.status==='complete'&&w.end-w.start>=FULL_MIX_MIN_SECONDS-1e-6&&d.source!=='learned-head'&&typeof d.headProbability==='number'&&d.headProbability>=head)estimate('source',d.label,d.headProbability,FULL_MIX_HEAD_SCORE);
  }
  // A head that replaces the other models for its instrument: only its own score stands for that instrument.
  if(heads)for(const label of heads.decides)for(const name of FULL_MIX_FAMILY[label]??[label]){
    const key=`source:${name}`,item=result.get(key);if(item?.origin!=='model estimate')continue;
    const own=item.scores!.filter(x=>x.model===OPENMIC_HEAD_SCORE);if(own.length)item.scores=own;else result.delete(key);}
  const tiered=(s:DisplaySound,models:(m:string)=>boolean):DisplaySound=>({...s,tier:soundTier(Math.max(...s.scores!.filter(x=>models(x.model)).map(x=>x.score)))});
  const long=floor===TRACK_SOUND_FLOOR;
  const voiceHeads=fullMix&&fusion?.qualified?fusion.windows.filter(w=>w.status==='complete'&&w.end-w.start>=FULL_MIX_MIN_SECONDS-1e-6)
    .flatMap(w=>w.decisions.filter(d=>d.label==='voice'&&typeof d.headProbability==='number').map(d=>d.headProbability as number)):[];
  if(voiceHeads.length&&Math.max(...voiceHeads)<FULL_MIX_VOICE_VETO&&result.get('source:voice')?.origin==='model estimate')result.delete('source:voice');
  const testedBest=(s:DisplaySound)=>Math.max(...s.scores!.filter(x=>TESTED_SCORES.has(x.model)).map(x=>x.score));
  const raised=(s:DisplaySound)=>fullMix&&s.dimension==='source'&&FULL_MIX_MIN_TESTED_SCORE[s.label]!==undefined&&testedBest(s)<FULL_MIX_MIN_TESTED_SCORE[s.label];
  return [...result.values()].flatMap(s=>s.origin==='confirmed by you'?[s]
    :s.scores?.some(x=>TESTED_SCORES.has(x.model))?raised(s)?[]:[tiered(s,m=>TESTED_SCORES.has(m))]
    :s.scores?.some(x=>x.model===MAYBE_SCORE)?[{...tiered(s,m=>m===MAYBE_SCORE),maybe:true}]
    :long&&!CALIBRATED_LABELS.has(s.label)&&!UNVERIFIED_BLOCKED.has(s.label)&&catalogClap.has(`${s.dimension}:${s.label}`)&&s.scores?.some(x=>x.model==='CLAP similarity'&&x.score>=UNVERIFIED_SOUND_FLOOR)?[{...s,tier:'possible' as const,uncalibrated:true}]:[]);
}
