import { musicWorkerCapacity } from './musicWorkerRetention';
import { DecodedMusicCache, musicDecoderFromSnapshot } from './musicDecodedCache';
import { loadBuiltInFusion, supportsFusionInput, fusionConfiguration } from './fusionRelease';
import {musicCacheKey,musicCacheFingerprint,readMusicCache,writeMusicCache} from './musicAnalysisCache';
import { openMusicDecoder } from './decodeMusic';
import { analyzeDecodedMusic, previewDecodedMusic, type AnalysisOptions } from './analyzeDecodedMusic';
import type { MusicAnalysis } from './musicTypes';
import { ResultCache } from './recognition';
const cache = new ResultCache(128);
const decodedCache = new DecodedMusicCache();
import { MusicTaskQueue } from './musicTaskQueue';
const workers = new Map<string, Worker>();
// Pinned quantized native weights total about190MB. Bound retained family sessions,
// preserve low-memory fallback, and serialize inference so retained workers are idle.
const workerCapacity = () => musicWorkerCapacity(
  typeof navigator === 'undefined' ? undefined : (navigator as Navigator & {deviceMemory?:number}).deviceMemory,
  typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency,
);
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
    if (workers.size >= workerCapacity()) discard(workers.values().next().value);
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
    current.onmessage = ({ data }: MessageEvent<{ id: number; progress?: string; result?: T; error?: string; runtime?: {backend:string;configuredInferenceThreads:number;effectiveInferenceThreads?:number;inferenceExecuted:boolean} }>) => {
      if (data.id !== id) return;
      if (data.progress) options.onProgress?.(data.progress);
      else if (data.result) { if (data.runtime) { try { options.onRuntime?.({ kind: String(message.kind), ...data.runtime }); } catch { /* Observations cannot change classification. */ } } cleanup(); resolve(data.result); }
      else fail(new Error(data.error || 'Music analysis failed.'));
    };
    try { current.postMessage({ ...message, id }, transfer); }
    catch (error) { fail(error instanceof Error ? error : new Error('Music analysis worker failed.')); }
  });
}

/** Preview the folder first, then run deeper checks with bounded decoding and serialized inference. */
export function analyzeMusic(blob: Blob, name: string, options: Options = {}): Promise<MusicAnalysis> {
  const mode = options.mode ?? 'fast';
  const injectedFusion = options.fusion;
  // Explicit local research build only; preserve installed persistent analysis namespace.
  const experimentalPaSST = !injectedFusion && import.meta.env.VITE_EXPERIMENTAL_PASST === '1';
  const initial = decoderQueue.schedule('preview', async () => {
    options.signal?.throwIfAborted();
    clearTimeout(idleTimer);
    options.signal?.throwIfAborted();
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const audioFingerprint = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
    const key=await musicCacheKey(blob, mode);
    if(key&&!options.force&&!injectedFusion&&!experimentalPaSST){const cached=await readMusicCache(key, blob.type);if(cached){options.signal?.throwIfAborted();options.onProgress?.('Reusing saved audio analysis');parkWorker();return { cached };}}
    options.signal?.throwIfAborted();
    const fingerprint = key ? musicCacheFingerprint(key) : undefined;
    options.onProgress?.('Preparing folder preview');
    const decoder = await openMusicDecoder(blob, name, options.signal);
    try {
      const preview = await previewDecodedMusic(decoder, (message, transfer) => request(message, transfer, options, 'preview', fingerprint), { ...options, mode });
      options.onProgress?.(preview ? 'Preview ready. Waiting for deeper checks' : 'Waiting for deeper checks; the initial estimate was unavailable');
      if (!options.signal?.aborted) decodedCache.remember(audioFingerprint, decoder.snapshot?.());
      return { preview, key, fingerprint, audioFingerprint };
    } finally { decoder.close(); parkWorker(); }
  }, options.signal);
  return initial.then(first => {
    if (first.cached) return first.cached;
    return decoderQueue.schedule('analysis', async () => {
      options.signal?.throwIfAborted();
      options.onProgress?.('Decoding tempo and key excerpts');
      const snapshot = decodedCache.take(first.audioFingerprint!);
      const decoder = snapshot
        ? musicDecoderFromSnapshot(snapshot, () => openMusicDecoder(blob, name, options.signal), options.signal)
        : await openMusicDecoder(blob, name, options.signal);
      try {
        let fusion = injectedFusion, fusionFailed = false;
        if (!fusion && supportsFusionInput(decoder.durationSeconds, mode, blob.type)) {
          try { fusion = await loadBuiltInFusion(); }
          catch { fusionFailed = true; }
        }
        const prepared = experimentalPaSST && fusion
          ? (await import('./passtCandidate')).prepareExperimentalPaSST({ enabled: true, baseline: fusion, decoder }) : undefined;
        if (prepared) fusion = prepared.scorer;
        options.signal?.throwIfAborted();
        const result = await analyzeDecodedMusic(decoder, (message, transfer) => request(message, transfer, options, 'analysis', first.fingerprint),
          { ...options, fusion, sourceMime: blob.type, mode, initialPreview: first.preview, audioFingerprint: first.audioFingerprint, cache });
        if (prepared) {
          result.fusion = prepared.restore(result.fusion);
          result.notes.push(prepared.usedFallback() ? 'Experimental source model unavailable; installed detector retained.' : 'Experimental PaSST source diagnostics; calibration only, no validation receipt.');
          result.classifierConfiguration = JSON.stringify({ experiment: 'passt-openmic-pretrained-v7', identity: fusion!.identity, persistentCache: false });
        }
        if (fusionFailed) result.notes.push('The trained source classifier is unavailable; native analysis is retained.');
        else if (!injectedFusion && (!prepared || prepared.usedFallback()) && !result.fusion?.counts.failed) result.classifierConfiguration = fusionConfiguration();
        if (first.key && !injectedFusion && !fusionFailed && !experimentalPaSST) await writeMusicCache(first.key, result, blob.type);
        options.signal?.throwIfAborted();
        return result;
      } finally { decoder.close(); parkWorker(); }
    }, options.signal);
  }).catch(error => { void initial.then(first => { if (first.audioFingerprint) decodedCache.forget(first.audioFingerprint); }).catch(() => {}); throw error; }).finally(parkWorker);
}
