import './ConfidentSoundSummary.css';
import { filenameSoundFallback } from '../audio/filenameSoundFallback';
import type { DocNode } from '../model/types';
import { confidentSoundSummary, SOUND_DISPLAY_POLICY } from '../audio/confidentSoundSummary';
import type { MusicAnalysis } from '../audio/musicTypes';
import type { SoundProfile } from '../audio/soundProfile';
import { fusionPresentation, fusionLabelText } from '../audio/fusionPresentation';

const ORDER = ['source', 'effect', 'character', 'vocal', 'role'] as const;
const DIMENSION_NAME = { source: 'Sound source', effect: 'Sound type', character: 'Character', vocal: 'Vocal', role: 'Role' };
const pretty = (label: string) => label.replaceAll('_', ' ');

/** The identified sounds as tags. Explanations live in hover text, not on the page. */
export default function ConfidentSoundSummary({audio,mode,node}:{audio:MusicAnalysis;mode?:string;node?:Pick<DocNode, 'path' | 'title'>}) {
  const scored=confidentSoundSummary(audio,mode);
  const labels=[...scored,...(node?filenameSoundFallback(audio,node,scored).map(item=>({...item,scores:undefined})):[])]
    .sort((a,b)=>ORDER.indexOf(a.dimension as typeof ORDER[number])-ORDER.indexOf(b.dimension as typeof ORDER[number]));
  return <section aria-label="Sound identification" data-display-policy={SOUND_DISPLAY_POLICY} data-filename-policy="missing-dimension-v1" className="sound-tags">
    <h4 className="sound-tags__title">Sounds</h4>
    {labels.length ? <ul className="sound-tags__list">{labels.map(l => {
      const kind = l.origin === 'confirmed by you' ? 'confirmed' : l.origin === 'From filename' ? 'name' : l.dimension === 'source' ? 'source' : 'detail';
      const hover = [DIMENSION_NAME[l.dimension as keyof typeof DIMENSION_NAME] ?? l.dimension,
        l.origin === 'From filename' ? 'from the file name, not the audio' : l.origin,
        ...(l.scores ?? []).map(s => `${s.model} ${s.score.toFixed(2)}`)].join(' · ');
      return <li key={`${l.dimension}:${l.label}`} className={`sound-tag sound-tag--${kind}`} title={hover}>
        {kind === 'confirmed' && <span className="sound-tag__mark" aria-hidden="true">✓</span>}
        <span>{pretty(l.label)}</span>
        {kind === 'name' && <span className="sound-tag__note">name</span>}
        <span className="sr-only"> — {hover}</span>
      </li>;
    })}</ul> : <p className="sound-tags__empty">Nothing identified yet</p>}
  </section>;
}

/** Each model's own top guesses with its raw score. Scales differ between models
 * (AST and Jamendo give probabilities, CLAP gives similarity), so bars are not compared across rows. */
export function ModelScores({ profile, audio }: { profile?: SoundProfile; audio?: MusicAnalysis }) {
  const models: { model: string; complete: boolean; candidates: { label: string; score: number }[] }[] = [];
  // The trained detector only counts when its run is qualified for this recording.
  const fusion = audio ? fusionPresentation(audio.fusion, audio.durationSeconds, audio.recognition?.mode ?? 'full') : undefined;
  if (fusion?.qualified) {
    const best = new Map<string, number>();
    for (const w of fusion.windows) if (w.status === 'complete') for (const d of w.decisions)
      if (d.headProbability !== null) best.set(d.label, Math.max(best.get(d.label) ?? 0, d.headProbability));
    if (best.size) models.push({ model: 'Trained detector', complete: true,
      candidates: [...best].map(([label, score]) => ({ label: fusionLabelText(label as Parameters<typeof fusionLabelText>[0]), score })) });
  }
  models.push(...(profile?.models.filter(m => m.candidates.length) ?? []));
  if (!models.length) return null;
  return <details className="model-scores">
    <summary>Model scores</summary>
    <div className="model-scores__grid">{models.map(m => <div key={m.model} className="model-scores__model">
      <h5>{m.model}{!m.complete && <small> · partial</small>}</h5>
      <ul>{[...m.candidates].sort((a, b) => b.score - a.score).slice(0, 4).map(c => <li key={c.label}>
        <span className="model-scores__label">{pretty(c.label)}</span>
        <span className="model-scores__bar" aria-hidden="true"><span style={{ width: `${Math.max(2, Math.min(100, c.score * 100))}%` }} /></span>
        <span className="model-scores__value">{c.score.toFixed(2)}</span>
      </li>)}</ul>
    </div>)}</div>
    <p className="model-scores__note">Each model scores on its own scale.</p>
  </details>;
}
