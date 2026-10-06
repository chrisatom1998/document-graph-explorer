import './ConfidentSoundSummary.css';
import { filenameSoundFallback } from '../audio/filenameSoundFallback';
import type { DocNode } from '../model/types';
import { confidentSoundSummary, SOUND_DISPLAY_POLICY } from '../audio/confidentSoundSummary';
import type { MusicAnalysis } from '../audio/musicTypes';
import type { SoundProfile } from '../audio/soundProfile';
import { soundLabelText } from '../audio/djTags';
import { fusionPresentation, fusionLabelText } from '../audio/fusionPresentation';
import { likelyExtraSounds } from './MainSoundAttributes';

const ORDER = ['source', 'effect', 'character', 'vocal', 'role'] as const;
const DIMENSION_NAME = { source: 'Sound source', effect: 'Sound type', character: 'Character', vocal: 'Vocal', role: 'Role' };

/** The identified sounds as tags. Explanations live in hover text, not on the page. */
export default function ConfidentSoundSummary({audio,mode,node}:{audio:MusicAnalysis;mode?:string;node?:Pick<DocNode, 'path' | 'title'>}) {
  const scored=confidentSoundSummary(audio,mode);
  const labels=[...scored,...(node?filenameSoundFallback(audio,node,scored).map(item=>({...item,scores:undefined})):[])]
    .sort((a,b)=>ORDER.indexOf(a.dimension as typeof ORDER[number])-ORDER.indexOf(b.dimension as typeof ORDER[number]));
  // Separate, dimmed group: untested but probability-like model scores >= 0.5. Only in the real music panel (node given).
  const extras=node?likelyExtraSounds(audio,node,new Set(labels.map(l=>l.label))):[];
  return <section aria-label="Sound identification" data-display-policy={SOUND_DISPLAY_POLICY} data-filename-policy="missing-dimension-v1" className="sound-tags">
    <h4 className="sound-tags__title">Sounds</h4>
    {labels.length ? <ul className="sound-tags__list">{labels.map(l => {
      const kind = l.origin === 'confirmed by you' ? 'confirmed' : l.origin === 'From filename' ? 'name' : 'maybe' in l && l.maybe ? 'maybe' : l.dimension === 'source' ? 'source' : 'detail';
      const possible = 'tier' in l && l.tier === 'possible';
      const unverified = 'uncalibrated' in l && !!l.uncalibrated;
      const hover = [DIMENSION_NAME[l.dimension as keyof typeof DIMENSION_NAME] ?? l.dimension,
        l.origin === 'From filename' ? 'from the file name, not the audio' : l.origin,
        ...(unverified ? ['unverified: no tested detector for this sound yet; raw CLAP similarity, not calibrated'] : possible ? ['possible: detector score 0.40–0.49, not calibrated (not a 40% chance)'] : []),
        ...(l.scores ?? []).map(s => `${s.model} ${s.score.toFixed(2)}`)].join(' · ');
      return <li key={`${l.dimension}:${l.label}`} className={`sound-tag sound-tag--${kind}${possible ? ' sound-tag--possible' : ''}`} data-tier={'tier' in l ? l.tier : undefined} title={hover}>
        {kind === 'confirmed' && <span className="sound-tag__mark" aria-hidden="true">✓</span>}
        <span>{soundLabelText(l.label)}</span>
        {kind === 'name' && <span className="sound-tag__note">name</span>}
        {unverified ? <span className="sound-tag__note">unverified</span> : possible ? <span className="sound-tag__note">possible</span> : kind === 'maybe' && <span className="sound-tag__note">maybe</span>}
        <span className="sr-only"> — {hover}</span>
      </li>;
    })}</ul> : !extras.length && <p className="sound-tags__empty">Nothing identified yet</p>}
    {extras.length>0&&<ul className="sound-tags__list sound-tags__list--likely" aria-label="Likely, not yet tested">{extras.map(row=>{
      const hover=`${DIMENSION_NAME[row.dimension]} · likely: model score ${row.probabilityScore!.toFixed(2)}, not checked by a tested detector for this clip (not a chance) · display only, not used for links`;
      return <li key={`${row.dimension}:${row.label}`} className="sound-tag sound-tag--likely-extra" title={hover}>
        <span>{soundLabelText(row.label)}</span><span className="sound-tag__note">likely</span><span className="sr-only"> — {hover}</span>
      </li>;
    })}</ul>}
  </section>;
}

/** Each model's own top guesses with its raw score. Scales differ between models
 * (AST and Jamendo give probabilities, CLAP gives similarity), so bars are not compared across rows. */
export function ModelScores({ profile, audio }: { profile?: SoundProfile; audio?: MusicAnalysis }) {
  const models: { model: string; complete: boolean; candidates: { label: string; score: number; untested?: boolean }[] }[] = [];
  // The trained detector only counts when its run is qualified for this recording.
  const fusion = audio ? fusionPresentation(audio.fusion, audio.durationSeconds, audio.recognition?.mode ?? 'full') : undefined;
  if (fusion?.qualified) {
    const best = new Map<string, number>(), untested = new Set<string>();
    for (const w of fusion.windows) if (w.status === 'complete') for (const d of w.decisions) {
      if (d.headProbability !== null) best.set(d.label, Math.max(best.get(d.label) ?? 0, d.headProbability));
      // Heads that failed held-out testing never decide a tag; their raw score is shown but marked.
      if (!d.eligible) untested.add(d.label);
    }
    if (best.size) models.push({ model: 'Trained detector', complete: true,
      candidates: [...best].map(([label, score]) => ({ label: fusionLabelText(label as Parameters<typeof fusionLabelText>[0]), score, untested: untested.has(label) })) });
  }
  // Trained DJ heads store their scores on the tags they produced, not in profile.models.
  const heads = new Map<string, number>();
  for (const t of profile?.djTags ?? []) if ((t.model === 'Trained head' || t.model === 'Trained head (maybe)') && t.group !== 'source' && Number.isFinite(t.score)) heads.set(t.label, Math.max(heads.get(t.label) ?? 0, t.score));
  if (heads.size) models.push({ model: 'Trained sounds', complete: true, candidates: [...heads].map(([label, score]) => ({ label, score })) });
  models.push(...(profile?.models.filter(m => m.candidates.length) ?? []));
  if (!models.length) return null;
  return <details className="model-scores">
    <summary>Model scores</summary>
    <div className="model-scores__grid">{models.map(m => <div key={m.model} className="model-scores__model">
      <h5>{m.model}{!m.complete && <small> · partial</small>}</h5>
      <ul>{[...m.candidates].sort((a, b) => b.score - a.score).slice(0, 4).map(c => <li key={c.label} className={c.untested ? 'model-scores__item--untested' : undefined}
        title={c.untested ? 'This detector failed testing, so it never adds a sound tag' : undefined}>
        <span className="model-scores__label">{soundLabelText(c.label)}{c.untested && <small className="model-scores__flag"> untested</small>}</span>
        <span className="model-scores__bar" aria-hidden="true"><span style={{ width: `${Math.max(2, Math.min(100, c.score * 100))}%` }} /></span>
        <span className="model-scores__value">{c.score.toFixed(2)}</span>
      </li>)}</ul>
    </div>)}</div>
    <p className="model-scores__note">Each model scores on its own scale.</p>
  </details>;
}
