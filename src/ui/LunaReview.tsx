import { useEffect, useRef, useState } from 'react';
import { deterministicLuna, LUNA_MODEL, LUNA_POLICY, LUNA_TAXONOMY, type LunaReport, type LunaSample } from '../audio/lunaEvidence';

export default function LunaReview({ samples, disabled, onChooseAudio }: {
  samples: LunaSample[]; disabled: boolean; onChooseAudio: (refs: string[]) => void;
}) {
  const fingerprint = JSON.stringify(samples);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ fingerprint: string; report: LunaReport } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => () => { request.current?.abort(); }, [fingerprint]);
  const report = saved?.fingerprint === fingerprint ? saved.report : null;
  const results = report?.samples ?? samples.map(deterministicLuna);
  const review = async () => {
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/dj-copilot/review-luna', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DJ-Assistant': '1' },
        body: JSON.stringify({ samples }), signal: controller.signal });
      const data = await response.json() as LunaReport;
      if (!response.ok || data.model !== LUNA_MODEL || data.policy !== LUNA_POLICY || !['complete', 'fallback'].includes(data.status) ||
        !Array.isArray(data.samples) || data.samples.length !== samples.length || data.samples.some((s, i) =>
          s.ref !== samples[i].ref || !['recommend', 'skip', 'abstain'].includes(s.review) || typeof s.reason !== 'string' || s.reason.length > 400 ||
          !Array.isArray(s.labels) || s.labels.length !== samples[i].labels.length || s.labels.some((l, n) =>
            l.id !== samples[i].labels[n].id || l.originalLabel !== samples[i].labels[n].originalLabel || l.sourceModel !== samples[i].labels[n].sourceModel ||
            l.group !== samples[i].labels[n].group || (l.canonicalLabel !== null && !LUNA_TAXONOMY[l.group].includes(l.canonicalLabel))))) throw Error('Luna review unavailable. Existing detector results are unchanged.');
      if (!controller.signal.aborted) setSaved({ fingerprint, report: data });
    } catch { if (!controller.signal.aborted) setError('Luna review unavailable. Existing detector results are unchanged.'); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  return <section aria-label="Label normalization and review routing">
    <h3>Label normalization and review routing</h3>
    <p>Known aliases are mapped locally. Luna can check unresolved names and suggest whether listening would help. This sends bounded detector evidence, no audio or filenames. Proposals remain unverified.</p>
    <button disabled={disabled || busy || !samples.length} onClick={() => void review()}>Normalize labels and check review need</button>
    {busy && <button onClick={() => request.current?.abort()}>Stop Luna review</button>}
    {busy && <p role="status">Checking detector evidence with GPT-6 Luna…</p>}
    {error && <p role="alert">{error}</p>}
    {results.map(s => <article key={s.ref}>
      <strong>{s.ref}</strong>
      <p>{s.reason}</p>
      {report && <p>{s.review === 'recommend' ? 'GPT-Audio review may help.' : s.review === 'skip' ? 'No further review recommended.' : 'No recommendation; keep the detector results.'}</p>}
      <details><summary>Unverified label proposals and detector provenance</summary>
        <ul>{s.labels.map(l => <li key={l.id}>{l.originalLabel}{l.canonicalLabel !== null && l.originalLabel !== l.canonicalLabel ? ` → ${l.canonicalLabel}` : ''} · {l.sourceModel} · {l.method === 'protected' ? 'protected by your review' : l.method === 'unresolved' ? 'unresolved' : l.method === 'luna' ? 'Luna proposal' : 'local mapping'} · {l.coverage?.length ? l.coverage.map(w => `${w.start.toFixed(1)}–${w.end.toFixed(1)}s`).join(', ') : 'coverage unknown'}</li>)}</ul>
      </details>
    </article>)}
    {report?.samples.some(s => s.review === 'recommend') && <button disabled={disabled || busy} onClick={() => onChooseAudio(report.samples.filter(s => s.review === 'recommend').map(s => s.ref))}>Choose GPT-Audio listening review</button>}
    {report && <p>GPT-6 Luna · {report.cached ? 'cached evidence review' : report.status === 'fallback' ? 'fallback to detector evidence' : 'metadata review only'}. No labels were changed. Audio uploads require Review selected sounds in listening mode.</p>}
  </section>;
}
