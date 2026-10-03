import MusicAnalysisMode from './MusicAnalysisMode';
import { musicNameHints, type NamedHint } from '../audio/nameHints';
import { useState } from 'react';
import type { DocNode } from '../model/types';
import { KEY_NAMES, keyName, type InstrumentEstimate } from '../audio/musicTypes';
import { isBroadInstrument } from '../audio/instrumentLabels';
import { useGraphStore } from '../store/graphStore';
import SoundIdentification, { SoundExplanation, SoundModelComparisons } from './SoundIdentification';
import InstrumentCorrection from './InstrumentCorrection';
import RecognitionEvidence from './RecognitionEvidence';
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export default function MusicFeatures({ node, onSeek }: { node: DocNode; onSeek?: (seconds: number) => void }) {
  const phase = useGraphStore(s => s.phase);
  const [controller, setController] = useState<AbortController | null>(null);
  const [message, setMessage] = useState('');
  const analysis = node.audio;
  const hints = musicNameHints(node);
  // Use the filename's spelling when the model found the same musical key.
  // Keep genuinely different predictions visible instead of relabeling them.
  const sameNamedKey = !!analysis?.key && !!hints.key && analysis.key.tonic === hints.key.value.tonic && analysis.key.mode === hints.key.value.mode;
  const audioKeyLabel = analysis?.key ? sameNamedKey ? hints.key!.displayName : keyName(analysis.key) : 'undetermined';
  const audioPitchLabel = analysis?.detectedPitch
    ? hints.key?.value.tonic === analysis.detectedPitch.pitchClass ? hints.key.displayName.split(' ')[0] : KEY_NAMES[analysis.detectedPitch.pitchClass]
    : undefined;
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
      setMessage('Analysis finished. Results and any warnings are shown here.');
    } catch (error) { setMessage(abort.signal.aborted ? 'Analysis cancelled.' : error instanceof Error ? error.message : 'Analysis failed.'); }
    finally { setController(null); }
  };
  const list = (items: InstrumentEstimate[]) => <ul className="music-instruments">{items.map(i => <li key={i.label}>
    <span>{i.label}{isBroadInstrument(i.label) ? ' (family only)' : ''}</span>
    {i.segments?.[0] && <button type="button" disabled={!onSeek} onClick={() => onSeek?.(i.segments![0].start)} aria-label={`Listen for ${i.label} at ${time(i.segments[0].start)}`}>Listen at {time(i.segments[0].start)}</button>}
  </li>)}</ul>;
  const likely = analysis?.instruments.filter(i => i.status === 'likely') ?? [];
  const prediction = analysis?.instrumentPrediction;
  const possible = analysis?.instruments.filter(i => i.status === 'possible' && i.label !== prediction?.label) ?? [];
  return <section className="music-features" aria-label="Musical features">
    <h3>Track details</h3>
    {analysis?.stage === 'preview' && <p role="status">{phase === 'parsing' ? 'Quick estimate — verification is continuing in the background.' : 'Quick estimate only — verification is unfinished. Reanalyze to finish.'}</p>}
    {analysis?.instrumentScan && !analysis.instrumentScan.complete && analysis.stage !== 'preview' && <p role="status">Analysis incomplete. Reanalyze to finish.</p>}
    {analysis ? <>
      <dl className="music-feature-grid">
        <div><dt>Tempo</dt><dd>{hints.tempo ? `${hints.tempo.value.toFixed(1)} BPM` : analysis.tempo ? `${analysis.tempo.bpm.toFixed(1)} BPM` : analysis.stage === 'preview' ? 'Not checked yet' : 'Uncertain / no steady beat'}</dd></div>
        <div><dt>Key</dt><dd>{hints.key ? hints.key.displayName : analysis.key ? keyName(analysis.key) : analysis.stage === 'preview' ? 'Not checked yet' : 'Uncertain / no stable key'}</dd></div>
      </dl>
      {analysis.recognition && <RecognitionEvidence recognition={analysis.recognition} duration={analysis.durationSeconds} onSeek={onSeek} reviews={analysis.soundReviews} confirmedInstruments={analysis.confirmedInstruments} onReview={phase==='ready'?(label,dimension,decision)=>{
        void import('../pipeline/coordinatorLazy').then(({setAudioReview})=>setAudioReview(node.id,label,dimension,decision))
          .then(()=>setMessage('Review saved.')).catch(error=>setMessage(error instanceof Error?error.message:'Could not save review.'));
      }:undefined} />}
      {analysis.soundProfile && (!analysis.recognition || analysis.confirmedInstruments !== undefined || hints.instruments) && <SoundIdentification summaryOnly preliminary={analysis.stage === 'preview'} profile={analysis.soundProfile} sourceOverride={analysis.confirmedInstruments !== undefined ? { label: analysis.confirmedInstruments.join(', ') || 'No confirmed instruments', origin: 'confirmed by you' } : hints.instruments ? { label: hints.instruments.value.join(', '), origin: hints.instruments.source, allowVoice: true } : undefined} />}
      {!analysis.soundProfile && <div className="music-source-summary">
        <span>Instrument</span>
        <strong>{analysis.confirmedInstruments?.join(', ') || (analysis.confirmedInstruments !== undefined ? 'None confirmed' : hints.instruments?.value.join(', ') || prediction?.label || likely.map(i => i.label).join(', ') || 'Not identified yet')}</strong>
      </div>}
      <details className="music-analysis-details">
        <summary>Explanations</summary>
        {analysis.soundProfile && <SoundExplanation preliminary={analysis.stage === 'preview'} profile={analysis.soundProfile} sourceOverride={analysis.confirmedInstruments !== undefined ? { label: analysis.confirmedInstruments.join(', ') || 'No confirmed instruments', origin: 'confirmed by you' } : hints.instruments ? { label: hints.instruments.value.join(', '), origin: hints.instruments.source, allowVoice: true } : undefined} />}
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
      {!hints.tempo && !!analysis.tempo?.alternatives?.length && <p>Short-clip tempo: {analysis.tempo.alternatives.map(bpm => `${bpm.toFixed(1)} BPM`).join(' or ')} may also fit at half or double time. The main estimate is used for tempo links.</p>}
      {hints.instruments && analysis.confirmedInstruments === undefined && <>
        <h4>Instruments from name</h4>
        <p>{hints.instruments.value.join(', ')}</p>
        <p>Used for instrument connections. Sound-based estimates remain below for comparison.</p>
      </>}
      {analysis.confirmedInstruments !== undefined ? <>
        <h4>Confirmed instruments</h4>
        <ul>{analysis.confirmedInstruments.map(label => <li key={label}>{label}</li>)}</ul>
        <p>Confirmed by you. These instruments are used for connections.</p>
      </> : analysis.recognition ? <p>Machine suggestions and their coverage are shown above. Your saved reviews remain separate from model estimates.</p> : analysis.version === 1 ? <p>Earlier instrument estimates used short excerpts. Reanalyze to scan the full track.</p> : <>
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
      <p>Tempo and key use {Math.round(analysis.analyzedSeconds)} seconds of excerpts. Instrument estimates can miss sounds or confuse similar timbres; an unlisted instrument may still be present.</p>
      {analysis.notes.filter(note => !analysis.confirmedInstruments || !note.startsWith('No instruments identified')).map(note => <p key={note}>{note}</p>)}
      <p>Connections use shared title phrases, matching tempo, key, or instruments. Name labels and your corrections take priority over estimates.</p>
      </details>
      {analysis.soundProfile && <SoundModelComparisons profile={analysis.soundProfile} />}
    </> : <p>Analyze this track to find its tempo, key, and instruments.</p>}
    <details className="music-track-actions"><summary>Track actions</summary>
    {analysis && (analysis.soundReviews?.length ? <p>Manage your label decisions in Sound evidence above. Individual source reviews take precedence over earlier instrument confirmations.</p> : <InstrumentCorrection key={node.id} node={node} />)}
    <MusicAnalysisMode compact />
    <button type="button" aria-label={analysis ? 'Reanalyze musical features' : 'Analyze musical features'} disabled={phase !== 'ready' || !!controller} onClick={() => void run()}>{controller ? 'Analyzing…' : analysis ? 'Reanalyze' : 'Analyze track'}</button>
    {controller && <button type="button" onClick={() => controller.abort()}>Cancel analysis</button>}
    </details>
    {message && <p role="status">{message}</p>}
    {node.warning && <p role="status">{node.warning}</p>}
  </section>;
}
