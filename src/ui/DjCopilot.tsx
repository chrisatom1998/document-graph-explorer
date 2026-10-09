import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocNode } from '../model/types';
import { copilotEvidence, evidenceSummary, MAX_COPILOT_SAMPLES } from '../audio/copilotEvidence';
import { copilotWave, TRANSCRIPTION_RATE, TRANSCRIPTION_SECONDS } from '../audio/copilotWave';
import { getOriginal } from '../persistence/originals';
import DjTagCorrection from './DjTagCorrection';
import SampleClipPlayer from './SampleClipPlayer';
import CopilotProperties from './CopilotProperties';
import { parseCopilotSuggestions, type CopilotSuggestion } from '../audio/copilotProperties';
import { applyCopilotProperties, copilotCorpusIdentity } from '../audio/applyCopilotProperties';
import type { CopilotSample } from '../audio/copilotEvidence';
import { LISTENING_MODEL, LISTENING_SECONDS, prepareListeningClips, type ListeningCoverage } from '../audio/copilotListening';

interface Review { answer: string; fingerprint: string; mapping: string[]; model: string; warning?: string; suggestions: CopilotSuggestion[]; ids: string[]; evidence: CopilotSample[]; corpus: string; listening?: ListeningCoverage[] }
interface Transcript { text: string; seconds: number }
export default function DjCopilot({ audio, ready, localApi, onAddToCrate, crate, onOpen, active = true, launch }: {
  launch?: { request: number; selectedIds: string[]; question: string };
  audio: DocNode[]; ready: boolean; localApi: boolean; onAddToCrate: (id: string) => void; crate: string[]; onOpen: (id: string) => void; active?: boolean;
}) {
  const [reviewMode, setReviewMode] = useState<'audio' | 'fast' | 'deep'>('audio');
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [playing, setPlaying] = useState('');
  const [question, setQuestion] = useState('Review these samples. Explain uncertain labels and suggest useful groupings.');
  useEffect(() => {
    if (!launch?.request) return;
    setSelected(launch.selectedIds);
    if (launch.question) setQuestion(launch.question);
  }, [launch?.request, launch?.selectedIds, launch?.question]);
  const [report, setReport] = useState<Review | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, Transcript>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Choose up to five sounds to inspect their evidence.');
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  const picked = useMemo(() => selected.flatMap(id => {
    const node = audio.find(n => n.id === id);
    return node?.audio ? [node] : [];
  }), [selected, audio]);
  const evidence = useMemo(() => picked.flatMap((n, i) => { const sample = copilotEvidence(n, i); return sample ? [sample] : []; }), [picked]);
  const fingerprint = JSON.stringify({ ids: picked.map(n => n.id), evidence, question, reviewMode });
  const visible = audio.filter(n => n.title.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (id: string) => setSelected(previous => {
    const present = previous.filter(v => audio.some(n => n.id === v && n.audio));
    return present.includes(id) ? present.filter(v => v !== id) : present.length < MAX_COPILOT_SAMPLES ? [...present, id] : present;
  });
  const start = (message: string) => {
    const controller = new AbortController(); request.current = controller;
    setBusy(message); setStatus(message); setError('');
    return controller;
  };
  const finish = (controller: AbortController) => { if (request.current === controller) { request.current = null; setBusy(''); } };
  const result = async (response: Response) => {
    if (!response.headers.get('content-type')?.includes('application/json')) throw Error('The local copilot is unavailable. Restart npm run dev.');
    const data = await response.json();
    if (!response.ok) throw Error(typeof data.error === 'string' ? data.error : 'The copilot request failed.');
    return data;
  };
  const review = async () => {
    if (busy || applying || !ready || !localApi || !evidence.length || !question.trim()) return;
    const corpus = copilotCorpusIdentity();
    const controller = start(reviewMode === 'audio' ? 'Preparing short audio excerpts for GPT-Audio-1.5…' : 'Reviewing the selected evidence… This can take up to 3 minutes.');
    try {
      const clips = reviewMode === 'audio' ? await prepareListeningClips(picked, controller.signal) : undefined;
      controller.signal.throwIfAborted();
      if (clips) setStatus('GPT-Audio-1.5 is listening to the uploaded excerpts…');
      const data = await result(await fetch(reviewMode === 'audio' ? '/api/dj-copilot/review-audio' : reviewMode === 'fast' ? '/api/dj-copilot/review-fast' : '/api/dj-copilot/review', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DJ-Assistant': '1' },
        body: JSON.stringify({ samples: evidence, question, ...(clips ? { clips } : {}) }), signal: controller.signal }));
      if (typeof data.answer !== 'string' || !data.answer.trim()) throw Error('No completed review was returned.');
      if (clips && (data.model !== LISTENING_MODEL || !Array.isArray(data.listening) || data.listening.length !== clips.length ||
        data.listening.some((clip: ListeningCoverage, i: number) => !clip || clip.ref !== evidence[i].ref || clip.startSeconds !== 0 || !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0 || clip.durationSeconds > LISTENING_SECONDS))) throw Error('Invalid listening coverage returned.');
      if (controller.signal.aborted) return;
      setReport({ answer: data.answer, model: data.model, warning: data.warning, fingerprint, mapping: picked.map((n, i) => `Sample ${i + 1}: ${n.title}`), suggestions: parseCopilotSuggestions(data.suggestions ?? [], evidence), ids: picked.map(n => n.id), evidence, corpus, ...(clips ? { listening: data.listening } : {}) });
      setApplied(false);
      setStatus('Review complete. Your labels have not been changed.');
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Review failed.'); }
    finally { finish(controller); }
  };
  const apply = async () => {
    if (!report || applied || applying || busy || !ready || report.fingerprint !== fingerprint) return;
    setApplying(true); setError('');
    try { setStatus(await applyCopilotProperties(report)); setApplied(true); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not add suggested properties.'); }
    finally { setApplying(false); }
  };
  const transcribe = async (node: DocNode) => {
    if (busy || !ready || !localApi) return;
    const controller = start(`Preparing the first 30 seconds of ${node.title} for transcription…`);
    try {
      const original = await getOriginal(node.id);
      if (!original) throw Error('Add the original audio file again before transcribing it.');
      const { openMusicDecoder } = await import('../audio/decodeMusic');
      const decoder = await openMusicDecoder(original.blob, original.name, controller.signal);
      let wav: ArrayBuffer;
      try { wav = copilotWave(await decoder.read(0, TRANSCRIPTION_SECONDS, TRANSCRIPTION_RATE)); }
      finally { decoder.close(); }
      controller.signal.throwIfAborted();
      setStatus(`Transcribing ${node.title}…`);
      const data = await result(await fetch('/api/dj-copilot/transcribe', { method: 'POST',
        headers: { 'Content-Type': 'audio/wav', 'X-DJ-Assistant': '1' }, body: wav, signal: controller.signal }));
      if (typeof data.text !== 'string' || typeof data.seconds !== 'number') throw Error('Invalid transcript returned.');
      if (controller.signal.aborted) return;
      setTranscripts(previous => ({ ...previous, [node.id]: { text: data.text, seconds: data.seconds } }));
      setStatus('Transcript ready to compare with the audio. It has not changed any tags.');
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Transcription failed.'); }
    finally { finish(controller); }
  };
  const exportReport = () => {
    if (!report) return;
    const text = ['DJ Sample Copilot', report.fingerprint !== fingerprint ? 'Historical review: current selection or evidence has changed.' : '',
      ...report.mapping, `Model: ${report.model}`, ...(report.listening?.map(clip => `${clip.ref}: listened to first ${clip.durationSeconds.toFixed(1)} seconds only; unverified suggestions.`) ?? ['Metadata review; no audio supplied.']), '', report.answer, report.warning ?? '', '', ...picked.flatMap(n => transcripts[n.id] ? [`Transcript (unverified), ${n.title}, first ${transcripts[n.id].seconds.toFixed(1)} seconds:`, transcripts[n.id].text] : [])].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = 'dj-copilot-review.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  return <div className="dj-workspace dj-copilot">
    <section className="dj-controls" aria-label="Copilot selection">
      <h2>DJ Sample Copilot</h2><p className="dj-note">Compare the evidence, resolve uncertain labels, and build your crate.</p>
      <label htmlFor="copilot-filter">Find an imported sound</label><input id="copilot-filter" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by filename…" />
      <p>{picked.length} / {MAX_COPILOT_SAMPLES} selected</p>
      <div className="dj-copilot-picker">{visible.map(node => <label key={node.id}><input type="checkbox" checked={selected.includes(node.id)} disabled={!!busy || !ready || !node.audio || (!selected.includes(node.id) && picked.length >= MAX_COPILOT_SAMPLES)} onChange={() => toggle(node.id)} /><span>{node.title}{!node.audio ? ' · awaiting analysis' : ''}</span></label>)}</div>
      {!audio.length && <p>Add audio with the app’s Add files or Add a folder control, then return here.</p>}
      {!!audio.length && !visible.length && <p>No filenames match this filter.</p>}
      <form onSubmit={e => { e.preventDefault(); void review(); }}>
        <label>Review model<select value={reviewMode} disabled={!!busy || applying} onChange={e => setReviewMode(e.target.value === 'deep' ? 'deep' : e.target.value === 'fast' ? 'fast' : 'audio')}><option value="audio">GPT-Audio-1.5 — listen to excerpts</option><option value="fast">Astra Ultrafast — quick explanation</option><option value="deep">Sol agent — deeper review</option></select></label>
        <label htmlFor="copilot-question">What should the copilot review?</label><textarea id="copilot-question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={1200} disabled={!!busy} rows={4} />
        <button className="dj-primary" disabled={!!busy || applying || !ready || !localApi || !evidence.length || !question.trim()}>Review selected sounds</button>
      </form>
      <p className="dj-note">{reviewMode === 'audio' ? 'Review selected sounds uploads the first 10 seconds of each selected sound, your question, and confirmed labels to OpenAI for GPT-Audio-1.5 listening. Filenames and paths are not sent. Suggestions are unverified and describe only these excerpts; measured tempo/key and your confirmed labels stay unchanged.' : 'Review sends selected measurements, labels, filename-derived musical hints, and your question to OpenAI. Filenames, paths, and audio are not sent. Fast review uses Astra Ultrafast. Deeper review uses a temporary Sol agent session, removed after the review.'}</p>
      <p className="dj-note">Transcribe vocal uploads only the first 30 seconds of that sound. Chopped vocals or music may produce inaccurate words; compare with playback. Transcripts stay in this panel until you close it or export a report.</p>
      {!localApi && <p role="status">Online review and transcription require the local app started with <code>npm run dev</code>. Evidence and tag corrections work here.</p>}
      {!ready && <p role="status">Wait for audio analysis to finish before reviewing or correcting tags.</p>}
    </section>
    <section className="dj-results" aria-label="Copilot evidence" aria-busy={!!busy}>
      <div className="dj-results-heading"><h2>Evidence before advice</h2>{busy && <button onClick={() => { request.current?.abort(); setStatus('Request stopped. The server will cancel and clean up the agent session.'); setBusy(''); }}>Stop copilot</button>}</div>
      <p role="status">{status}</p>{error && <p role="alert" className="dj-error">{error}</p>}
      {!picked.length && <div className="dj-empty"><h3>Start with a few sounds.</h3><p>Select one to five imported samples. Their local evidence appears here immediately.</p></div>}
      {picked.map((node, index) => {
        const sample = evidence[index];
        return <article className="dj-card" key={node.id}>
          <div className="dj-card-heading"><h3>Sample {index + 1} · {node.title}</h3></div>
          {sample && <ul>{evidenceSummary(sample).map(line => <li key={line}>{line}</li>)}</ul>}
          {!!sample?.estimates.length && <details><summary>Automatic estimates · not confirmed</summary><p className="dj-note">{sample.estimates.map(t => `${t.label} (${t.score.toFixed(2)})`).join(', ')}. Scores are not probabilities. Your corrections take priority.</p></details>}
          <div className="dj-actions"><button aria-pressed={playing === node.id} onClick={() => setPlaying(playing === node.id ? '' : node.id)}>{playing === node.id ? 'Close player' : '▶ Audition'}</button><button onClick={() => onOpen(node.id)}>Open in graph</button><button disabled={crate.includes(node.id)} onClick={() => onAddToCrate(node.id)}>{crate.includes(node.id) ? '✓ In crate' : '+ Add to crate'}</button><button disabled={!!busy || !ready || !localApi} onClick={() => void transcribe(node)}>Transcribe vocal</button></div>
          {active && playing === node.id && <SampleClipPlayer key={node.id} node={node} />}
          {transcripts[node.id] && <div className="dj-transcript"><strong>Unverified transcript · first {transcripts[node.id].seconds.toFixed(1)}s</strong><p>{transcripts[node.id].text || 'No words returned.'}</p></div>}
          <DjTagCorrection node={node} />
          {node.audio && <CopilotProperties audio={node.audio} />}
        </article>;
      })}
      {report && <section className="dj-copilot-report" aria-label="Copilot review">
        <div className="dj-results-heading"><h2>Copilot’s review</h2><button onClick={exportReport}>Export review</button></div>
        {report.fingerprint !== fingerprint && <p role="status" className="dj-error">Selection, question, or evidence changed. This review is historical; run it again for current advice.</p>}
        <p className="dj-note">{report.mapping.join(' · ')}</p><p className="dj-review-text">{report.answer}</p>
        <div className="dj-suggested-properties">
          <h3>Suggested properties</h3>
          {report.suggestions.length ? <ul>{report.suggestions.map(s => <li key={s.ref}>{report.mapping[report.evidence.findIndex(e => e.ref === s.ref)]}: {Object.values(s.tags).flat().join(', ')}</li>)}</ul> : <p>No new properties to add. The evidence may be insufficient, or the labels are already confirmed.</p>}
          <button className="dj-primary" disabled={applied || applying || !!busy || !ready || report.fingerprint !== fingerprint || !report.suggestions.length} onClick={() => void apply()}>{applied ? '✓ Properties added' : applying ? 'Adding properties…' : 'Apply suggested properties'}</button>
          <p className="dj-note">Adds the listed tags to these sounds as AI suggestions. Keeps your confirmed labels and measured tempo/key unchanged.</p>
        </div>
        <p className="dj-note">Generated by {report.model}. {report.listening ? `Listening assessment of uploaded excerpts only: ${report.listening.map(clip => `${clip.ref}, first ${clip.durationSeconds.toFixed(1)}s`).join('; ')}. Suggestions are unverified.` : 'Advice based on metadata, not a listening assessment.'}</p>
        {report.warning && <p role="alert" className="dj-error">{report.warning}</p>}
      </section>}
    </section>
  </div>;
}
