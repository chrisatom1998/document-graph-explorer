import {musicCacheKey,musicCacheFingerprint,readMusicCache,writeMusicCache} from './musicAnalysisCache';
import { openMusicDecoder } from './decodeMusic';
import { analyzeDecodedMusic, previewDecodedMusic, type AnalysisOptions } from './analyzeDecodedMusic';
import type { MusicAnalysis } from './musicTypes';
import { ResultCache } from './recognition';
const cache = new ResultCache(128);
import { MusicTaskQueue } from './musicTaskQueue';
const workers = new Map<string, Worker>();
// Retaining both neural sessions is substantial on memory-constrained devices.
// Unknown-memory browsers preserve the previous single-session behavior.
const deviceMemory = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
const MAX_WORKERS = deviceMemory !== undefined && deviceMemory >= 16 ? 4 : 1;
let workerFingerprint: string | undefined;
// Two decoders can prepare audio. Up to four family sessions stay warm,
// but inference remains serialized to bound CPU and transient tensor memory.
const decoderQueue = new MusicTaskQueue(2);
const modelQueue = new MusicTaskQueue(1);
let nextId = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
function discard(current?: Worker) {
  for (const [family, worker] of workers) {
    if (!current || current === worker) { worker.terminate(); workers.delete(family); }
  }
}
function parkWorker() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(discard, 5 * 60_000);
}
type Options = AnalysisOptions;

function request<T>(message: Record<string, unknown>, transfer: Transferable[], options: Options, priority: 'preview' | 'analysis', fingerprint?: string): Promise<T> {
  return modelQueue.schedule(priority, () => runRequest<T>(message, transfer, options, fingerprint), options.signal);
}

function runRequest<T>(message: Record<string, unknown>, transfer: Transferable[], options: Options, fingerprint?: string): Promise<T> {
  options.signal?.throwIfAborted();
  clearTimeout(idleTimer);
  // Missing manifests cannot establish that a retained session is current.
  if (!fingerprint || workerFingerprint !== fingerprint) discard();
  workerFingerprint = fingerprint;
  const family = message.kind === 'rhythm' || message.kind === 'tonal' ? 'essentia' : String(message.kind);
  let current = workers.get(family);
  if (!current) {
    if (workers.size >= MAX_WORKERS) discard(workers.values().next().value);
    current = new Worker(new URL('./musicAnalysis.worker.ts', import.meta.url), { type: 'module' });
  }
  // Refresh insertion order so an unexpected fifth family evicts the least recently used.
  workers.delete(family); workers.set(family, current);
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); current.onmessage = null; current.onerror = null; };
    const fail = (error: Error) => { cleanup(); discard(current); reject(error); };
    const abort = () => fail(new DOMException('Music analysis cancelled.', 'AbortError'));
    const timer = setTimeout(() => fail(new Error('An audio section took too long to analyze. Try again on this device.')), 180_000);
    options.signal?.addEventListener('abort', abort, { once: true });
    current.onerror = e => fail(new Error(e.message || 'Music analysis worker failed.'));
    current.onmessage = ({ data }: MessageEvent<{ id: number; progress?: string; result?: T; error?: string }>) => {
      if (data.id !== id) return;
      if (data.progress) options.onProgress?.(data.progress);
      else if (data.result) { cleanup(); resolve(data.result); }
      else fail(new Error(data.error || 'Music analysis failed.'));
    };
    try { current.postMessage({ ...message, id }, transfer); }
    catch (error) { fail(error instanceof Error ? error : new Error('Music analysis worker failed.')); }
  });
}

/** Preview the folder first, then run deeper checks with bounded decoding and serialized inference. */
export function analyzeMusic(blob: Blob, name: string, options: Options = {}): Promise<MusicAnalysis> {
  const mode = options.mode ?? 'fast';
  const initial = decoderQueue.schedule('preview', async () => {
    options.signal?.throwIfAborted();
    clearTimeout(idleTimer);
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const audioFingerprint = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
    const key=await musicCacheKey(blob, mode);
    if(key&&!options.force){const cached=await readMusicCache(key);if(cached){options.signal?.throwIfAborted();options.onProgress?.('Reusing saved audio analysis');parkWorker();return { cached };}}
    options.signal?.throwIfAborted();
    const fingerprint = key ? musicCacheFingerprint(key) : undefined;
    options.onProgress?.('Preparing folder preview');
    const decoder = await openMusicDecoder(blob, name, options.signal);
    try {
      const preview = await previewDecodedMusic(decoder, (message, transfer) => request(message, transfer, options, 'preview', fingerprint), { ...options, mode });
      options.onProgress?.(preview ? 'Preview ready. Waiting for deeper checks' : 'Waiting for deeper checks; the initial estimate was unavailable');
      return { preview, key, fingerprint, audioFingerprint };
    } finally { decoder.close(); parkWorker(); }
  }, options.signal);
  return initial.then(first => {
    if (first.cached) return first.cached;
    return decoderQueue.schedule('analysis', async () => {
      options.signal?.throwIfAborted();
      options.onProgress?.('Decoding tempo and key excerpts');
      const decoder = await openMusicDecoder(blob, name, options.signal);
      try {
        const result = await analyzeDecodedMusic(decoder, (message, transfer) => request(message, transfer, options, 'analysis', first.fingerprint),
          { ...options, mode, initialPreview: first.preview, audioFingerprint: first.audioFingerprint, cache });
        if (first.key) await writeMusicCache(first.key, result);
        options.signal?.throwIfAborted();
        return result;
      } finally { decoder.close(); parkWorker(); }
    }, options.signal);
  }).finally(parkWorker);
}
