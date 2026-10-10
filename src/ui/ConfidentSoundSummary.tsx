import './ConfidentSoundSummary.css';
import { filenameSoundFallback } from '../audio/filenameSoundFallback';
import type { DocNode } from '../model/types';
import { confidentSoundSummary, SOUND_DISPLAY_POLICY } from '../audio/confidentSoundSummary';
import type { MusicAnalysis } from '../audio/musicTypes';
import { soundLabelText } from '../audio/djTags';
import { likelyExtraSounds } from './MainSoundAttributes';
import { TIMBRE_DEFINITIONS, timbreDescriptions } from '../audio/timbreDescriptions';
import { djReviewAllows, resolvedNonSourceLabels } from '../audio/soundReviewPolicy';

/** The rule-measured words for how it sounds (timbreDescriptions.ts), as one plain line: not tags, no scores.
 * Words you rejected, and words already shown as tags, are left out; old analyses without a measurement show nothing. */
export function SoundDescription({audio,exclude=[]}:{audio:MusicAnalysis;exclude?:Iterable<string>}) {
  const shown=new Set(exclude);
  // A saved correction replaces automatic character evidence; later individual reviews still take precedence.
  const confirmed=audio.confirmedDjTags===undefined?undefined:new Set(resolvedNonSourceLabels(audio).filter(label=>label.group==='character').map(label=>label.label));
  const words=timbreDescriptions(audio.timbre).filter(word=>!shown.has(word)&&(!confirmed||confirmed.has(word))&&djReviewAllows(audio,'character',word));
  if(!words.length)return null;
  const hover=`Measured from the audio by fixed rules, not a trained model or a tested tag. ${words.map(word=>`${word}: ${TIMBRE_DEFINITIONS[word]}`).join('; ')}.`;
  return <p className="sound-description" title={hover}>Sound: {words.join(', ')}<span className="sr-only"> — {hover}</span></p>;
}

const ORDER = ['source', 'effect', 'character', 'vocal', 'role'] as const;
const DIMENSION_NAME = { source: 'Sound source', effect: 'Sound type', character: 'Character', vocal: 'Vocal', role: 'Role' };

/** The identified sounds as tags. Explanations live in hover text, not on the page. */
export default function ConfidentSoundSummary({audio,mode,node}:{audio:MusicAnalysis;mode?:string;node?:Pick<DocNode, 'path' | 'title'>}) {
  const scored=confidentSoundSummary(audio,mode);
  const labels=[...scored,...(node?filenameSoundFallback(audio,node,scored).map(item=>({...item,scores:undefined})):[])]
    .sort((a,b)=>ORDER.indexOf(a.dimension as typeof ORDER[number])-ORDER.indexOf(b.dimension as typeof ORDER[number]));
  // Separate, dimmed group: untested but probability-like model scores >= 0.5. Only in the real music panel (node given).
  const extras=node?likelyExtraSounds(audio,node,new Set(labels.map(l=>l.label))):[];
  return <section aria-label="Sound identification" data-display-policy={SOUND_DISPLAY_POLICY} data-filename-policy="missing-dimension-v5" className="sound-tags">
    <h4 className="sound-tags__title">Sounds</h4>
    {node && <p className="sound-tags__note">Scores are on each model’s own scale, not probabilities, and missing evidence does not prove a sound is absent.</p>}
    {labels.length ? <ul className="sound-tags__list">{labels.map(l => {
      const kind = l.origin === 'confirmed by you' ? 'confirmed' : l.origin === 'From filename' ? 'name' : 'maybe' in l && l.maybe ? 'maybe' : l.dimension === 'source' ? 'source' : 'detail';
      const possible = 'tier' in l && l.tier === 'possible';
      const unverified = 'uncalibrated' in l && !!l.uncalibrated;
      const coverageUnknown = 'coverageUnknown' in l && !!l.coverageUnknown;
      const hover = [DIMENSION_NAME[l.dimension as keyof typeof DIMENSION_NAME] ?? l.dimension,
        l.origin === 'From filename' ? 'from the file name, not the audio' : l.origin,
        ...(coverageUnknown ? ['possible: saved window evidence is incomplete; no score is established outside the tagger excerpt']
          : unverified ? ['unverified: no tested detector for this sound yet; raw CLAP similarity, not calibrated'] : possible ? ['possible: detector score 0.40–0.49, not calibrated (not a 40% chance)'] : []),
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
