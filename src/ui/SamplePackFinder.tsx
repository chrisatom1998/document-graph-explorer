import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { findSamplePacks, publicSourceUrl, SAMPLE_PACKS } from '../audio/samplePacks';
import { AIRGAP } from '../airgap';
import { useReviewerImport } from './useReviewerImport';

const SourceMatchingPanel = lazy(() => import('./SourceMatchingPanel'));

export default function SamplePackFinder() {
  const [sourceMatchingLoaded, setSourceMatchingLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [generative, setGenerative] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<{ title: string; url: string }[]>([]);
  const [selected, setSelected] = useState<string[]>(() => {
    try { const v: unknown = JSON.parse(localStorage.getItem('dge:training-pack-sources') ?? '[]'); return Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string' && SAMPLE_PACKS.some(p => p.id === id)) : []; } catch { return []; }
  });
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const packs = findSamplePacks(query);
  const localApi = import.meta.env.DEV && !AIRGAP && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const importer = useReviewerImport(localApi);
  const [packName, setPackName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [licenseUrl, setLicenseUrl] = useState('');
  const [archive, setArchive] = useState<File | null>(null);
  const importSection = useRef<HTMLElement>(null);
  const chooseSource = (name: string, url: string, license = '') => {
    setPackName(name); setSourceUrl(url); setLicenseUrl(license);
    importSection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  const searchWeb = async () => {
    if (busy || !query.trim()) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setAnswer(''); setSources([]);
    try {
      const response = await fetch('/api/dj-assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DJ-Assistant': '1' },
        body: JSON.stringify({ mode: 'packs', query, hasReference: false, generative }), signal: controller.signal });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Start the local app with npm run dev to use web search.');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Web search failed.');
      if (controller.signal.aborted) return;
      setAnswer(String(data.answer ?? ''));
      setSources((Array.isArray(data.sources) ? data.sources : []).flatMap((s: { title?: string; url?: string }) => {
        const url = publicSourceUrl(s.url); return url ? [{ title: String(s.title || url), url }] : [];
      }));
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Web search failed.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const exportSources = () => {
    const data = { version: 1, purpose: generative ? 'generative training' : 'sound classification', exportedAt: new Date().toISOString(),
      packs: SAMPLE_PACKS.filter(p => selected.includes(p.id)).map(p => ({ ...p, license: 'CC0-1.0', status: 'source selected; files not yet downloaded or reviewed' })),
      reminder: 'Retain the license and publisher information with downloaded files. Review actual audio labels; publisher descriptions are not verified training labels.' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'training-pack-sources.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  return <section className="dj-pack-finder" aria-label="Find free sample packs">
    <h2>Find free sample packs</h2>
    <p>Build a training collection from publisher-listed CC0 sources. Free to download does not by itself establish training rights.</p>
    <details className="dj-card" onToggle={event => { if (event.currentTarget.open) setSourceMatchingLoaded(true); else event.currentTarget.querySelectorAll('audio').forEach(audio => audio.pause()); }}>
      <summary>Match a reference sound locally</summary>
      {sourceMatchingLoaded && <Suspense fallback={<p role="status">Opening local source comparison…</p>}><SourceMatchingPanel /></Suspense>}
    </details>
    <form onSubmit={e => { e.preventDefault(); if (localApi) void searchWeb(); }} className="dj-pack-search">
      <label>Sound or instrument<input value={query} maxLength={1000} onChange={e => setQuery(e.target.value)} placeholder="Drums, synth, percussion, vocals…" /></label>
      <label>Training purpose<select value={generative ? 'generative' : 'classification'} onChange={e => setGenerative(e.target.value === 'generative')}><option value="classification">Sound classification / recognition</option><option value="generative">Generative audio model</option></select></label>
      <button className="dj-primary" disabled={!query.trim() || busy || !localApi}>{busy ? 'Searching publisher sources…' : 'Search web with AI'}</button>
      {busy && <button type="button" onClick={() => { request.current?.abort(); setBusy(false); }}>Stop</button>}
    </form>
    <p className="dj-note">Typing filters the starting sources below for free. AI web search sends your query and training purpose to OpenAI and uses API credits.</p>
    {error && <p className="dj-error" role="alert">{error}</p>}
    {answer && <section className="dj-web-results"><h3>Web findings · review before downloading</h3><p style={{ whiteSpace: 'pre-wrap' }}>{answer}</p><h4>Sources</h4><ul>{sources.map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>{localApi && <button onClick={() => chooseSource(s.title.slice(0, 200), s.url)}>Import a pack from this source</button>}</li>)}</ul></section>}
    {localApi && <section ref={importSection} className="dj-card" aria-label="Import packs to reviewer">
      <h3>Import into your sound reviewer</h3>
      <p>Use a supported pack’s download button below, or download an archive from a publisher and select it here. New sounds stay unreviewed until you listen and confirm their labels.</p>
      <form className="dj-pack-search" onSubmit={e => { e.preventDefault(); if (archive) void importer.upload(archive, { name: packName, sourceUrl, licenseUrl }); }}>
        <label>Pack name<input required maxLength={200} value={packName} onChange={e => setPackName(e.target.value)} /></label>
        <label>Publisher page<input type="url" required pattern="https://.*" maxLength={2000} value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} /></label>
        <label>License evidence page<input type="url" required pattern="https://.*" maxLength={2000} value={licenseUrl} onChange={e => setLicenseUrl(e.target.value)} /></label>
        <label>Pack archive<input type="file" accept=".zip,.7z,.tar,.gz,.bz2,.xz,.tgz" onChange={e => setArchive(e.target.files?.[0] ?? null)} /></label>
        <button className="dj-primary" disabled={!archive || importer.busy}>Import archive to reviewer</button>
      </form>
      <p className="dj-note">Up to 100 MB and 300 audio files per pack. ZIP, 7z and tar archives are supported by the local archive reader. Original archives and source links are retained. Imports use local audio analysis, not OpenAI credits.</p>
      {importer.status && <p role="status">{importer.status}</p>}
      {importer.error && <p role="alert" className="dj-error">{importer.error}</p>}
      {importer.result && <div role="status"><p><strong>{importer.result.added} sounds added</strong> · {importer.result.skipped} duplicates skipped · {importer.result.failed.length} could not be imported.</p>{importer.result.failed.length > 0 && <details><summary>Files that need attention</summary><ul>{importer.result.failed.map((f, i) => <li key={i}>{f.name}: {f.reason}</li>)}</ul></details>}</div>}
      <a href="http://127.0.0.1:8766/" target="_blank" rel="noopener noreferrer">Open sound reviewer ↗</a>
    </section>}
    <div className="dj-results-heading"><h3>Starting sources · checked October 2, 2026</h3><button disabled={!selected.length} onClick={exportSources}>Export source list ({selected.length})</button></div>
    <p className="dj-note">CC0 permits broad reuse under copyright. For identifiable voices, also review consent/privacy and any publisher AI preferences. Keep license evidence with each download. <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer">Read CC0</a></p>
    {!packs.length && <p>No starting sources match this filter. Try a broader term, AI web search, or Freesound below.</p>}
    <div className="dj-pack-grid">{packs.map(pack => <article className="dj-card" key={pack.id}>
      <div className="dj-card-heading"><h3>{pack.name}</h3><span>CC0</span></div><p>{pack.publisher} · {pack.access}</p><p>{pack.description}</p>
      <div className="dj-actions"><a href={pack.url} target="_blank" rel="noopener noreferrer">Open download page ↗</a><a href={pack.licenseUrl} target="_blank" rel="noopener noreferrer">License evidence ↗</a><button aria-pressed={selected.includes(pack.id)} onClick={() => {
        const next = selected.includes(pack.id) ? selected.filter(id => id !== pack.id) : [...selected, pack.id]; setSelected(next);
        try { localStorage.setItem('dge:training-pack-sources', JSON.stringify(next)); } catch { setError('Could not save the source list locally. Export it before closing.'); }
      }}>{selected.includes(pack.id) ? '✓ Saved source' : 'Save source'}</button>{localApi && (['freepats-synth', 'freepats-world'].includes(pack.id)
        ? <button disabled={importer.busy} onClick={() => { importSection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); void importer.download(pack.id); }}>Download to reviewer</button>
        : <button onClick={() => chooseSource(pack.name, pack.url, pack.licenseUrl)}>Import downloaded archive</button>)}</div>
    </article>)}</div>
    <aside className="dj-crate"><h3>Need vocals, synth textures, or more variety?</h3><p>Search Freesound with a CC0 filter. Check every file’s license; a pack can mix licenses. For generative training, also check each uploader’s AI preferences. Use their Data Packs portal for bulk training downloads.</p>
      {!AIRGAP && <a href={`https://freesound.org/search/?q=${encodeURIComponent(query || 'vocal chops')}&f=${encodeURIComponent('license:"Creative Commons 0"')}`} target="_blank" rel="noopener noreferrer">Search Freesound CC0 ↗</a>}{' · '}<a href="https://freesound.org/help/faq/" target="_blank" rel="noopener noreferrer">Training and download guidance ↗</a>
    </aside>
    <p className="dj-note">In the reviewer, listen and confirm the new sounds. Saving a source alone does not download files. Importing a pack does not confirm labels or train a model.</p>
  </section>;
}
