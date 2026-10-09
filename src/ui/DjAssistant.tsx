import CrateBuilder from './CrateBuilder';
import VoiceQuery from './VoiceQuery';
import UploadInsights from './UploadInsights';
import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useCorpusStore } from '../store/corpusStore';
import { useUiStore } from '../store/uiStore';
import { EMPTY_SAMPLE_QUERY, parseSampleQuery, searchSamples, type SampleQuery } from '../audio/sampleSearch';
import { toGraphExport } from '../persistence/graphExport';
import DjTagCorrection from './DjTagCorrection';
import SamplePackFinder from './SamplePackFinder';
import DjCopilot from './DjCopilot';
import ClipPlayer from './SampleClipPlayer';
import type { DocNode } from '../model/types';
import './DjAssistant.css';
import { useDialogDrag } from './useDialogDrag';
import { useSampleAssistantStore, type SampleAssistantTab } from '../store/sampleAssistantStore';
import SampleAssistantLauncher from './SampleAssistantLauncher';

export default function DjAssistant({ showLauncher = true }: { showLauncher?: boolean }) {
  const launch = useSampleAssistantStore();
  const nodes = useGraphStore(s => s.nodes);
  const phase = useGraphStore(s => s.phase);
  const corpusId = useCorpusStore(s => s.activeCorpusId);
  const corpusName = useCorpusStore(s => s.activeName);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const minimized = useRef(false);
  const { headerProps, reset } = useDialogDrag(dialog, open);
  const audio = useMemo(() => nodes.filter(n => n.kind === 'document' && n.fileType === 'audio'), [nodes]);
  useEffect(() => {
    if (!launch.request) return;
    reset(); minimized.current = false; setOpen(true); dialog.current?.showModal();
  }, [launch.request, reset]);
  return <>
    {showLauncher && <SampleAssistantLauncher count={audio.length} onOpen={() => { if (!minimized.current) reset(); minimized.current = false; setOpen(true); dialog.current?.showModal(); }} />}
    <dialog ref={dialog} className="dj-dialog" aria-labelledby="dj-title" onCancel={() => setOpen(false)} onClose={() => { if (!minimized.current && !dialog.current?.open) setOpen(false); }} onKeyDown={e => e.stopPropagation()}>
      {open && <SampleWorkspace launch={launch} headerProps={headerProps} key={corpusId ?? corpusName} onMinimize={() => { minimized.current = true; dialog.current?.close(); }} audio={audio} ready={phase === 'ready'} storageKey={corpusId ? `dge:dj-crate:${corpusId}` : null} onClose={() => { minimized.current = false; dialog.current?.close(); setOpen(false); }} />}
    </dialog>
  </>;
}

function SampleWorkspace({ audio, ready, storageKey, onClose, onMinimize, headerProps, launch }: { launch: { request: number; tab: SampleAssistantTab; selectedIds: string[]; question: string }; audio: DocNode[]; ready: boolean; storageKey: string | null; onClose: () => void; onMinimize: () => void; headerProps: HTMLAttributes<HTMLElement> }) {
  const [tab, setTab] = useState<SampleAssistantTab>(launch.tab);
  useEffect(() => setTab(launch.tab), [launch.request, launch.tab]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [plan, setPlan] = useState<SampleQuery>(EMPTY_SAMPLE_QUERY);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [playing, setPlaying] = useState('');
  const [editing, setEditing] = useState('');
  const [showCrate, setShowCrate] = useState(false);
  const [limit, setLimit] = useState(20);
  const [crate, setCrate] = useState<string[]>(() => {
    try { const saved: unknown = storageKey ? JSON.parse(localStorage.getItem(storageKey) ?? '[]') : []; return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string').slice(0, 10000) : []; }
    catch { return []; }
  });
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const crateNodes = audio.filter(n => crate.includes(n.id));
  const matches = useMemo(() => searchSamples(audio, plan, reference), [audio, plan, reference]);
  const rows = showCrate ? crateNodes.map(node => ({ node, reasons: ['In your crate'], score: 0 })) : matches;
  const filtered = JSON.stringify(plan) !== JSON.stringify(EMPTY_SAMPLE_QUERY);
  const localApi = import.meta.env.DEV && import.meta.env.MODE !== 'airgap' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

  const run = async (text: string) => {
    if (!text.trim() || busy || !localApi) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setQuery(text); setPlaying('');
    try {
      const response = await fetch('/api/dj-assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DJ-Assistant': '1' },
        body: JSON.stringify({ query: text, previous: plan, hasReference: audio.some(n => n.id === reference) }), signal: controller.signal });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The local assistant is unavailable. Restart npm run dev.');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Search failed. Try again.');
      const next = parseSampleQuery(data.plan);
      if (controller.signal.aborted) return;
      if (next.similar && !audio.some(n => n.id === reference)) throw new Error('Choose a reference sound, then search again.');
      if (next.clarification) { setError(next.clarification); return; }
      setPlan(next); setShowCrate(false); setLimit(20); setStatus(`Search: ${text}`);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Search failed.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const toggleCrate = (id: string) => {
    const next = crate.includes(id) ? crate.filter(v => v !== id) : [...crate, id];
    setCrate(next);
    if (!storageKey) { setStatus('Crate kept for this session. Export it before closing.'); return; }
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStatus('Crate saved on this device.'); }
    catch { setError('Crate could not be saved on this device. Export it before closing.'); }
  };
  const exportCrate = () => {
    const ids = new Set(crateNodes.map(n => n.id));
    const graph = toGraphExport(false);
    graph.nodes = graph.nodes.filter(n => ids.has(n.id));
    graph.edges = graph.edges.filter(e => ids.has(e.source) && ids.has(e.target));
    const url = URL.createObjectURL(new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'dj-sample-crate.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus('Crate exported with tags and relationships. Audio files are not included.');
  };

  return <>
    <header className="dj-header" {...headerProps}>
      <div><h1 id="dj-title">Find your next sound.</h1><p>{audio.length} sounds in your library</p></div>
      <div className="dj-window-actions">
        <button type="button" data-drag-handle aria-label="Move sample assistant" title="Drag to move. Arrow keys move; Home centers.">⠿</button>
        <button type="button" onClick={onMinimize} aria-label="Minimize sample assistant" title="Minimize; reopen from the Sample assistant button.">−</button>
        <button onClick={onClose} aria-label="Close sample assistant" title="Close">×</button>
      </div>
    </header>
    <nav className="dj-tabs" aria-label="Sample assistant views">
      <button aria-pressed={tab === 'library' && !showCrate} onClick={() => { setTab('library'); setShowCrate(false); setPlaying(''); setLimit(20); }}>My library</button>
      <button aria-label="View crate" aria-pressed={tab === 'library' && showCrate} onClick={() => { setTab('library'); setShowCrate(true); setPlaying(''); setLimit(20); }}>Your crate <span>{crateNodes.length}</span></button>
      <details className="dj-tools-menu" open={toolsOpen} onToggle={e => setToolsOpen(e.currentTarget.open)}>
        <summary>{tab === 'library' ? 'Tools' : tab === 'overview' ? 'Upload overview' : tab === 'copilot' ? 'Copilot review' : 'Find free packs'}</summary>
        <div>{([['overview', 'Upload overview'], ['copilot', 'Copilot review'], ['packs', 'Find free packs']] as const).map(([value, label]) => <button key={value} aria-pressed={tab === value} onClick={() => { setPlaying(''); setTab(value); setToolsOpen(false); }}>{label}</button>)}</div>
      </details>
    </nav>
    <div hidden={tab !== 'copilot'}><DjCopilot launch={launch} active={tab === 'copilot'} audio={audio} ready={ready} localApi={localApi} crate={crate} onAddToCrate={toggleCrate} onOpen={id => { onClose(); useUiStore.getState().setSelected(id); }} /></div>
    {tab === 'copilot' ? null : tab === 'overview' ? <UploadInsights audio={audio} localApi={localApi} onClose={onClose} /> : tab === 'packs' ? <SamplePackFinder /> :
    <div className="dj-workspace dj-library-workspace">
      <section className="dj-controls" aria-label="Search controls" hidden={showCrate}>
        {/* AI search needs the local dev API; without it the filters below are the search. */}
        {localApi && <form className="dj-search-form" onSubmit={e => { e.preventDefault(); void run(query); }}>
          <label htmlFor="dj-query">Describe the sound</label>
          <textarea id="dj-query" autoFocus value={query} maxLength={2000} rows={1} onChange={e => setQuery(e.target.value)} placeholder="Find vocal chops under 5 seconds…" />
          <div className="dj-actions"><button className="dj-primary" disabled={busy || !ready || !localApi || !query.trim()}>{busy ? 'Interpreting your search…' : 'Search sounds'}</button>{busy && <button type="button" onClick={() => { request.current?.abort(); setBusy(false); setStatus('Search stopped. Previous results are unchanged.'); }}>Stop</button>}</div>
        </form>}
        {localApi && <p className="dj-note">Search text is sent to OpenAI. Your sound files stay on this device.</p>}
        {!ready && <p role="status">Your sounds are still being analyzed.</p>}
        <details className="dj-local-filters" open={!localApi}><summary>Filters</summary>
          <form key={JSON.stringify(plan)} onSubmit={e => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const number = (name: string) => data.get(name) ? Number(data.get(name)) : null;
            try {
              const next = parseSampleQuery({ ...EMPTY_SAMPLE_QUERY,
                terms: String(data.get('terms') ?? '').split(',').map(s => s.trim()).filter(Boolean),
                minBpm: number('minBpm'), maxBpm: number('maxBpm'), maxSeconds: number('maxSeconds'),
                confirmedOnly: data.get('confirmedOnly') === 'on',
              });
              setPlan(next); setError(''); setShowCrate(false); setLimit(20); setStatus('Local filters applied. No API request was made.');
            } catch (error) { setError(error instanceof Error ? error.message : 'Invalid filters.'); }
          }}>
            <label>Labels or filename phrases<input name="terms" defaultValue={plan.terms.join(', ')} placeholder="vocal chops, airy" maxLength={1000} /></label>
            <p className="dj-note">Separate phrases with commas. Every phrase must match.</p>
            <div className="dj-range"><label>Min BPM<input name="minBpm" type="number" min="0" max="300" step="any" defaultValue={plan.minBpm ?? ''} /></label><label>Max BPM<input name="maxBpm" type="number" min="0" max="300" step="any" defaultValue={plan.maxBpm ?? ''} /></label></div>
            <label>Maximum seconds<input name="maxSeconds" type="number" min="0" max="86400" step="any" defaultValue={plan.maxSeconds ?? ''} /></label>
            <label><input name="confirmedOnly" type="checkbox" defaultChecked={plan.confirmedOnly} /> Confirmed labels only</label>
            <button disabled={busy || !ready}>Apply local filters</button>
          </form>
        </details>
        <details className="dj-search-options"><summary>Search options</summary>
        <VoiceQuery onTranscript={setQuery} disabled={busy} />
        <label htmlFor="dj-reference">Compare with a sound</label>
        <select id="dj-reference" disabled={busy} value={reference} onChange={e => { setReference(e.target.value); setLimit(20); }}><option value="">Choose a reference…</option>{audio.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}</select>
        <button disabled={!reference || busy || !ready} onClick={() => { setPlan({ ...EMPTY_SAMPLE_QUERY, similar: true }); setShowCrate(false); setLimit(20); setStatus('Similar by labels, measured tempo, and estimated key.'); }}>Find similar sounds</button>
        <p className="dj-note">Matches use sound labels, tempo, and key.</p>
        </details>
      </section>
      <section className="dj-controls dj-crate-controls" aria-label="Crate tools" hidden={!showCrate}>
        <CrateBuilder audio={audio} localApi={localApi} ready={ready} reference={reference} onAdd={ids => {
          const next = [...new Set([...crate, ...ids])]; setCrate(next);
          try { if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next)); setStatus(storageKey ? 'Proposed sounds added to your saved crate.' : 'Proposed sounds added. Export the crate to keep it.'); }
          catch { setError('Crate is available in this tab, but saving failed. Export it before closing.'); }
        }} />
        <div className="dj-crate"><button disabled={!crateNodes.length} onClick={exportCrate}>Export crate</button><p className="dj-note">Exports include labels and connections, not audio files.</p></div>
      </section>
      <section className="dj-results" aria-label="Sample results" aria-busy={busy}>
        <div className="dj-results-heading"><h2>{showCrate ? 'Your crate' : 'Sounds'} <span>{rows.length}</span></h2>{(showCrate || filtered) && <button disabled={busy} onClick={() => { setPlan(EMPTY_SAMPLE_QUERY); setQuery(''); setShowCrate(false); setLimit(20); setError(''); setStatus('Showing all imported sounds.'); }}>Show all</button>}</div>
        {status && <p role="status">{status}</p>}{error && <p className="dj-error" role="alert">{error}</p>}
        {!showCrate && <div className="dj-filters">{[...plan.terms.map(t => `Includes ${t}`), ...plan.exclude.map(t => `Excludes ${t}`), ...(plan.minBpm !== null || plan.maxBpm !== null ? [`${plan.minBpm ?? 0}–${plan.maxBpm ?? 300} BPM`] : []), ...(plan.maxSeconds !== null ? [`≤ ${plan.maxSeconds}s`] : []), ...(plan.key ? [plan.key] : []), ...(plan.confirmedOnly ? ['Confirmed labels only'] : []), ...(plan.similar ? ['Similar to reference'] : [])].map(t => <span key={t}>{t}</span>)}</div>}
        {!rows.length && <div className="dj-empty"><h3>{showCrate ? 'Your crate is empty.' : 'No matching sounds yet.'}</h3><p>{showCrate ? 'Add sounds from the results to build a selection.' : 'Try fewer filters, or correct a sound’s tags. Missing tempo or key measurements do not match those filters.'}</p></div>}
        {rows.slice(0, limit).map(({ node, reasons }) => <article className="dj-card" key={node.id}>
          <div className="dj-card-heading"><h3>{node.title}</h3><span>{node.audio ? `${node.audio.durationSeconds.toFixed(1)}s` : 'Not analyzed'}</span></div>
          {reasons.some(reason => !['Imported audio', 'In your crate'].includes(reason)) && <ul>{reasons.filter(reason => !['Imported audio', 'In your crate'].includes(reason)).slice(0, 2).map(reason => <li key={reason}>{reason}</li>)}</ul>}
          <div className="dj-actions"><button aria-pressed={playing === node.id} onClick={() => setPlaying(playing === node.id ? '' : node.id)}>{playing === node.id ? 'Close player' : '▶ Audition'}</button><button aria-pressed={crate.includes(node.id)} onClick={() => toggleCrate(node.id)}>{crate.includes(node.id) ? '✓ In crate' : '+ Add to crate'}</button><details className="dj-sound-actions"><summary aria-label={`More actions for ${node.title}`}>More</summary><div><button disabled={!node.audio || !ready} onClick={() => setEditing(editing === node.id ? '' : node.id)}>Correct tags</button><button onClick={() => { onClose(); useUiStore.getState().setSelected(node.id); }}>Open in graph</button></div></details></div>
          {playing === node.id && <ClipPlayer key={node.id} node={node} />}
          {editing === node.id && <DjTagCorrection key={node.id} node={node} />}
        </article>)}
        {rows.length > limit && <button onClick={() => setLimit(limit + 20)}>Show 20 more</button>}
      </section>
    </div>}
  </>;
}
