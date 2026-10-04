import { useEffect, useState } from 'react';

const STORAGE_KEY = 'dge:reviewer-pack-job';
export interface PackSource { name: string; sourceUrl: string; licenseUrl: string }
interface ImportResult { added: number; skipped: number; failed: { name: string; reason: string }[] }
function savedJob() {
  try { const id = localStorage.getItem(STORAGE_KEY); return id && /^[a-f0-9]{24}$/.test(id) ? id : ''; } catch { return ''; }
}
export function useReviewerImport(enabled: boolean) {
  const [job, setJob] = useState(savedJob);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  useEffect(() => {
    if (!enabled || !job) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/dj-reviewer/jobs/${job}`, { headers: { 'X-DJ-Assistant': '1' }, signal: controller.signal });
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (response.status === 404) throw new Error('The reviewer restarted. Check its sound list before importing this pack again.');
        if (!response.ok) { setStatus('Reconnecting to reviewer… Import continues locally.'); timer = setTimeout(() => { void poll(); }, 3000); return; }
        setStatus(String(data.message || 'Importing pack…'));
        if (data.state === 'complete' || data.state === 'failed') {
          try { localStorage.removeItem(STORAGE_KEY); } catch { /* Optional persistence. */ }
          setJob('');
          if (data.state === 'failed') setError(String(data.message || 'Import failed.'));
          else setResult(data.result);
        } else timer = setTimeout(() => { void poll(); }, 1000);
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof Error && e.message.startsWith('The reviewer restarted')) {
          setError(e.message); setJob('');
          try { localStorage.removeItem(STORAGE_KEY); } catch { /* Optional persistence. */ }
        } else { setStatus('Reconnecting to reviewer… Import continues locally.'); timer = setTimeout(() => { void poll(); }, 3000); }
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [enabled, job]);

  const submit = async (path: string, body: BodyInit, contentType: string) => {
    if (!enabled || submitting || job) return;
    setSubmitting(true); setError(''); setResult(null); setStatus('Connecting to reviewer and sending pack…');
    try {
      const response = await fetch(`/api/dj-reviewer/${path}`, { method: 'POST', headers: { 'X-DJ-Assistant': '1', 'Content-Type': contentType }, body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not start import.');
      if (typeof data.jobId !== 'string' || !/^[a-f0-9]{24}$/.test(data.jobId)) throw new Error('Reviewer did not return an import job.');
      try { localStorage.setItem(STORAGE_KEY, data.jobId); } catch { /* In-memory progress still works. */ }
      setJob(data.jobId);
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.'); setStatus(''); }
    finally { setSubmitting(false); }
  };
  return { busy: submitting || Boolean(job), status, error, result,
    download: (packId: string) => submit('packs', JSON.stringify({ packId }), 'application/json'),
    upload: (file: File, source: PackSource) => {
      if (file.size > 100 * 1024 * 1024) { setError('Choose an archive under 100 MB.'); return Promise.resolve(); }
      return submit(`archive?${new URLSearchParams({ ...source })}`, file, 'application/octet-stream');
    },
  };
}
