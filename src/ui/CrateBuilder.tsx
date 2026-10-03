import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocNode } from '../model/types';
import { buildCrate, parseCratePlan, type CratePlan } from '../audio/crateBuilder';

export default function CrateBuilder({ audio, localApi, ready, reference, onAdd }: {
  audio: DocNode[]; localApi: boolean; ready: boolean; reference: string; onAdd: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('Build a 140 BPM crate with vocal chops, bass, and percussion.');
  const [plan, setPlan] = useState<CratePlan | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const proposal = useMemo(() => plan ? buildCrate(audio, plan, reference, excluded) : null, [audio, plan, reference, excluded]);
  const run = async () => {
    if (!localApi || !ready || busy || !query.trim()) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/dj-assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DJ-Assistant': '1' },
        body: JSON.stringify({ mode: 'crate', query, previous: plan, hasReference: !!reference }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Could not plan this crate.');
      if (controller.signal.aborted) return;
      const next = parseCratePlan(result.plan);
      if (next.clarification) { setError(next.clarification); return; }
      setPlan(next); setExcluded([]);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Crate planning failed.'); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  return <details className="dj-crate-builder"><summary>Build a crate with AI</summary>
    <p className="dj-note">Describe the roles you need. Astra plans the filters; matches come from your library. You choose whether to add them.</p>
    <label>Crate request<textarea value={query} maxLength={2000} onChange={e => setQuery(e.target.value)} /></label>
    <button type="button" disabled={!ready || !localApi || busy || !query.trim()} onClick={() => void run()}>{busy ? 'Planning crate…' : plan ? 'Refine crate' : 'Suggest a crate'}</button>
    {busy && <button type="button" onClick={() => { request.current?.abort(); setBusy(false); }}>Stop</button>}
    {error && <p role="alert">{error}</p>}
    {proposal && <div aria-label="Proposed crate">
      {proposal.entries.map(entry => <div className="dj-crate-candidate" key={entry.node.id}><strong>{entry.role}: {entry.node.title}</strong><p className="dj-note">{entry.reasons.join(' · ')}</p></div>)}
      {proposal.missing.map(note => <p role="status" key={note}>{note}</p>)}
      <div className="dj-actions"><button disabled={!proposal.entries.length || !ready} onClick={() => onAdd(proposal.entries.map(entry => entry.node.id))}>Add proposed sounds to crate</button>
      <button disabled={!proposal.entries.length || !ready} onClick={() => {
        const least = [...proposal.entries].sort((a, b) => a.confidence - b.confidence)[0];
        if (least) setExcluded(previous => [...previous, least.node.id]);
      }}>Replace least certain match</button></div>
    </div>}
  </details>;
}
