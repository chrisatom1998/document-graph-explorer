import { resolvedNonSourceLabels, reviewedSoundProfile } from '../audio/soundReviewPolicy';
import { useMusicJobs } from '../store/musicJobs';
import CopilotProperties from './CopilotProperties';
import MainSoundAttributes from './MainSoundAttributes';
import ConfidentSoundSummary from './ConfidentSoundSummary';
import { resolveTempoKey } from '../audio/resolvedTempoKey';
import { confirmedInstrumentList, sourceReviewAllows } from '../audio/instrumentEvidence';
import { useState } from 'react';
import type { DocNode } from '../model/types';
import { KEY_NAMES, keyName, type InstrumentEstimate } from '../audio/musicTypes';
import { isBroadInstrument } from '../audio/instrumentLabels';
import { useGraphStore } from '../store/graphStore';
import { OtherModelGuesses, SoundExplanation } from './SoundIdentification';
import { confidentSoundSummary } from '../audio/confidentSoundSummary';
import { filenameSoundFallback } from '../audio/filenameSoundFallback';
import { RecognitionDiagnostics, type RecognitionEvidenceProps } from './RecognitionEvidence';
import { clockTime as time } from './clockTime';
import TrackStructure from './TrackStructure';
import TrackVersions from './TrackVersions';
import { camelotCode } from '../audio/mixSuggestions';
import MusicNeighbours from './MusicNeighbours';
import { energyFromScore, genreFromScores, genreText, styleName } from '../audio/genreEnergy';
/** `onMessage` hands analysis status lines to the parent so the panel shows one status slot (the player shares it). */
export default function MusicFeatures({ node, onSeek, onMessage }: { node: DocNode; onSeek?: (seconds: number) => void; onMessage?: (text: string) => void }) {
  const job = useMusicJobs(s => s.jobs[node.id]);
  const phase = useGraphStore(s => s.phase);
  const nodes = useGraphStore(s => s.nodes);
  const nodeIndex = useGraphStore(s => s.nodeIndex);
  const edges = useGraphStore(s => s.edges);
  const [controller, setController] = useState<AbortController | null>(null);
  const [ownMessage, setOwnMessage] = useState('');
  const message = onMessage ? '' : ownMessage;
  const setMessage = (text: string) => { if (onMessage) onMessage(text); else setOwnMessage(text); };
  const analysis = node.audio;
  const confirmed = analysis ? confirmedInstrumentList(analysis) : undefined;
  const reviewedLabels = analysis ? resolvedNonSourceLabels(analysis) : [];
  // What the Sounds row already shows, so the untested guesses below it never repeat a tag.
  const shownSounds = analysis ? (() => { const scored = confidentSoundSummary(analysis); return [...scored, ...filenameSoundFallback(analysis, node, scored)].map(s => s.label); })() : [];
  // Keyed off `confirmed`, not off confirmedDjTags: a track confirmed through
  // the legacy confirmedInstruments field (or through a source review) has no
  // confirmedDjTags, and gating on that used to leave the chips empty and force
  // a second "Confirmed instruments" list further down the panel.
  const confirmedTags=confirmed!==undefined?{...(analysis?.confirmedDjTags??{source:[],production:[],character:[]}),source:confirmed,
    production:reviewedLabels.filter(t=>t.group==='production'&&t.source==='confirmed').map(t=>t.label),
    character:reviewedLabels.filter(t=>t.group==='character'&&t.source==='confirmed').map(t=>t.label)}:undefined;
  const profile = analysis ? reviewedSoundProfile(analysis) : undefined;
  const displayProfile=profile&&analysis?{...profile,
    source:profile.source&&sourceReviewAllows(analysis,profile.source.label)?profile.source:undefined,
    voice:sourceReviewAllows(analysis,'voice')?profile.voice:undefined,
    djTags:profile.djTags?.filter(tag=>tag.group!=='source'||sourceReviewAllows(analysis,tag.label))}:undefined;

  const resolved = resolveTempoKey(node);
  const rawHints = resolved.hints;
  const allowedHints=rawHints.instruments?.value.filter(label=>!analysis||sourceReviewAllows(analysis,label));
  const hints={...rawHints,instruments:allowedHints?.length?{...rawHints.instruments!,value:allowedHints}:undefined};
  // Use the filename's spelling when the model found the same musical key.
  // Keep genuinely different predictions visible instead of relabeling them.
  const sameNamedKey = !!analysis?.key && !!hints.key && analysis.key.tonic === hints.key.value.tonic && analysis.key.mode === hints.key.value.mode;
  // Compare the values as displayed (one decimal), so the card and the technical details always agree.
  const tempoDiffers = !!hints.tempo && !!analysis?.tempo && Number(hints.tempo.value.toFixed(1)) !== Number(analysis.tempo.bpm.toFixed(1));
  const run = async () => {
    const abort = new AbortController(); setController(abort); setMessage('');
    try {
      const { analyzeAudioCorpus } = await import('../pipeline/coordinatorLazy');
      await analyzeAudioCorpus([node.id], abort.signal);
      setMessage(useMusicJobs.getState().jobs[node.id] ? 'Initial analysis ready. Full verification continues in the background.' : 'Analysis finished. Results and any warnings are shown here.');
    } catch (error) { setMessage(abort.signal.aborted ? 'Analysis cancelled.' : error instanceof Error ? error.message : 'Analysis failed.'); }
    finally { setController(null); }
  };
  const genre = genreFromScores(analysis?.genreScores?.scores), energy = energyFromScore(analysis?.energyScore);
  const list = (items: InstrumentEstimate[]) => <ul className="music-instruments">{items.map(i => <li key={i.label}>
    <span>{i.label}{isBroadInstrument(i.label) ? ' (family only)' : ''}</span>
    {i.segments?.[0] && <button type="button" disabled={!onSeek} onClick={() => onSeek?.(i.segments![0].start)} aria-label={`Listen for ${i.label} at ${time(i.segments[0].start)}`}>Listen at {time(i.segments[0].start)}</button>}
  </li>)}</ul>;
  const likely = analysis?.instruments.filter(i => i.status === 'likely' && sourceReviewAllows(analysis,i.label)) ?? [];
  const prediction = analysis?.instrumentPrediction && sourceReviewAllows(analysis,analysis.instrumentPrediction.label) ? analysis.instrumentPrediction : undefined;
  const possible = analysis?.instruments.filter(i => i.status === 'possible' && i.label !== prediction?.label) ?? [];
  const recognitionProps: RecognitionEvidenceProps | undefined = analysis?.recognition ? {
    recognition: analysis.recognition, fusion: analysis.fusion, duration: analysis.durationSeconds, onSeek,
    reviews: analysis.soundReviews, confirmedInstruments: confirmed ?? []
  } : undefined;
  return <section className="music-features" aria-label="Musical features">
    <h3 className="sr-only">Track details</h3>
    {/* One line about the analysis state, with the fix inline instead of inside Track actions. */}
    {analysis?.stage === 'preview'
      ? <p role="status" className="music-status">{job || phase === 'parsing' ? 'Quick estimate — still checking in the background.' : <>Quick estimate only{analysis.recognition && analysis.recognition.status !== 'complete' ? `; analysis ${analysis.recognition.status}` : ''}. Reanalyze to finish. <button type="button" className="music-status__action" disabled={phase !== 'ready' || !!controller} onClick={() => void run()}>Finish analysis</button></>}</p>
      : analysis && (analysis.instrumentScan && !analysis.instrumentScan.complete || analysis.recognition && analysis.recognition.status !== 'complete')
        ? <p role="status" className="music-status">Analysis: {analysis.recognition && analysis.recognition.status !== 'complete' ? analysis.recognition.status : 'incomplete'}. <button type="button" className="music-status__action" disabled={phase !== 'ready' || !!controller} onClick={() => void run()}>{controller ? 'Analyzing…' : 'Finish analysis'}</button></p>
        : null}
    {analysis ? <>
      <dl className="music-stats">
        <div><dt>Length</dt><dd>{time(analysis.durationSeconds)}</dd></div>
        <div><dt>Tempo{hints.tempo && <small>from name</small>}</dt>{resolved.tempo
          ? <dd>{Number(resolved.tempo.bpm.toFixed(1))} BPM{tempoDiffers && <small className="music-stats__audio" title="The audio estimate differs from the file or folder name">audio {Number(analysis.tempo!.bpm.toFixed(1))}</small>}</dd>
          : <dd className="is-unknown" title={analysis.stage === 'preview' ? 'Not checked yet' : 'No steady beat detected'}>{analysis.stage === 'preview' ? '…' : '—'}</dd>}</div>
        <div><dt>Key{hints.key && <small>from name</small>}</dt>{resolved.key
          ? <dd>{resolved.keyLabel} <span className="camelot" title="Camelot wheel code">{camelotCode(resolved.key)}</span>{!!hints.key && !!analysis.key && !sameNamedKey && <small className="music-stats__audio" title="The audio estimate differs from the file or folder name">audio {keyName(analysis.key)}</small>}</dd>
          : <dd className="is-unknown" title={analysis.stage === 'preview' ? 'Not checked yet' : 'No stable key detected'}>{analysis.stage === 'preview' ? '…' : '—'}</dd>}</div>
        {genre && <div title={genre.tested ? 'Estimated from the audio by a tested genre rule' : 'Estimated from the audio; this genre did not reach 70% precision and recall in testing'}>
          <dt>Genre{!genre.tested && <small>maybe</small>}</dt><dd className="music-genre">{genreText(genre.label)}</dd></div>}
        {energy && <div title={energy.tested ? 'Estimated from the audio by a tested energy model' : 'Estimated from the audio; not reliable enough in testing to count as tested'}>
          <dt>Energy{!energy.tested && <small>maybe</small>}</dt><dd className="music-energy">{energy.level}</dd></div>}
      </dl>
      {analysis.structure && <TrackStructure structure={analysis.structure} duration={analysis.durationSeconds} onSeek={onSeek} />}
      <TrackVersions node={node} />
      <ConfidentSoundSummary audio={analysis} node={node} />
      <OtherModelGuesses profile={displayProfile} confirmedDjTags={analysis.confirmedDjTags ? confirmedTags : undefined} reviewedLabels={reviewedLabels}
        skipSource={confirmed !== undefined || !!hints.instruments} exclude={shownSounds} />
      <MusicNeighbours node={node} nodes={nodes} nodeIndex={nodeIndex} edges={edges} />
      <details className="music-analysis-details">
        <summary>Technical details</summary>
        <MainSoundAttributes audio={analysis} node={node} />
        {recognitionProps && <RecognitionDiagnostics {...recognitionProps} />}
        {!!analysis.styles?.length && <p>Closest music styles: {analysis.styles.slice(0, 5).map(s => `${styleName(s.label)} ${Math.round(s.score * 100)}%`).join(', ')}.</p>}
        <CopilotProperties audio={analysis} />
        {analysis.soundProfile && <SoundExplanation showTags={false} reviewedLabels={reviewedLabels} confirmedDjTags={confirmedTags} preliminary={analysis.stage === 'preview'} profile={displayProfile!} sourceOverride={confirmed !== undefined ? { label: confirmed.join(', ') || 'No confirmed instruments', origin: 'confirmed by you' } : hints.instruments ? { label: hints.instruments.value.join(', '), origin: hints.instruments.source, allowVoice: true } : undefined} />}
      {!hints.key && !analysis.key && analysis.detectedPitch && <p>Detected pitch: {KEY_NAMES[analysis.detectedPitch.pitchClass]}. A repeated note alone cannot establish a major/minor key, so it does not create key links.</p>}
      {!hints.tempo && !!analysis.tempo?.alternatives?.length && <p>Short-clip tempo: {analysis.tempo.alternatives.map(bpm => `${bpm.toFixed(1)} BPM`).join(' or ')} may also fit at half or double time.</p>}
      {confirmed === undefined && !analysis.recognition && analysis.version !== 1 && <>
        {prediction && !analysis.soundProfile && <>
          <h4>Estimated instrument</h4>
          <p className="automatic-instrument">{prediction.label}</p>
          <p>Automatically classified from the audio.{prediction.model ? ` Music model: ${prediction.model}.` : ''}{prediction.margin < 0.025 ? ' Uncertain: another instrument sounds very similar.' : ' This is the closest instrument match, not a confirmed label.'}</p>
        </>}
        {likely.length > 0 ? <><h4>Likely instruments</h4>{list(likely)}</> : !prediction && possible.length > 0 ? <>
          <h4>Suggested instruments</h4>
          {list(possible)}
          <p>Low-confidence suggestions from the audio. These do not create instrument links.</p>
        </> : !prediction && !analysis.soundProfile && <><h4>Instrument detection</h4><p>No confident instrument match. An instrument may still be present.</p></>}
        {(likely.length > 0 || prediction) && possible.length > 0 && <details><summary>Possible instruments ({possible.length})</summary><p>Weaker detections. These do not create instrument links.</p>{list(possible)}</details>}
        {analysis.instrumentScan && <p>{analysis.stage === 'preview' ? 'Verification coverage' : analysis.instrumentScan.mode === 'fast' ? 'Sampled instrument scan' : analysis.instrumentScan.complete ? 'Full-track instrument scan' : 'Partial instrument scan'}: {time(analysis.instrumentScan.analyzedSeconds)} of {time(analysis.durationSeconds)}.</p>}
      </>}
      {analysis.version === 1 && <p>Earlier instrument estimates used short excerpts. Reanalyze to scan the full track.</p>}
      </details>
    </> : <>
      <p>Analyze this track to find its tempo, key, and instruments.</p>
      {/* Title and your own links exist before analysis, so the list still shows them. */}
      <MusicNeighbours node={node} nodes={nodes} nodeIndex={nodeIndex} edges={edges} />
    </>}
    <details className="music-track-actions"><summary>Track actions</summary>
    <button type="button" aria-label={analysis ? 'Reanalyze musical features' : 'Analyze musical features'} disabled={phase !== 'ready' || !!controller} onClick={() => void run()}>{controller ? 'Analyzing…' : analysis ? 'Reanalyze' : 'Analyze track'}</button>
    {controller && <button type="button" onClick={() => controller.abort()}>Cancel analysis</button>}
    </details>
    {message && <p role="status">{message}</p>}
  </section>;
}
