import './ConfidentSoundSummary.css';
import { confidentSoundSummary, SOUND_DISPLAY_POLICY } from '../audio/confidentSoundSummary';
import type { MusicAnalysis } from '../audio/musicTypes';
export default function ConfidentSoundSummary({audio,mode}:{audio:MusicAnalysis;mode?:string}) {
  const labels=confidentSoundSummary(audio,mode);
  return <section aria-label="Sound identification" data-display-policy={SOUND_DISPLAY_POLICY} className="music-sound-summary">
    {labels.length?<>{(['source','effect','character','vocal','role'] as const).map(dimension=>{
      const group=labels.filter(l=>l.dimension===dimension);return group.length?<div key={dimension}><h4>{dimension==='source'?'Instruments and sound sources':dimension==='effect'?'Effects and sound types':dimension==='character'?'Sound character':dimension==='vocal'?'Vocal form':'Musical role'}</h4><ul className="confidence-sounds">{group.map(l=><li key={l.label}><strong>{l.label.replaceAll('_',' ')}</strong><small> — {l.origin}{l.scores?.length?` · ${l.scores.map(s=>`${s.model} ${s.score.toFixed(3)}`).join('; ')}`:''}</small></li>)}</ul></div>:null;
    })}{labels.some(l=>l.origin==='model estimate')&&<p className="dj-note">Model scores ≥ 0.50. Scores from different models are not equivalent probabilities or measured accuracy.</p>}</>:<p>No instruments or sound attributes meet the display threshold yet.</p>}
  </section>;
}
