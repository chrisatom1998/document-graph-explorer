import { useEffect, useRef, useState } from 'react';
import { compareLocalAudio, importLocalReferenceFiles, importUnlabelledAudio, loadProvidedReferences, type LocalReferenceLibrary } from '../audio/sourceMatching/localLibrary';
import type { MatchResult } from '../audio/sourceMatching/matching';
import type { ReferenceRecord } from '../audio/sourceMatching/referenceLibrary';
import './SourceMatchingPanel.css';

const decisions: Record<MatchResult['decision'], string> = { 'verified-origin': 'Verified reference origin', 'closest-reference-preset': 'Closest reference preset', resemblance: 'Sound resemblance', unknown: 'Unknown source' };
const describe = (record: ReferenceRecord, library: LocalReferenceLibrary) => record.identity ? `${record.identity.synth} · ${record.identity.bank} · ${record.identity.preset}` : library.files.get(record.id)?.name || record.id;

export default function SourceMatchingPanel() {
  const [library, setLibrary] = useState<LocalReferenceLibrary | null>(null);
  const [manifest, setManifest] = useState<File | null>(null);
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [query, setQuery] = useState<File | null>(null);
  const [clipStart, setClipStart] = useState(0);
  const [clipSeconds, setClipSeconds] = useState(4);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Load the provided recordings or choose your own reference audio.');
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    if (!query) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(query); setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [query]);
  const stop = () => { operation.current?.abort(); operation.current = null; setBusy(false); setStatus('Comparison stopped. Your reference library is retained.'); };
  const perform = async (action: (signal: AbortSignal, progress: (message: string) => void) => Promise<void>) => {
    operation.current?.abort(); const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError('');
    const progress = (message: string) => { if (operation.current === controller && !controller.signal.aborted) setStatus(message); };
    try { await action(controller.signal, progress); }
    catch (failure) { if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : 'Local source comparison failed.'); setStatus('No result was accepted.'); } }
    finally { if (operation.current === controller) { operation.current = null; setBusy(false); } }
  };
  const acceptLibrary = (next: LocalReferenceLibrary) => { setLibrary(next); setResult(null); setStatus(`${next.candidates.length} references ready. Choose a recording to compare.`); };
  const importReferences = () => perform(async (signal, progress) => {
    if (manifest) {
      if (manifest.size > 1024 * 1024) throw new Error('Choose a reference manifest up to 1 MB.');
      let raw: unknown;
      try { raw = JSON.parse(await manifest.text()); } catch { throw new Error('Reference manifest must contain valid JSON.'); }
      const next = await importLocalReferenceFiles(raw, referenceFiles, signal, progress);
      signal.throwIfAborted(); acceptLibrary(next);
    } else {
      const next = await importUnlabelledAudio(referenceFiles, signal, progress);
      signal.throwIfAborted(); acceptLibrary(next);
    }
  });
  const compare = () => perform(async (signal, progress) => {
    if (!query || !library) return;
    const next = await compareLocalAudio(query, library, { start: clipStart, seconds: clipSeconds }, signal, progress);
    signal.throwIfAborted(); setResult(next); setStatus('Local reference comparison complete.');
  });
  const chooseQuery = (file: File | null) => { setQuery(file); setResult(null); setError(''); };
  const matchedIds = result?.exact?.referenceIds ?? result?.ranked.map(match => match.referenceId) ?? [];
  return <section className="source-matching-panel" aria-label="Local reference source matching">
    <h3>Match a reference sound locally</h3>
    <p>Compare an exposed sound with known recordings. Your selected audio stays on this device.</p>
    <div className="source-matching-actions">
      <button type="button" disabled={busy} onClick={() => { void perform(async (signal, progress) => { const next = await loadProvidedReferences(signal, progress); signal.throwIfAborted(); acceptLibrary(next); }); }}>Load provided flute and marimba references</button>
      {busy && <button type="button" onClick={stop}>Stop source comparison</button>}
    </div>
    <p className="dj-note">Two documented University of Iowa acoustic recordings. No exact synth-preset library is included.</p>
    <details className="source-matching-import">
      <summary>Import your own references</summary>
      <form onSubmit={event => { event.preventDefault(); void importReferences(); }}>
        <label>Reference audio files<input type="file" accept="audio/*,.wav,.aif,.aiff,.flac,.mp3,.ogg,.m4a" multiple disabled={busy} onChange={event => setReferenceFiles(Array.from(event.target.files ?? []))} /></label>
        <label>Reference manifest JSON (optional)<input type="file" accept=".json,application/json" disabled={busy} onChange={event => setManifest(event.target.files?.[0] ?? null)} /></label>
        <p className="dj-note">Without a manifest, recordings remain unverified local references. A manifest can supply synth/version/bank/preset, render settings, effects, rights and hash-bound provenance; declarations alone do not verify identity. Up to 32 references, 100 MB total and 32 MB per file.</p>
        <button type="submit" disabled={busy || !referenceFiles.length}>Import local reference audio</button>
      </form>
    </details>
    {library && <details className="source-matching-library">
      <summary>{library.candidates.length} reference recordings · {library.name}</summary>
      <ul>{library.candidates.map(candidate => <li key={candidate.reference.record.id}>
        <strong>{describe(candidate.reference.record, library)}</strong>
        <span>{candidate.reference.trust === 'verified' ? 'Reviewed source provenance' : candidate.reference.trust === 'synthetic' ? 'Synthetic control' : 'Unverified source metadata'}</span>
        {candidate.reference.record.identity && <span>Declared version: {candidate.reference.record.identity.version}</span>}
        <button type="button" disabled={busy} onClick={() => { chooseQuery(library.files.get(candidate.reference.record.id) ?? null); setClipStart(0); setClipSeconds(4); }}>Use this recording as query</button>
      </li>)}</ul>
    </details>}
    <form className="source-matching-query" onSubmit={event => { event.preventDefault(); void compare(); }}>
      <label>Audio to compare<input type="file" accept="audio/*,.wav,.aif,.aiff,.flac,.mp3,.ogg,.m4a" disabled={busy} onChange={event => chooseQuery(event.target.files?.[0] ?? null)} /></label>
      {query && <p>Selected recording: <strong>{query.name}</strong></p>}
      <div className="source-matching-clip"><label>Clip starts at (seconds)<input type="number" min="0" step="0.1" value={clipStart} disabled={busy} onChange={event => { setClipStart(Number(event.target.value)); setResult(null); }} /></label><label>Clip length (seconds)<input type="number" min="0.25" max="20" step="0.25" value={clipSeconds} disabled={busy} onChange={event => { setClipSeconds(Number(event.target.value)); setResult(null); }} /></label></div>
      {previewUrl && <audio aria-label="Selected source query recording" controls preload="none" src={previewUrl} />}
      <button type="submit" className="dj-primary" disabled={busy || !query || !library}>{busy ? 'Comparing locally…' : 'Compare with references'}</button>
    </form>
    <p className="dj-note" role="status" aria-live="polite">{status}</p>
    {error && <p className="dj-error" role="alert">{error}</p>}
    {result && library && <section className="source-matching-result" aria-label="Source matching result">
      <h4>{decisions[result.decision]}</h4><p>{result.reason}</p>
      {result.exact && <p>Exact file duplicate · {result.exact.basis}. {result.decision === 'verified-origin' ? 'Verified provenance applies only to the documented recording.' : 'Byte identity alone does not verify source identity.'}</p>}
      {matchedIds.length > 0 && <ol>{matchedIds.slice(0, 5).map(id => {
        const candidate = library.candidates.find(item => item.reference.record.id === id); const match = result.ranked.find(item => item.referenceId === id);
        if (!candidate) return null;
        const record = candidate.reference.record;
        return <li key={id}><strong>{describe(record, library)}</strong><p>{candidate.reference.trust === 'verified' ? 'Source documentation reviewed for this recording.' : 'Source metadata is unverified.'}</p>
          {match && <p>Similarity {match.score.toFixed(3)} · pitch {match.alignment.pitchSemitones > 0 ? '+' : ''}{match.alignment.pitchSemitones} semitones · speed {match.alignment.referenceSecondsPerQuerySecond.toFixed(2)}× · offset {match.alignment.referenceOffsetSeconds.toFixed(2)} s</p>}
          {record.provenance.evidenceUri.startsWith('https://theremin.music.uiowa.edu/') && candidate.reference.trust === 'verified' && <a href={record.provenance.evidenceUri} target="_blank" rel="noopener noreferrer">Recording provenance</a>}
        </li>;
      })}</ol>}
      <p className="dj-note">Similarity is not an origin probability. Closest reference presets require verified preset recordings and a calibrated acceptance policy. Existing sound labels and your corrections are unchanged.</p>
    </section>}
    <p className="dj-note">Reference files and comparison results are kept for this tool session. No paid API, training, or external audio upload is used.</p>
  </section>;
}
