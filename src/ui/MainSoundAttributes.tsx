import { useSyncExternalStore } from 'react';
import type { DocNode } from '../model/types';
import type { MusicAnalysis } from '../audio/musicTypes';
import { KEY_NAMES, keyName } from '../audio/musicTypes';
import { musicNameHints } from '../audio/nameHints';
import { confirmedInstrumentList } from '../audio/instrumentEvidence';
import { canonicalDjLabel, soundLabelText } from '../audio/djTags';
import { latestSoundReview, projectedCopilotProperties } from '../audio/soundReviewPolicy';
import { fusionPresentation } from '../audio/fusionPresentation';
import type { Dimension } from '../audio/recognition';
import './MainSoundAttributes.css';

type Attribute = { dimension: Dimension; label: string; evidence: Set<string>; review?: string; score?: number;
  /** Best score from a model whose output is probability-like (AST, Jamendo, trained heads); CLAP similarity never counts. */
  probabilityScore?: number };
/** A model score at or above this moves an unreviewed label into the main list. Scores are model-scale, not probabilities. */
export const LIKELY_SCORE = .5;
export const isLikely = (row: Attribute) => !row.review && (row.score ?? 0) >= LIKELY_SCORE;
const dimensionName: Record<Dimension,string> = {source:'Source',effect:'Effect / sound type',character:'Character',vocal:'Vocal form',role:'Musical role'};
const score = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : 'unavailable';
const canonical = (dimension: Dimension, label: string) => dimension === 'effect' ? canonicalDjLabel('production',label) ?? label : dimension === 'character' ? canonicalDjLabel('character',label) ?? label : label;

/** All saved label evidence, visibly attributed. This does not decide the Sounds tags or mutate analysis. */
export function soundAttributeRows(audio: MusicAnalysis, node: Pick<DocNode,'title'|'path'>): Attribute[] {
  const rows = new Map<string,Attribute>();
  const confirmed = confirmedInstrumentList(audio);
  const add = (dimension: Dimension, raw: string, evidence: string, evidenceScore?: number, probabilityLike = false) => {
    const label = canonical(dimension,raw), key = `${dimension}:${label}`;
    const row = rows.get(key) ?? {dimension,label,evidence:new Set<string>()};
    const review = latestSoundReview(audio.soundReviews,dimension,label);
    row.review = review ? `${review.decision === 'uncertain' ? 'unsure' : review.decision} by you`
      : dimension === 'source' && confirmed !== undefined ? confirmed.includes(label) ? 'confirmed by you' : 'superseded by your source corrections'
      : dimension !== 'source' && audio.confirmedDjTags !== undefined ? audio.confirmedDjTags[dimension === 'character' ? 'character' : 'production'].includes(label) ? 'confirmed by you' : 'superseded by your sound corrections'
      : undefined;
    if (dimension === 'vocal' && !review) {
      const voiceReview=latestSoundReview(audio.soundReviews,'source','voice');
      if(voiceReview && voiceReview.decision!=='confirmed')row.review=`voice ${voiceReview.decision==='uncertain'?'unsure':voiceReview.decision} by you`;
      else if(confirmed!==undefined&&!confirmed.includes('voice'))row.review='superseded by your source corrections';
    }
    if (typeof evidenceScore === 'number' && Number.isFinite(evidenceScore)) {
      row.score = Math.max(row.score ?? 0, evidenceScore);
      if (probabilityLike) row.probabilityScore = Math.max(row.probabilityScore ?? 0, evidenceScore);
    }
    row.evidence.add(evidence); rows.set(key,row);
  };
  for (const label of confirmed ?? []) add('source',label,'Saved source correction');
  for (const group of ['production','character'] as const) for (const label of audio.confirmedDjTags?.[group] ?? []) add(group === 'production' ? 'effect' : 'character',label,'Saved sound correction');
  for (const review of audio.soundReviews ?? []) add(review.dimension,review.labelId,'Saved review; latest decision takes precedence');
  for (const item of audio.instruments) add('source',item.label,`Audio instrument model · ${item.status ?? 'estimate'} · score ${score(item.score)}`,item.score,true);
  if (audio.instrumentPrediction) { const p=audio.instrumentPrediction; add('source',p.label,`${p.model ?? 'Audio model'} · closest match, unconfirmed · score ${score(p.score)} · margin ${score(p.margin)}`,p.score); }
  const evidence = new Map(audio.recognition?.evidence.map(e=>[e.id,e]));
  const windows = new Map<string,{dimension:Dimension;label:string;model:string;status:string;scores:number[];probabilityLike:boolean}>();
  for (const observation of audio.recognition?.observations ?? []) {
    const matches = observation.evidenceIds.map(id=>evidence.get(id)).filter(e=>e && e.dimension===observation.dimension && e.labelId===observation.labelId);
    if (!matches.length) add(observation.dimension,observation.labelId,`Audio observation · ${observation.status} · score unavailable`);
    for (const e of matches) if (e) {
      const model=e.modelId+(e.derivedFrom?` (derived from ${e.derivedFrom.labelId})`:''), key=`${e.dimension}:${e.labelId}:${model}:${observation.status}`;
      const group=windows.get(key)??{dimension:e.dimension,label:e.labelId,model,status:observation.status,scores:[],probabilityLike:(e.modelId==='ast'||e.modelId==='jamendo')&&!e.derivedFrom};
      if(Number.isFinite(e.score))group.scores.push(e.score); windows.set(key,group);
    }
  }
  for(const group of windows.values())add(group.dimension,group.label,`${group.model} audio · ${group.status} · score range ${group.scores.length?`${score(Math.min(...group.scores))}–${score(Math.max(...group.scores))}`:'unavailable'}`,group.scores.length?Math.max(...group.scores):undefined,group.probabilityLike);
  const profile=audio.soundProfile;
  if(profile?.resemblance)add('source',profile.resemblance,'Audio profile · resemblance only, not identification');
  if(profile?.source)add('source',profile.source.label,`${profile.source.basis} audio estimate${profile.source.corroborated?' · corroborated, not confirmed':''}`);
  if(profile?.voice){add('source','voice',`${profile.voice.basis} audio estimate`);if(profile.voice.style)add('vocal',profile.voice.style,`${profile.voice.basis} audio style estimate`);}
  for(const label of profile?.character??[])add('character',label,'Audio profile · estimated character');
  for(const label of profile?.roles??[])add('role',label,'Audio profile · estimated role');
  for(const tag of profile?.djTags??[])add(tag.group==='source'?'source':tag.group==='production'?'effect':'character',tag.label,`${tag.model??'Audio model'} · unconfirmed · score ${score(tag.score)}`,tag.score,tag.model==='AudioSet AST'||tag.model==='MTG-Jamendo'||tag.model==='Trained head');
  for(const model of profile?.models??[])for(const candidate of model.candidates){
    const dimension=canonicalDjLabel('character',candidate.label)?'character':canonicalDjLabel('production',candidate.label)?'effect':'source';
    add(dimension,candidate.label,`${model.model} · ${model.complete?'model guess':'partial model guess'} · score ${score(candidate.score)}`,candidate.score,model.complete&&(model.model==='AudioSet AST'||model.model==='MTG-Jamendo'));
  }
  const fusion=fusionPresentation(audio.fusion,audio.durationSeconds,audio.recognition?.mode??'full');
  const classifier = new Map<string,{label:string;state:string;source:string;eligible:boolean;head:number[];decision:number[]}>();
  if(fusion)for(const window of fusion.windows)for(const d of window.decisions){
    const key=`${d.label}:${d.state}:${d.source}:${d.eligible}`;
    const group=classifier.get(key)??{label:d.label,state:d.state,source:d.source,eligible:d.eligible,head:[],decision:[]};
    if(d.headProbability!==null)group.head.push(d.headProbability);
    if(d.decisionProbability!==null)group.decision.push(d.decisionProbability);
    classifier.set(key,group);
  }
  const range=(values:number[])=>values.length?`${score(Math.min(...values))}–${score(Math.max(...values))}`:'unavailable';
  for(const d of classifier.values())add('source',d.label,
    `${fusion!.qualified?'Source classifier':audio.fusion?.imported?'Imported, unverified classifier':'Experimental, disabled classifier'} · ${d.state} · ${d.source} · head score range ${range(d.head)} · decision score range ${range(d.decision)}${d.eligible?'':' · head not enabled'}`);
  const hints=musicNameHints(node);
  for(const label of hints.instruments?.value??[])add('source',label,`From ${hints.instruments!.source} · not audio evidence`);
  for(const item of projectedCopilotProperties(audio).current)add(item.group==='source'?'source':item.group==='production'?'effect':'character',item.label,`${audio.copilotProperties?.model??'AI'} ${audio.copilotProperties?.model==='gpt-audio-1.5'?'audio-excerpt suggestion · unverified':'metadata suggestion · not a listening assessment'}`);
  return [...rows.values()];
}

/**
 * Unreviewed labels a probability-like model scores at LIKELY_SCORE or more, for the Sounds row's separate
 * "likely" group. Display only: these never become tags, links or corrections. `exclude` holds labels the
 * Sounds row already shows.
 */
export function likelyExtraSounds(audio: MusicAnalysis, node: Pick<DocNode,'title'|'path'>, exclude: ReadonlySet<string>): Attribute[] {
  return soundAttributeRows(audio,node)
    .filter(row => !row.review && (row.probabilityScore ?? 0) >= LIKELY_SCORE && !exclude.has(row.label))
    .sort((a,b) => (b.probabilityScore ?? 0) - (a.probabilityScore ?? 0))
    .slice(0, 6);
}

/** One shared setting, so it survives the panel remounting when analysis updates or another sound is selected. */
let showUnconfirmedSetting = false;
const settingListeners = new Set<() => void>();
const subscribeSetting = (listener: () => void) => { settingListeners.add(listener); return () => { settingListeners.delete(listener); }; };
export const setShowUnconfirmedSetting = (value: boolean) => { showUnconfirmedSetting = value; settingListeners.forEach(listener => listener()); };
/** Collapsed by default; shared the same way so the choice survives switching sounds. */
let attributesOpenSetting = false;
export const setAttributesOpenSetting = (value: boolean) => { attributesOpenSetting = value; settingListeners.forEach(listener => listener()); };

export default function MainSoundAttributes({audio,node}:{audio:MusicAnalysis;node:Pick<DocNode,'title'|'path'>}) {
  const rows=soundAttributeRows(audio,node), hints=musicNameHints(node);
  const showUnconfirmed=useSyncExternalStore(subscribeSetting,()=>showUnconfirmedSetting,()=>false);
  const open=useSyncExternalStore(subscribeSetting,()=>attributesOpenSetting,()=>false);
  // Rows you have reviewed always stay, as do unreviewed labels a model scores at 50% or more; the rest fold away.
  const unconfirmed=rows.filter(r=>!r.review&&!isLikely(r)), shown=showUnconfirmed?rows:rows.filter(r=>r.review||isLikely(r));
  const recognition=audio.recognition;
  const incomplete = audio.stage === 'preview' || !!recognition && (recognition.status !== 'complete' || !!recognition.truncated || recognition.jobs.some(job => job.status !== 'complete'))
    || !!audio.instrumentScan && !audio.instrumentScan.complete || audio.soundProfile?.models.some(model => !model.complete)
    || !!audio.fusion && (audio.fusion.counts.failed > 0 || audio.fusion.counts.unsupported > 0 || audio.fusion.omittedWindows > 0);
  const audioKey=audio.key && hints.key?.value.tonic===audio.key.tonic && hints.key.value.mode===audio.key.mode ? hints.key.displayName : audio.key ? keyName(audio.key) : undefined;
  return <section className="main-sound-attributes" aria-label="All sound attributes">
    <h4><button type="button" className="main-sound-attributes__head" aria-expanded={open} aria-controls="main-sound-attributes-body" onClick={()=>setAttributesOpenSetting(!open)}>All sound attributes</button></h4>
    <div id="main-sound-attributes-body" hidden={!open}>
    <dl className="main-sound-attributes__measurements">
      <div><dt>Audio tempo</dt><dd>{audio.tempo?`${audio.tempo.bpm} BPM · confidence ${score(audio.tempo.confidence)}`:'Uncertain / unavailable'}{audio.tempo?.alternatives?.length?` · alternatives ${audio.tempo.alternatives.join(' / ')} BPM`:''}</dd></div>
      <div><dt>Audio key</dt><dd>{audio.key?`${audioKey} · strength ${score(audio.key.strength)}`:'Uncertain / unavailable'}</dd></div>
      <div><dt>Audio pitch</dt><dd>{audio.detectedPitch?`${KEY_NAMES[audio.detectedPitch.pitchClass]} · confidence ${score(audio.detectedPitch.confidence)} · pitch alone does not establish a key`:'Uncertain / unavailable'}</dd></div>
      {hints.tempo&&<div><dt>Tempo from {hints.tempo.source}</dt><dd>{hints.tempo.value} BPM · not audio evidence</dd></div>}
      {hints.key&&<div><dt>Key from {hints.key.source}</dt><dd>{hints.key.displayName} · not audio evidence</dd></div>}
      {hints.pitch&&<div><dt>Pitch from {hints.pitch.source}</dt><dd>{KEY_NAMES[hints.pitch.value]} · not audio evidence</dd></div>}
    </dl>
    {unconfirmed.length>0&&<button type="button" className="main-sound-attributes__toggle" aria-pressed={showUnconfirmed} onClick={()=>setShowUnconfirmedSetting(!showUnconfirmed)}>{showUnconfirmed?'Hide':'Show'} unconfirmed ({unconfirmed.length})</button>}
    {shown.length>0&&<ul className="main-sound-attributes__labels">{shown.map(row=><li key={`${row.dimension}:${row.label}`}>
      <strong>{soundLabelText(row.label)}</strong> <span>· {dimensionName[row.dimension]} · {row.review??(isLikely(row)?'likely · model score ≥ 50%':'unconfirmed evidence')}</span>
      <ul>{[...row.evidence].map(e=><li key={e}>{e}</li>)}</ul>
    </li>)}</ul>}
    {incomplete&&<p role="status">Some audio analysis is incomplete or unavailable.</p>}
    {audio.soundProfile?.disagreement&&<p>Instrument models disagree; the estimate is uncertain.</p>}
    {(['source','effect','character','vocal','role'] as const).filter(d=>!rows.some(r=>r.dimension===d)).map(d=><p key={d}>{dimensionName[d]}: unknown or unsupported by the available evidence.</p>)}
    </div>
  </section>;
}
