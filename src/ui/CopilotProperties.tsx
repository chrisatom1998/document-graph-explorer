import type { MusicAnalysis } from '../audio/musicTypes';
import { projectedCopilotProperties } from '../audio/soundReviewPolicy';

export default function CopilotProperties({ audio }: { audio: MusicAnalysis }) {
  const properties = audio.copilotProperties;
  if (!properties) return null;
  const {current,historical}=projectedCopilotProperties(audio);
  return <div className="dj-suggested-properties">
    <strong>{current.length?'AI-suggested properties · not confirmed':'Saved AI-property history'}</strong>
    {current.length>0&&<p>{(['source','production','character'] as const).flatMap(group=>{
      const labels=current.filter(t=>t.group===group).map(t=>t.label);
      return labels.length?[`${group}: ${labels.join(', ')}`]:[];
    }).join(' · ')}</p>}
    <p className="dj-note">Suggested by {properties.model} {properties.model === 'gpt-audio-1.5' ? `from an uploaded audio excerpt${properties.audioExcerpt ? ` (first ${properties.audioExcerpt.durationSeconds.toFixed(1)}s)` : ''}; not a full-track analysis.` : 'from metadata, not a listening assessment.'} {current.length?'Current suggestions are available in sample search; your reviews take priority.':'No current AI suggestions are used in sample search.'}</p>
    {historical.length>0&&<details><summary>Earlier AI suggestions</summary><ul>{historical.map(t=><li key={`${t.group}:${t.label}`}>{t.group}: {t.label} — {t.reason}; historical AI suggestion.</li>)}</ul></details>}
  </div>;
}
