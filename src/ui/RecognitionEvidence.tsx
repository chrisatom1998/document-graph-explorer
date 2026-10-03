import { DIMENSIONS, type Recognition, type Dimension, type SoundReview } from '../audio/recognition';
const titles: Record<Dimension,string> = {source:'Sources',vocal:'Vocal form',role:'Musical role',character:'Audible character',effect:'Effect or event'};
const time=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const models={ast:'AST',jamendo:'Jamendo',clap:'CLAP',rhythm:'Tempo',tonal:'Key'};
export default function RecognitionEvidence({recognition, duration, onSeek, reviews=[], confirmedInstruments=[], onReview}: {recognition: Recognition; duration: number; onSeek?: (seconds:number)=>void; reviews?:SoundReview[]; confirmedInstruments?:string[]; onReview?:(label:string,dimension:Dimension,decision:SoundReview['decision'])=>void}) {
  return <section aria-label="Sound evidence" className="music-recognition">
    <p>Analysis: {recognition.status}. Suggestions are uncalibrated and may be wrong. They do not create instrument connections.</p>
    <p>Listen to the evidence before confirming a source. Intervals show classifier windows, not exact sound boundaries.</p>
    {DIMENSIONS.map(dimension=>{
      const groups=new Map<string,typeof recognition.observations>();
      for(const observation of recognition.observations.filter(o=>o.dimension===dimension)) {
        const list=groups.get(observation.labelId)??[];list.push(observation);groups.set(observation.labelId,list);
      }
      for(const review of reviews.filter(r=>r.dimension===dimension))if(!groups.has(review.labelId))groups.set(review.labelId,[]);
      if(dimension==='source')for(const label of confirmedInstruments)if(!groups.has(label))groups.set(label,[]);
      return <div key={dimension}>{groups.size ? <><h4>{titles[dimension]}</h4><ul>{[...groups].map(([label,observations])=><li key={label}>
        <strong>{label}</strong> <span>{observations.length?'— possible':'— no current machine evidence'}</span>
        {dimension==='source'&&confirmedInstruments.includes(label)&&!reviews.some(r=>r.dimension===dimension&&r.labelId===label)&&<p>Previously confirmed by you for this track.</p>}
        {reviews.filter(r=>r.dimension===dimension&&r.labelId===label).slice(-1).map(review=><p key={review.at}>Your review for this track: {review.decision}.{review.evidenceRunId!==recognition.runId?' Evidence has changed since this review.':''}</p>)}
        <div aria-label={`Review ${label} for this track`}>
          {(['confirmed','rejected','uncertain'] as const).map(decision=><button type="button" key={decision} disabled={!onReview} onClick={()=>onReview?.(label,dimension,decision)}>{decision==='confirmed'?'Confirm':decision==='rejected'?'Reject':'Unsure'}</button>)}
        </div>
        <details><summary>Evidence ({observations.length} windows)</summary>
          <ul>{observations.slice(0,20).map(o=><li key={o.id}>
            <button type="button" disabled={!onSeek} aria-label={`Listen for ${label} at ${time(o.start)}–${time(o.end)}`} onClick={()=>onSeek?.(o.start)}>Listen at {time(o.start)}–{time(o.end)}</button>
            <span> {o.evidenceIds.map(id=>recognition.evidence.find(e=>e.id===id)).filter(e=>!!e).map(e=>`${models[e.modelId]} score ${e.score.toFixed(3)}`).join('; ')}</span>
          </li>)}</ul>
          {observations.length>20&&<p>Showing the first 20 evidence windows.</p>}
          <p>Raw model scores are not probabilities.</p>
        </details>
      </li>)}</ul></> : <p>{titles[dimension]}: unknown or unsupported by the available evidence.</p>}</div>;
    })}
    <h4>Coverage by component</h4>
    <p>Tempo and key use sampled excerpts for tracks over one minute, even in Full mode. They do not map tempo or key changes across the track.</p>
    <ul>{recognition.jobs.map(job=><li key={job.modelId}>
      {models[job.modelId]}: {job.status}; {job.successful.length}/{job.planned.length} windows; {time(job.analyzedSeconds)} of {time(duration)} analyzed.
      {job.unsupportedReason&&<span> {job.unsupportedReason}</span>}
      {job.error&&<span> Unavailable: {job.error}</span>}
      {job.gaps.length>0&&<details><summary>Unanalyzed intervals ({job.gaps.length})</summary>{job.gaps.slice(0,20).map((gap,i)=><span key={i}>{time(gap.start)}–{time(gap.end)}{i<Math.min(20,job.gaps.length)-1?', ':''}</span>)}</details>}
    </li>)}</ul>
    {recognition.mode==='fast'&&<p>Fast mode samples sections; gaps were not analyzed.</p>}
    {recognition.truncated&&<p>Stored evidence reached its limit. The displayed evidence is incomplete.</p>}
    {reviews.length>0&&<details><summary>Saved review history ({reviews.length})</summary><ul>{reviews.map((review,i)=><li key={i}>{review.labelId}: {review.decision} for this track, {review.at}{review.evidenceRunId!==recognition.runId?' — earlier evidence':''}</li>)}</ul></details>}
    <p>Silence, missing coverage and missing labels do not prove a source is absent.</p>
  </section>;
}
