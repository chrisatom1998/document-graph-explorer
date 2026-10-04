import { useEffect, useMemo, useRef } from 'react';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useCorpusStore } from '../store/corpusStore';
import { useUiStore } from '../store/uiStore';
import { copilotEvidence } from '../audio/copilotEvidence';
import { uploadInsight } from '../audio/uploadInsights';
import { setAutomaticSummaries, useUploadInsightsStore } from '../store/uploadInsightsStore';
import { openSampleAssistant } from '../store/sampleAssistantStore';

/** One bounded request at a time. A failed request pauses automatic spending. */
export function UploadInsightsAgent() {
  const nodes = useGraphStore(s => s.nodes);
  const phase = useGraphStore(s => s.phase);
  const corpus = useCorpusStore(s => `${s.mode}:${s.activeCorpusId ?? ''}`);
  const enabled = useUploadInsightsStore(s => s.enabled);
  const revision = useUploadInsightsStore(s => s.revision);
  const busy = useUploadInsightsStore(s => s.busy);
  const attempted = useRef(new Set<string>());
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    attempted.current.clear(); request.current?.abort();
    useUploadInsightsStore.setState({ reports: [], busy: false, error: '' });
    return () => { request.current?.abort(); };
  }, [corpus]);
  useEffect(() => { if (!enabled) { request.current?.abort(); useUploadInsightsStore.setState({ busy: false }); } }, [enabled]);
  useEffect(() => {
    if (!enabled || busy || phase !== 'ready' || !import.meta.env.DEV || import.meta.env.MODE === 'airgap') return;
    const timer = setTimeout(() => {
      const candidates = nodes.filter(n => n.fileType === 'audio' && n.audio);
      const picked = candidates.filter(n => !attempted.current.has(`${n.id}:${JSON.stringify(copilotEvidence(n, 0))}`)).slice(0, 5);
      if (!picked.length) return;
      const evidence = picked.map((n, i) => copilotEvidence(n, i)!);
      picked.forEach(n => attempted.current.add(`${n.id}:${JSON.stringify(copilotEvidence(n, 0))}`));
      const controller = new AbortController(); request.current = controller;
      useUploadInsightsStore.setState({ busy: true, error: '' });
      void (async () => {
        try {
          const response = await fetch('/api/dj-copilot/review-fast', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DJ-Assistant': '1' },
            body: JSON.stringify({ samples: evidence, question: 'Give one short summary for each sample, then suggested groups based only on this evidence, and a ranked list of uncertainties to listen to first. Distinguish previews, confirmed labels, measurements, and filename hints. Do not suggest new tags.' }), signal: controller.signal });
          const data = await response.json();
          if (!response.ok) throw Error(data.error || 'Automatic summaries are unavailable.');
          if (typeof data.answer !== 'string' || !data.answer.trim()) throw Error('No upload summary was returned.');
          if (controller.signal.aborted) return;
          const live = useGraphStore.getState().nodes;
          if (picked.some((n, i) => JSON.stringify(copilotEvidence(live.find(x => x.id === n.id) ?? n, i)) !== JSON.stringify(evidence[i]) || !live.some(x => x.id === n.id))) return;
          useUploadInsightsStore.setState(s => ({ reports: [...s.reports.filter(r => !r.ids.some(id => picked.some(n => n.id === id))), { ids: picked.map(n => n.id), evidence, answer: data.answer, model: 'gpt-6-astra' }].slice(-40) }));
        } catch (error) {
          if (!controller.signal.aborted) { setAutomaticSummaries(false); useUploadInsightsStore.setState({ error: error instanceof Error ? error.message : 'Automatic summaries paused.' }); }
        } finally {
          if (request.current === controller) { request.current = null; useUploadInsightsStore.setState(s => ({ busy: false, revision: s.revision + 1 })); }
        }
      })();
    }, 1500);
    return () => clearTimeout(timer);
  }, [nodes, phase, corpus, enabled, busy, revision]);
  return null;
}

export default function UploadInsights({ audio, localApi, onClose }: { audio: DocNode[]; localApi: boolean; onClose: () => void }) {
  const state = useUploadInsightsStore();
  const rows = useMemo(() => audio.map(node => ({ node, ...uploadInsight(node) })).sort((a, b) => b.priority - a.priority), [audio]);
  const groups = new Map<string, string[]>();
  for (const row of rows) for (const group of row.groups) groups.set(group, [...(groups.get(group) ?? []), row.node.id]);
  const show = (ids: string[]) => { const ui = useUiStore.getState(); ui.setSelected(null); ui.setSearchResults(ids); ui.sendCamera('fitAll'); onClose(); };
  return <section className="dj-results" aria-label="Upload overview">
    <h2>Your upload at a glance</h2><p>Summaries update from the available analysis. Review uncertain sounds first; group suggestions use labels and tempo.</p>
    <label><input type="checkbox" checked={state.enabled} disabled={!localApi} onChange={e => setAutomaticSummaries(e.target.checked)} /> Add automatic Astra summaries</label>
    <p className="dj-note">Optional, billed to your OpenAI account. Sends measurements and labels for up to five sounds per request. No filenames or audio are sent. Updates as analysis changes; pauses on an API error.</p>
    {state.busy && <p role="status">Summarizing the next five sounds…</p>}{state.error && <p role="alert">{state.error} Local summaries remain available.</p>}
    <div className="dj-filters">{[...groups].filter(([,ids]) => ids.length > 1).map(([name, ids]) => <button key={name} onClick={() => show(ids)}>{name} · {ids.length}</button>)}</div>
    {state.reports.map((report, index) => {
      const current = report.ids.every((id, i) => { const n = audio.find(n => n.id === id); return n && JSON.stringify(copilotEvidence(n, i)) === JSON.stringify(report.evidence[i]); });
      return <article className="dj-card" key={index}><h3>Astra upload summary{current ? '' : ' · earlier analysis'}</h3><p className="dj-note">{report.ids.map((id, i) => `Sample ${i+1}: ${audio.find(n => n.id === id)?.title ?? 'Removed sound'}`).join(' · ')}</p><p className="dj-review-text">{report.answer}</p></article>;
    })}
    {rows.map(row => <article className="dj-card" key={row.node.id}><h3>{row.node.title}</h3><p>{row.summary}</p>{row.reasons.length > 0 && <ul>{row.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}<button onClick={() => openSampleAssistant('copilot', [row.node.id], 'Explain this sound’s uncertainties and suggest what to listen for first.')}>Review this sound</button></article>)}
    {!rows.length && <p>Add audio files to see summaries and suggested groups.</p>}
  </section>;
}
