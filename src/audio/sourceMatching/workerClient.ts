import type { Fingerprint, PcmAudio } from './fingerprint';
import type { Candidate, MatchResult } from './matching';
import type { MatchingWorkerRequest } from './sourceMatching.worker';

/** One job per worker: abort/timeout terminates computation without losing the imported library. */
function request<T>(input: MatchingWorkerRequest, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sourceMatching.worker.ts', import.meta.url), { type: 'module' });
    const finish = (error?: Error, value?: T) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); if (error) reject(error); else resolve(value!); };
    const abort = () => finish(new DOMException('Source comparison stopped.', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Source comparison timed out. Choose a shorter clip or fewer references.')), 60_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(new Error('The local source-comparison worker could not run.'));
    worker.onmessage = (event: MessageEvent<{ ok: boolean; value?: T; error?: string }>) => event.data.ok ? finish(undefined, event.data.value) : finish(new Error(event.data.error || 'Source comparison failed.'));
    try { worker.postMessage(input); } catch (error) { finish(error instanceof Error ? error : new Error('Source comparison could not start.')); }
  });
}
export const fingerprintInWorker = (audio: PcmAudio, signal?: AbortSignal) => request<Fingerprint>({ kind: 'fingerprint', audio }, signal);
export const matchInWorker = (audio: PcmAudio, candidates: Candidate[], fileSha256: string, signal?: AbortSignal) => request<MatchResult>({ kind: 'match', audio, candidates, fileSha256 }, signal);
