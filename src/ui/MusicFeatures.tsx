import { resolvedNonSourceLabels, reviewedSoundProfile } from '../audio/soundReviewPolicy';
import { useMusicJobs } from '../store/musicJobs';
import CopilotProperties from './CopilotProperties';
import MainSoundAttributes from './MainSoundAttributes';
import ConfidentSoundSummary, { ModelScores } from './ConfidentSoundSummary';
import MusicAnalysisMode from './MusicAnalysisMode';
import { musicNameHints, type NamedHint } from '../audio/nameHints';
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
import { camelotCode } from './musicDisplay';
import MusicNeighbours from './MusicNeighbours';
export default function MusicFeatures({ node, onSeek }: { node: DocNode; onSeek?: (seconds: number) => void }) {
  const job = useMusicJobs(s => s.jobs[node.id]);
  const phase = useGraphStore(s => s.phase);
  const nodes = useGraphStore(s => s.nodes);
  const nodeIndex = useGraphStore(s => s.nodeIndex);
  const edges = useGraphStore(s => s.edges);
  const [controller, setController] = useState<AbortController | null>(null);
  const [message, setMessage] = useState('');
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

  const rawHints = musicNameHints(node);
  const allowedHints=rawHints.instruments?.value.filter(label=>!analysis||sourceReviewAllows(analysis,label));
  const hints={...rawHints,instruments:allowedHints?.length?{...rawHints.instruments!,value:allowedHints}:undefined};
  // Use the filename's spelling when the model found the same musical key.
  // Keep genuinely different predictions visible instead of relabeling them.
  const sameNamedKey = !!analysis?.key && !!hints.key && analysis.key.tonic === hints.key.value.tonic && analysis.key.mode === hints.key.value.mode;
  const audioKeyLabel = analysis?.key ? sameNamedKey ? hints.key!.displayName : keyName(analysis.key) : 'undetermined';
  const audioPitchLabel = analysis?.detectedPitch
    ? hints.key?.value.tonic === analysis.detectedPitch.pitchClass ? hints.key.displayName.split(' ')[0] : KEY_NAMES[analysis.detectedPitch.pitchClass]
    : undefined;
  const tempoDiffers = !!hints.tempo && !!analysis?.tempo && Math.abs(hints.tempo.value - analysis.tempo.bpm) > 0.5;
  const nameDisagrees = (!!hints.key && !!analysis?.key && !sameNamedKey)
    || (!!hints.tempo && !!analysis?.tempo && Math.abs(hints.tempo.value - analysis.tempo.bpm) > 0.01);
  const nameSources = new Map<string, { source: string; name: string; values: string[] }>();
  const addSource = (hint: NamedHint<unknown> | undefined, value: string) => {
    if (!hint) return;
    const id = JSON.stringify([hint.source, hint.name]);
    const group = nameSources.get(id) ?? { source: hint.source === 'file name' ? 'filename' : 'folder', name: hint.name, values: [] };
    group.values.push(value);
    nameSources.set(id, group);
  };
  addSource(hints.key, hints.key ? hints.key.displayName : '');
  addSource(hints.tempo, hints.tempo ? `${hints.tempo.value} BPM` : '');
  if (hints.pitch && hints.pitch.value !== hints.key?.value.tonic) addSource(hints.pitch, `Pitch ${KEY_NAMES[hints.pitch.value]}`);
  addSource(hints.instruments, hints.instruments?.value.join(', ') ?? '');
  const run = async () => {
    const abort = new AbortController(); setController(abort); setMessage('');
    try {
      const { analyzeAudioCorpus } = await import('../pipeline/coordinatorLazy');
      await analyzeAudioCorpus([node.id], abort.signal);
      setMessage(useMusicJobs.getState().jobs[node.id] ? 'Initial analysis ready. Full verification continues in the background.' : 'Analysis finished. Results and any warnings are shown here.');
    } catch (error) { setMessage(abort.signal.aborted ? 'Analysis cancelled.' : error instanceof Error ? error.message : 'Analysis failed.'); }
    finally { setController(null); }
  };
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
    {analysis?.stage === 'preview' && <p role="status" className="music-status">{job || phase === 'parsing' ? 'Quick estimate — still checking in the background.' : 'Quick estimate only. Reanalyze to finish.'}</p>}
    {analysis?.instrumentScan && !analysis.instrumentScan.complete && analysis.stage !== 'preview' && <p role="status" className="music-status">Analysis incomplete. Reanalyze to finish.</p>}
    {analysis?.recognition && analysis.recognition.status !== 'complete' && <p role="status" className="music-status">Analysis: {analysis.recognition.status}.</p>}
    {analysis ? <>
      <dl className="music-stats">
        <div><dt>Length</dt><dd>{time(analysis.durationSeconds)}</dd></div>
        <div><dt>Tempo{hints.tempo && <small>from name</small>}</dt>{hints.tempo || analysis.tempo
          ? <dd>{Number((hints.tempo ? hints.tempo.value : analysis.tempo!.bpm).toFixed(1))} BPM{tempoDiffers && <small className="music-stats__audio" title="The audio estimate differs from the file or folder name">audio {Number(analysis.tempo!.bpm.toFixed(1))}</small>}</dd>
          : <dd className="is-unknown" title={analysis.stage === 'preview' ? 'Not checked yet' : 'No steady beat detected'}>{analysis.stage === 'preview' ? '…' : '—'}</dd>}</div>
        <div><dt>Key{hints.key && <small>from name</small>}</dt>{hints.key || analysis.key
          ? <dd>{hints.key ? hints.key.displayName : keyName(analysis.key!)} <span className="camelot" title="Camelot wheel code">{camelotCode(hints.key ? hints.key.value : analysis.key!)}</span>{!!hints.key && !!analysis.key && !sameNamedKey && <small className="music-stats__audio" title="The audio estimate differs from the file or folder name">audio {keyName(analysis.key)}</small>}</dd>
          : <dd className="is-unknown" title={analysis.stage === 'preview' ? 'Not checked yet' : 'No stable key detected'}>{analysis.stage === 'preview' ? '…' : '—'}</dd>}</div>
      </dl>
      <ConfidentSoundSummary audio={analysis} node={node} />
      <OtherModelGuesses profile={displayProfile} confirmedDjTags={analysis.confirmedDjTags ? confirmedTags : undefined} reviewedLabels={reviewedLabels}
        skipSource={confirmed !== undefined || !!hints.instruments} exclude={shownSounds} />
      <MusicNeighbours node={node} nodes={nodes} nodeIndex={nodeIndex} edges={edges} />
      <ModelScores profile={displayProfile} audio={analysis} />
      <MainSoundAttributes audio={analysis} node={node} />
      <details className="music-analysis-details">
        <summary>Technical details</summary>
        {recognitionProps && <RecognitionDiagnostics {...recognitionProps} />}
        {!!analysis.soundReviews?.length && <p>Saved reviews remain effective and take precedence over earlier confirmations.</p>}
        <CopilotProperties audio={analysis} />
        {analysis.soundProfile && <SoundExplanation showTags={false} reviewedLabels={reviewedLabels} confirmedDjTags={confirmedTags} preliminary={analysis.stage === 'preview'} profile={displayProfile!} sourceOverride={confirmed !== undefined ? { label: confirmed.join(', ') || 'No confirmed instruments', origin: 'confirmed by you' } : hints.instruments ? { label: hints.instruments.value.join(', '), origin: hints.instruments.source, allowVoice: true } : undefined} />}
      {(hints.tempo || hints.key || hints.pitch || hints.instruments) && <>
        {[...nameSources].map(([id, group]) => <p key={id}>From {group.source}: {group.values.join(' · ')}</p>)}
        <p>These labels are used to connect tracks. They come from the file or folder name, not from listening to the audio.</p>
        <details className="music-name-sources">
          <summary>View source names</summary>
          <dl>{[...nameSources].map(([id, group]) => <div key={id}><dt>{group.source === 'filename' ? 'Filename' : 'Folder'} — {group.values.join(' · ')}</dt><dd>{group.name}</dd></div>)}</dl>
        </details>
        {(hints.tempo || hints.key) && <p>Audio comparison: tempo {analysis.tempo ? `${analysis.tempo.bpm.toFixed(1)} BPM` : 'uncertain'}; key {audioKeyLabel}{audioPitchLabel ? `; detected pitch ${audioPitchLabel}` : ''}.{nameDisagrees ? ' Differences may reflect an inaccurate tag or an uncertain audio estimate.' : ''}</p>}
      </>}
      {!hints.key && !analysis.key && analysis.detectedPitch && <p>Detected pitch: {KEY_NAMES[analysis.detectedPitch.pitchClass]}. A repeated note alone cannot establish a major/minor key, so it does not create key links.</p>}
      {!hints.tempo && !!analysis.tempo?.alternatives?.length && <p>Short-clip tempo: {analysis.tempo.alternatives.map(bpm => `${bpm.toFixed(1)} BPM`).join(' or ')} may also fit at half or double time. Half/double-time connections are labeled separately and weighted lower.</p>}
      {hints.instruments && confirmed === undefined && <>
        <h4>Instruments from name</h4>
        <p>{hints.instruments.value.join(', ')}</p>
        <p>Used as lower-strength connection hints when reviewed or reliable audio instruments are unavailable. Sound-based estimates remain below for comparison.</p>
      </>}
      {confirmed !== undefined ? <>
        {/* Confirmed labels appear as ✓ tags in the Sounds row at the top. */}
        <p>Confirmed by you. These instruments are used for connections.</p>
      </> : analysis.recognition ? <p>Model guesses are shown at the top; their evidence and coverage are above. Your saved reviews remain separate from model estimates.</p> : analysis.version === 1 ? <p>Earlier instrument estimates used short excerpts. Reanalyze to scan the full track.</p> : <>
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
      <section className="music-analysis-notes" aria-label="Limits and connection rules">
        <h4>Limits and connection rules</h4>
        <p>Tempo and key use {Math.round(analysis.analyzedSeconds)} seconds of excerpts. Instrument estimates can miss sounds or confuse similar timbres; an unlisted instrument may still be present.</p>
        {analysis.notes.filter(note => !analysis.confirmedInstruments || !note.startsWith('No instruments identified')).map(note => <p key={note}>{note}</p>)}
        <p>Connections use tempo, compatible keys, instruments, and confirmed sound properties. Half/double-time matches and name hints are labeled with lower strength. Your reviews take priority; unknown evidence does not match. Up to 8 audio neighbors, with 4 per relationship type.</p>
      </section>
      </details>
    </> : <p>Analyze this track to find its tempo, key, and instruments.</p>}
    <details className="music-track-actions"><summary>Track actions</summary>
    <MusicAnalysisMode compact />
    <button type="button" aria-label={analysis ? 'Reanalyze musical features' : 'Analyze musical features'} disabled={phase !== 'ready' || !!controller} onClick={() => void run()}>{controller ? 'Analyzing…' : analysis ? 'Reanalyze' : 'Analyze track'}</button>
    {controller && <button type="button" onClick={() => controller.abort()}>Cancel analysis</button>}
    </details>
    {message && <p role="status">{message}</p>}
    {node.warning && <p role="status">{node.warning}</p>}
  </section>;
}
