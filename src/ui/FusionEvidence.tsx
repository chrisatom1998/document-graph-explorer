import ConfidentSoundSummary from './ConfidentSoundSummary';
import type { SoundReview } from '../audio/recognition';
import type { FusionAnalysis } from '../audio/fusion';
import { fusionLabelText, fusionPresentation } from '../audio/fusionPresentation';
interface FusionEvidenceProps { fusion?: FusionAnalysis; duration: number; mode: string; onSeek?: (seconds: number) => void; onReview?: (label: string, dimension: 'source', decision: SoundReview['decision']) => void; reviews?: SoundReview[] }
export function FusionDiagnostics({fusion,duration,mode,onSeek}:FusionEvidenceProps) {
  const view=fusionPresentation(fusion,duration,mode);
  if(!view)return null;
  return <section aria-label="Source classifier diagnostics">
    <p>{view.qualified ? 'Evaluated on public OpenMIC clips and checked to give the same answers for WAV, MP3 and longer recordings. Suggestions are not human confirmations.' : fusion?.imported ? 'Imported source classifier diagnostics are unverified. They do not establish a new local validated run.' : 'Experimental source classifier diagnostics. These results are not enabled as trained source suggestions.'}</p>
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
  const {fusion,duration,mode,reviews=[]}=props;
  const view=fusionPresentation(fusion,duration,mode);
  if(!view)return null;
  return <section aria-label="Twenty-class source classifier">
    {view.qualified&&<ConfidentSoundSummary audio={{version:2,durationSeconds:duration,analyzedSeconds:duration,instruments:[],notes:[],fusion,soundReviews:reviews}} mode={mode} />}
    {!summaryOnly&&<details><summary>Details</summary><FusionDiagnostics {...props} /></details>}
  </section>;
}
