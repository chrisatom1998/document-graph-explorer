import type { SoundReview } from '../audio/recognition';
import type { FusionAnalysis } from '../audio/fusion';
import { fusionLabelText, fusionPresentation } from '../audio/fusionPresentation';
interface FusionEvidenceProps { fusion?: FusionAnalysis; duration: number; mode: string; onSeek?: (seconds: number) => void; onReview?: (label: string, dimension: 'source', decision: SoundReview['decision']) => void; reviews?: SoundReview[] }
export function FusionDiagnostics({fusion,duration,mode,onSeek}:FusionEvidenceProps) {
  const view=fusionPresentation(fusion,duration,mode);
  if(!view)return null;
  return <section aria-label="Source classifier diagnostics">
    <p>{view.qualified ? 'This policy was evaluated on ten-second Ogg excerpts. Suggestions are not human confirmations or guarantees for other recordings.' : fusion?.imported ? 'Imported source classifier diagnostics are unverified. They do not establish a new local validated run.' : 'Experimental source classifier diagnostics. These results are not enabled as trained source suggestions.'}</p>
    <details><summary>All 20 classifier states and support</summary>
      <p>Negative, uncertain and unavailable are different states. A negative does not prove a source is absent. Scores are not calibrated certainty.</p>
      {view.windows.map(w => <div key={w.start}>
        <button type="button" disabled={!onSeek} onClick={() => onSeek?.(w.start)}>Listen to classifier window {w.start.toFixed(2)}–{w.end.toFixed(2)} s</button>
        <p>{w.status}{w.reason ? ': ' + w.reason : ''}</p>
        <table><thead><tr><th>Source</th><th>State</th><th>Decision source</th><th>Head score</th><th>Positive / negative groups</th></tr></thead>
          <tbody>{w.decisions.map(d => <tr key={d.label} data-fusion-label={d.label} data-fusion-state={d.state}><td>{fusionLabelText(d.label)}</td><td>{d.state}</td><td>{d.source === 'guarded-binary-baseline' ? 'Baseline fallback' : d.source === 'learned-head' ? 'Learned head' : 'Unavailable'}</td><td>{d.headProbability?.toFixed(3) ?? 'Unavailable'}</td><td>{d.positiveGroups} / {d.negativeGroups}{!d.eligible ? ' (head not enabled)' : ''}</td></tr>)}</tbody></table>
      </div>)}
      {!view.windows.length && <p>No completed classifier windows.</p>}
      {view.omittedWindows > 0 && <p>{view.omittedWindows} additional windows were omitted from stored detail.</p>}
    </details>
  </section>;
}
export default function FusionEvidence({summaryOnly=false,...props}:FusionEvidenceProps & {summaryOnly?:boolean}) {
  const {fusion,duration,mode,onReview,reviews=[]}=props;
  const view=fusionPresentation(fusion,duration,mode);
  if(!view)return null;
  return <section aria-label="Twenty-class source classifier">
    {view.qualified&&<>
      <h4>Sources — trained policy</h4>
      {view.positive.length ? <ul aria-label="Trained source suggestions">{view.positive.map(label => <li key={label} data-fusion-label={label} data-fusion-state="positive">{fusionLabelText(label)} — suggested
        <div role="group" aria-label={`Review trained ${fusionLabelText(label)} for this track`}>{(['confirmed', 'rejected', 'uncertain'] as const).map(decision => <button key={decision} type="button" disabled={!onReview} onClick={() => onReview?.(label, 'source', decision)}>{decision === 'confirmed' ? 'Confirm' : decision === 'rejected' ? 'Reject' : 'Unsure'}</button>)}</div>
        {reviews.filter(r => r.dimension === 'source' && r.labelId === label).slice(-1).map(r => <p key={r.at}>Your review for this track: {r.decision}.</p>)}
        </li>)}</ul> : <p>No positive source suggestions from the trained policy in this window.</p>}
    </>}
    {!summaryOnly&&<details><summary>Details</summary><FusionDiagnostics {...props} /></details>}
  </section>;
}
