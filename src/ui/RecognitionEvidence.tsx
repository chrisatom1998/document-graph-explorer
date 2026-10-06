import ConfidentSoundSummary from './ConfidentSoundSummary';
import type { FusionAnalysis } from '../audio/fusion';
import { FusionDiagnostics } from './FusionEvidence';
import { DIMENSIONS, type Recognition, type Dimension, type SoundReview } from '../audio/recognition';
import { clockTime as time } from './clockTime';
const titles: Record<Dimension,string> = {source:'Sources',vocal:'Vocal form',role:'Musical role',character:'Audible character',effect:'Effect or event'};
const models={ast:'AST',jamendo:'Jamendo',clap:'CLAP',rhythm:'Tempo',tonal:'Key'};
export interface RecognitionEvidenceProps {
  recognition: Recognition; fusion?: FusionAnalysis; duration: number; onSeek?: (seconds:number)=>void;
  reviews?: SoundReview[]; confirmedInstruments?: string[];
  onReview?: (label:string,dimension:Dimension,decision:SoundReview['decision'])=>void;
}
function groupsFor({recognition,reviews=[],confirmedInstruments=[]}:RecognitionEvidenceProps,dimension:Dimension) {
  const groups=new Map<string,typeof recognition.observations>();
  for(const observation of recognition.observations.filter(o=>o.dimension===dimension)) {
    const list=groups.get(observation.labelId)??[];list.push(observation);groups.set(observation.labelId,list);
  }
  for(const review of reviews.filter(r=>r.dimension===dimension))if(!groups.has(review.labelId))groups.set(review.labelId,[]);
  if(dimension==='source')for(const label of confirmedInstruments)if(!groups.has(label))groups.set(label,[]);
  return groups;
}
function EvidenceWindows({label,dimension,...props}:RecognitionEvidenceProps & {label:string;dimension:Dimension}) {
  const observations=groupsFor(props,dimension).get(label)??[];
  return <details><summary>Evidence for {label} ({observations.length} windows)</summary>
    <ul>{observations.slice(0,20).map(o=><li key={o.id}>
      <button type="button" disabled={!props.onSeek} aria-label={`Listen for ${label} at ${time(o.start)}–${time(o.end)}`} onClick={()=>props.onSeek?.(o.start)}>Listen at {time(o.start)}–{time(o.end)}</button>
      <span> {o.evidenceIds.map(id=>props.recognition.evidence.find(e=>e.id===id)).filter(e=>!!e).map(e=>e.derivedFrom?`${models[e.modelId]} “${e.derivedFrom.labelId}” score ${e.score.toFixed(3)} (supports voice)`:`${models[e.modelId]} score ${e.score.toFixed(3)}`).join('; ')}</span>
    </li>)}</ul>
    {observations.length>20&&<p>Showing the first 20 evidence windows.</p>}
    <p>Raw model scores are not probabilities.</p>
  </details>;
}
/** Technical evidence is kept mounted inside the parent disclosure; no analysis or review data changes. */
export function RecognitionDiagnostics(props:RecognitionEvidenceProps) {
  const {recognition,reviews=[],fusion,duration}=props;
  return <>
    <div className="rec-head">
      <span className={`rec-badge rec-badge--${recognition.status}`}>{recognition.status}</span>
      <span className="rec-head__note">Suggestions are uncalibrated and may be wrong. They do not create instrument connections.</span>
    </div>
    <FusionDiagnostics fusion={fusion} duration={duration} mode={recognition.mode} onSeek={props.onSeek} />
    {DIMENSIONS.map(dimension=>{
      const groups=groupsFor(props,dimension);
      const evidence=groups.size ? <div>{[...groups].map(([label,observations])=><div key={label}>
        {fusion&&dimension==='source'&&<><strong>{label}</strong> <span>{observations.length?'— possible':'— no current machine evidence'}</span></>}
        <EvidenceWindows {...props} label={label} dimension={dimension} />
      </div>)}</div> : <p>{titles[dimension]}: unknown or unsupported by the available evidence.</p>;
      return fusion&&dimension==='source' ? <details key={dimension}><summary>Raw native source diagnostics and your track reviews</summary><p>These native suggestions are separate from the trained policy and do not add to its predictions. Saved human reviews remain unchanged.</p>{evidence}</details> : <div key={dimension}>{evidence}</div>;
    })}
    <h4>Coverage by component</h4>
    <ul className="rec-coverage">{recognition.jobs.map(job=>{
      const ratio=job.planned.length?job.successful.length/job.planned.length:0;
      return <li key={job.modelId} className={`rec-coverage__row rec-coverage__row--${job.status}`}>
        {/* Kept as a direct text node: tests match /AST: failed/ on this row, and
            wrapping it in a span would make both the span and the li match. */}
        {models[job.modelId]}: {job.status}
        <span className="rec-coverage__meter" aria-hidden="true"><span style={{width:`${Math.round(ratio*100)}%`}} /></span>
        <span className="rec-coverage__count">{job.successful.length}/{job.planned.length} · {time(job.analyzedSeconds)}/{time(duration)}</span>
        {job.unsupportedReason&&<span className="rec-coverage__flag">{job.unsupportedReason}</span>}
        {job.error&&<span className="rec-coverage__flag">Unavailable: {job.error}</span>}
        {job.gaps.length>0&&<details className="rec-coverage__gaps"><summary>Unanalyzed intervals ({job.gaps.length})</summary>{job.gaps.slice(0,20).map((gap,i)=><span key={i}>{time(gap.start)}–{time(gap.end)}{i<Math.min(20,job.gaps.length)-1?', ':''}</span>)}</details>}
      </li>;
    })}</ul>
    {reviews.length>0&&<details><summary>Saved review history ({reviews.length})</summary><ul>{reviews.map((review,i)=><li key={i}>{review.labelId}: {review.decision} for this track, {review.at}{review.evidenceRunId!==recognition.runId?' — earlier evidence':''}</li>)}</ul></details>}
    <details className="rec-fineprint"><summary>About these numbers</summary>
      <p>Tempo and key use sampled excerpts for tracks over one minute, even in Full mode. They do not map tempo or key changes across the track.</p>
      <p>Intervals show classifier windows, not exact sound boundaries.</p>
      {recognition.mode==='fast'&&<p>Fast mode samples sections; gaps were not analyzed.</p>}
      {recognition.truncated&&<p>Stored evidence reached its limit. The displayed evidence is incomplete.</p>}
      <p>Silence, missing coverage and missing labels do not prove a source is absent.</p>
    </details>
  </>;
}
export default function RecognitionEvidence({summaryOnly=false,...props}:RecognitionEvidenceProps & {summaryOnly?:boolean}) {
  return <section aria-label="Sound evidence" className="music-recognition">
    {props.recognition.status!=='complete'&&<p role="status">Analysis: {props.recognition.status}.</p>}
    {props.recognition.status==='complete'&&props.recognition.jobs.some(job=>job.status!=='complete')&&<p role="status">Some analysis is unavailable.</p>}
    {props.recognition.truncated&&<p role="status">Evidence incomplete.</p>}
    <ConfidentSoundSummary audio={{version:2,durationSeconds:props.duration,analyzedSeconds:props.duration,instruments:[],notes:[],recognition:props.recognition,fusion:props.fusion,soundReviews:props.reviews,confirmedInstruments:props.confirmedInstruments}} />
    {!summaryOnly&&<details><summary>Details</summary><RecognitionDiagnostics {...props} /></details>}
  </section>;
}
