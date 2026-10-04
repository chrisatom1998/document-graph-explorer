import './ConfidentSoundSummary.css';
import { filenameSoundFallback } from '../audio/filenameSoundFallback';
import type { DocNode } from '../model/types';
import { confidentSoundSummary, SOUND_DISPLAY_POLICY } from '../audio/confidentSoundSummary';
import type { MusicAnalysis } from '../audio/musicTypes';
export default function ConfidentSoundSummary({audio,mode,node}:{audio:MusicAnalysis;mode?:string;node?:Pick<DocNode, 'path' | 'title'>}) {
  const scored=confidentSoundSummary(audio,mode);
  const labels=[...scored,...(node?filenameSoundFallback(audio,node,scored).map(item=>({...item,scores:undefined})):[])];
  return <section aria-label="Sound identification" data-display-policy={SOUND_DISPLAY_POLICY} data-filename-policy="missing-dimension-v1" className="music-sound-summary">
    {labels.length?<>{(['source','effect','character','vocal','role'] as const).map(dimension=>{
      const group=labels.filter(l=>l.dimension===dimension);return group.length?<div key={dimension}><h4>{dimension==='source'?'Instruments and sound sources':dimension==='effect'?'Effects and sound types':dimension==='character'?'Sound character':dimension==='vocal'?'Vocal form':'Musical role'}</h4><ul className="confidence-sounds">{group.map(l=><li key={l.label}><strong>{l.label.replaceAll('_',' ')}</strong><small> — {l.origin}{l.scores?.length?` · ${l.scores.map(s=>`${s.model} ${s.score.toFixed(3)}`).join('; ')}`:''}</small></li>)}</ul></div>:null;
    })}{labels.some(l=>l.origin==='model estimate')&&<p className="dj-note">Model scores ≥ 0.50. Scores from different models are not equivalent probabilities or measured accuracy.</p>}</>:<p>No instruments or sound attributes meet the display threshold yet.</p>}
  </section>;
}
