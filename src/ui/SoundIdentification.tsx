import type { ResolvedDjLabel } from '../audio/soundReviewPolicy';
import { DJ_TYPE_SOURCE, type ConfirmedDjTags, type DjGroup } from '../audio/djTags';
import type { SoundProfile } from '../audio/soundProfile';
type SoundProps = { reviewedLabels?: ResolvedDjLabel[]; confirmedDjTags?: ConfirmedDjTags; preliminary?: boolean; profile: SoundProfile; sourceOverride?: { label: string; origin: string; allowVoice?: boolean } };

/**
 * The confirmed/estimated label chips, split out of SoundExplanation so the
 * panel can show them for a track that has no SoundProfile. Confirmed
 * instruments used to be printed a second time further down the panel purely
 * to cover that case; this component is now the single place they appear, so
 * `profile` is optional.
 */
export function SoundTagGroups({ profile, confirmedDjTags, reviewedLabels }: Omit<SoundProps, 'profile'> & { profile?: SoundProfile }) {
  if (!((profile?.djTags?.length ?? 0)>0 || confirmedDjTags || reviewedLabels?.length)) return null;
  return <dl className="dj-tag-groups">{(['source','production','character'] as DjGroup[]).map(group=>{
    // Each label is its own chip, but the label STRING stays whole inside it:
    // tests assert the group's textContent contains "distorted (confirmed by
    // you)" contiguously, so the suffix must not be split into a sibling.
    const values = group !== 'source' && reviewedLabels
      ? reviewedLabels.filter(t=>t.group===group).map(t=>t.label+(t.source==='confirmed'&&!confirmedDjTags?' (confirmed by you)':''))
      : confirmedDjTags?.[group] ?? profile?.djTags?.filter(t=>t.group===group).map(t=>t.label) ?? [];
    return <div key={group}>
      <dt>{group==='production'?'Production type':group==='source'?'Source':'Character'}</dt>
      <dd>{values.length ? values.map(value=><span className="chip" key={value}>{value}</span>) : <span className="chip chip--empty">Uncertain</span>}</dd>
    </div>;
  })}</dl>;
}

const GROUP_NAME: Record<DjGroup, string> = { source: 'Source', production: 'Production type', character: 'Character' };
const labelKey = (label: string) => label.replaceAll('_', ' ').toLowerCase();

/**
 * Untested model guesses, shown next to the tested Sounds row so they are visible
 * without opening Technical details. Confirmed labels and anything already shown
 * in Sounds are left out, and empty groups are hidden.
 */
export function OtherModelGuesses({ profile, confirmedDjTags, reviewedLabels, exclude, skipSource = false }: {
  profile?: SoundProfile; confirmedDjTags?: ConfirmedDjTags; reviewedLabels?: ResolvedDjLabel[];
  /** Labels the Sounds row already shows. */ exclude: Iterable<string>; /** Instruments are confirmed or named, so source guesses are moot. */ skipSource?: boolean;
}) {
  const shown = new Set([...exclude].map(labelKey));
  const groups = (['source', 'production', 'character'] as DjGroup[]).flatMap(group => {
    if (group === 'source' ? skipSource || confirmedDjTags : confirmedDjTags) return [];
    const raw = group !== 'source' && reviewedLabels?.length
      ? reviewedLabels.filter(t => t.group === group && t.source !== 'confirmed').map(t => t.label)
      : profile?.djTags?.filter(t => t.group === group).map(t => t.label) ?? [];
    const values = [...new Set(raw)].filter(label => !shown.has(labelKey(label)));
    return values.length ? [{ group, values }] : [];
  });
  if (!groups.length) return null;
  return <section className="sound-guesses" aria-label="Other model guesses">
    <h4 className="sound-tags__title">Other model guesses</h4>
    <dl className="dj-tag-groups sound-guesses__groups">{groups.map(({ group, values }) => <div key={group}>
      <dt>{GROUP_NAME[group]}</dt>
      <dd>{values.map(value => <span className="chip chip--guess" key={value} title="From a model that has not passed held-out testing">{value.replaceAll('_', ' ')}</span>)}</dd>
    </div>)}</dl>
  </section>;
}

export function SoundExplanation({ profile, sourceOverride, confirmedDjTags, reviewedLabels, preliminary = false, showTags = true }: SoundProps & { showTags?: boolean }) {
  return <>
    {confirmedDjTags ? <p className="sound-origin"><span className="rec-badge rec-badge--confirmed">confirmed by you</span></p> : sourceOverride ? <p>Instrument source: {sourceOverride.origin}.</p> : profile.source ? <p>Sound estimated by {profile.source.basis}{profile.source.corroborated ? ', with support from another model' : ''}. This is not a confirmed instrument or preset.</p> : <p>No instrument was identified confidently.</p>}
    {!confirmedDjTags && (!sourceOverride || sourceOverride.allowVoice) && profile.voice && (profile.source?.label !== 'voice' || profile.voice.style) && <p>Voice estimated by {profile.voice.basis}{profile.voice.corroborated ? ', with support from another model' : ''}.{profile.voice.style ? ` ${profile.voice.basis === 'Reviewed examples' ? 'Reviewed examples' : 'Music CLAP'} suggests ${profile.voice.style}.` : ''}</p>}
    {showTags && <SoundTagGroups profile={profile} confirmedDjTags={confirmedDjTags} reviewedLabels={reviewedLabels} />}
    {preliminary && <p>Early estimate; verification is still in progress.</p>}
    {profile.disagreement && <p>The instrument models disagree, so the estimate is uncertain.</p>}
  </>;
}

export function SoundModelComparisons({ profile }: { profile: SoundProfile }) {
  const djTypes=profile.djTags?.filter(t=>t.group==='production' && t.model!=='AudioSet AST' && t.model!=='Reviewed examples').map(t=>t.label) ?? [];
  const results = profile.models.filter(model => model.candidates.length > 0 || (model.model === 'Music CLAP' && (profile.voice?.style || djTypes.length)));
  if (!results.length) return null;
  return <details>
    <summary>Model comparisons</summary>
    <ul>{results.map(model => <li key={model.model}><strong>{model.model}</strong>: {[...new Set([...model.candidates.map(c => c.label), ...(model.model === 'Music CLAP' ? [...djTypes, ...(profile.voice?.style ? [profile.voice.style] : [])].map(label=>`${label} (estimate)`) : [])])].join(', ')}{!model.complete ? ' — partial result' : ''}</li>)}</ul>
    <p>Individual model guesses; the combined result is shown above.</p>
  </details>;
}

export default function SoundIdentification({ summaryOnly = false, ...props }: SoundProps & { summaryOnly?: boolean }) {
  const labels = (props.sourceOverride?.label ?? props.profile.source?.label ?? '').split(', ').filter(Boolean);
  if (!props.sourceOverride) labels.push(...(props.profile.djTags ?? []).filter(t=>t.group==='source'&&t.model==='Reviewed examples').map(t=>t.label));
  if (props.profile.voice && (!props.sourceOverride || props.sourceOverride.allowVoice)) {
    const voiceLabel = props.profile.voice.style === 'vocal chops' ? 'vocal chops' : 'voice';
    if (voiceLabel !== 'voice') {
      const index = labels.indexOf('voice');
      if (index !== -1) labels.splice(index, 1);
    }
    labels.push(voiceLabel);
  }
  const autoType = props.profile.djTags?.find(t=>t.group==='production' && (t.model==='Reviewed examples' || !DJ_TYPE_SOURCE[t.label] || DJ_TYPE_SOURCE[t.label]===props.profile.source?.label))?.label;
  const source = props.confirmedDjTags
    ? props.confirmedDjTags.production.join(', ') || props.confirmedDjTags.source.join(', ') || 'No sound type confirmed'
    : !props.sourceOverride && autoType && labels.length<=1 ? autoType : [...new Set(labels)].join(', ');
  return <section className="music-sound-summary" aria-label="Combined sound identification">
    <dl className="music-feature-grid">
      <div><dt>Sound</dt><dd>{source || 'Not identified yet'}</dd></div>
    </dl>
    {props.profile.character.length > 0 && !props.confirmedDjTags && <div className="sound-character-chips" aria-label="Estimated sound character">{props.profile.character.slice(0, 3).map(label => <span className="chip" key={label}>{label}</span>)}</div>}
    {!summaryOnly && <>
      <details><summary>Explanations</summary><SoundExplanation {...props} /></details>
      <SoundModelComparisons profile={props.profile} />
    </>}
  </section>;
}
