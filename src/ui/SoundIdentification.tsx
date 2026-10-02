import type { SoundProfile } from '../audio/soundProfile';
type SoundProps = { preliminary?: boolean; profile: SoundProfile; sourceOverride?: { label: string; origin: string; allowVoice?: boolean } };

export function SoundExplanation({ profile, sourceOverride, preliminary = false }: SoundProps) {
  return <>
    {sourceOverride ? <p>Instrument source: {sourceOverride.origin}.</p> : profile.source ? <p>Instrument estimated by {profile.source.basis}{profile.source.corroborated ? ', with support from another model' : ''}. This is not a confirmed instrument or preset.</p> : <p>No instrument was identified confidently.</p>}
    {(!sourceOverride || sourceOverride.allowVoice) && profile.voice && (profile.source?.label !== 'voice' || profile.voice.style) && <p>Voice estimated by {profile.voice.basis}{profile.voice.corroborated ? ', with support from another model' : ''}.{profile.voice.style ? ` Music CLAP suggests ${profile.voice.style}.` : ''}</p>}
    {preliminary && <p>Early estimate; verification is still in progress.</p>}
    {profile.disagreement && <p>The instrument models disagree, so the estimate is uncertain.</p>}
  </>;
}

export function SoundModelComparisons({ profile }: { profile: SoundProfile }) {
  const results = profile.models.filter(model => model.candidates.length > 0 || (model.model === 'Music CLAP' && profile.voice?.style));
  if (!results.length) return null;
  return <details>
    <summary>Model comparisons</summary>
    <ul>{results.map(model => <li key={model.model}><strong>{model.model}</strong>: {[...model.candidates.map(c => c.label), ...(model.model === 'Music CLAP' && profile.voice?.style ? [`${profile.voice.style} (estimate)`] : [])].join(', ')}{!model.complete ? ' — partial result' : ''}</li>)}</ul>
    <p>Individual model guesses; the combined result is shown above.</p>
  </details>;
}

export default function SoundIdentification({ summaryOnly = false, ...props }: SoundProps & { summaryOnly?: boolean }) {
  const labels = (props.sourceOverride?.label ?? props.profile.source?.label ?? '').split(', ').filter(Boolean);
  if (props.profile.voice && (!props.sourceOverride || props.sourceOverride.allowVoice)) {
    const voiceLabel = props.profile.voice.style === 'vocal chops' ? 'vocal chops' : 'voice';
    if (voiceLabel !== 'voice') {
      const index = labels.indexOf('voice');
      if (index !== -1) labels.splice(index, 1);
    }
    labels.push(voiceLabel);
  }
  const source = [...new Set(labels)].join(', ');
  return <section className="music-sound-summary" aria-label="Combined sound identification">
    <dl className="music-feature-grid">
      <div><dt>Instrument</dt><dd>{source || 'Not identified yet'}</dd></div>
    </dl>
    {!summaryOnly && <>
      <details><summary>Explanations</summary><SoundExplanation {...props} /></details>
      <SoundModelComparisons profile={props.profile} />
    </>}
  </section>;
}
