import { musicWorkerCapacity } from './musicWorkerRetention';
import { DecodedMusicCache, musicDecoderFromSnapshot } from './musicDecodedCache';
import { loadBuiltInFusion, supportsFusionInput, fusionConfiguration } from './fusionRelease';
import {musicCacheKey,musicWorkerFingerprint,readMusicCache,writeMusicCache} from './musicAnalysisCache';
import { openMusicDecoder } from './decodeMusic';
import { analyzeDecodedMusic, previewDecodedMusic, type AnalysisOptions } from './analyzeDecodedMusic';
import type { MusicAnalysis } from './musicTypes';
import { ResultCache } from './recognition';
const cache = new ResultCache(128);
const decodedCache = new DecodedMusicCache();
import { MusicTaskQueue } from './musicTaskQueue';
import { musicInferenceThreads, THREADED_RUNTIME_STALLED, switchToSingleThreadRuntime } from './musicRuntime';
const workers = new Map<string, Worker>();
// Pinned quantized native weights total about190MB. Bound retained family sessions
// and preserve the low-memory fallback of one serialized session.
const workerCapacity = () => musicWorkerCapacity(
  typeof navigator === 'undefined' ? undefined : (navigator as Navigator & {deviceMemory?:number}).deviceMemory,
  typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency,
);
let workerFingerprint: string | undefined;
// Two decoders can prepare audio. Up to four family sessions stay warm.
const decoderQueue = new MusicTaskQueue(2);
const modelQueue = new MusicTaskQueue(1);
// With a retained worker per family and cores to spare, the families run side by side:
// each worker still takes one request at a time, so per-model memory stays bounded.
// AST and CLAP use four threads each; smaller hosts keep one serialized queue.
const familyQueues = new Map<string, MusicTaskQueue>();
const concurrentModels = () => workerCapacity() >= 4 && typeof navigator !== 'undefined' && navigator.hardwareConcurrency >= 8;
const familyOf = (kind: unknown) => kind === 'rhythm' || kind === 'tonal' ? 'essentia' : String(kind);
function queueFor(family: string): MusicTaskQueue {
  if (!concurrentModels()) return modelQueue;
  let queue = familyQueues.get(family);
  if (!queue) familyQueues.set(family, queue = new MusicTaskQueue(1));
  return queue;
}
let nextId = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
// A terminated worker never answers: fail its request now instead of at the timeout.
const inFlight = new Map<Worker, (error: Error) => void>();
function discard(current?: Worker, reason = 'Music analysis worker was replaced.') {
  for (const [family, worker] of workers) {
    if (current && current !== worker) continue;
    const fail = inFlight.get(worker);
    inFlight.delete(worker); worker.terminate(); workers.delete(family);
    fail?.(new Error(reason));
  }
}
function parkWorker() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(discard, 5 * 60_000);
}
type Options = AnalysisOptions;

function workerFor(family: string, fingerprint?: string): Worker {
  // Missing manifests cannot establish that a retained session is current.
  if (!fingerprint || workerFingerprint !== fingerprint) discard();
  workerFingerprint = fingerprint;
  let current = workers.get(family);
  if (!current) {
    if (workers.size >= workerCapacity()) discard(workers.values().next().value);
    current = new Worker(new URL('./musicAnalysis.worker.ts', import.meta.url), { type: 'module' });
  }
  // Refresh insertion order so an unexpected fifth family evicts the least recently used.
  workers.delete(family); workers.set(family, current);
  return current;
}

// Every family a full analysis touches; each holds its own retained worker.
const PRELOAD_FAMILIES = ['instruments', 'profile', 'jamendo', 'essentia'] as const;
let preloading: Promise<void> | undefined;

/** Start the model workers and load their weights before the first clip needs them.
 * Uses the same fingerprint as real requests, so the warm workers are reused rather than discarded.
 * Skipped on one-worker hosts, where each family would evict the previous one. */
export function preloadMusicModels(mode: AnalysisOptions['mode'] = 'fast'): Promise<void> {
  if (typeof Worker === 'undefined' || workerCapacity() < PRELOAD_FAMILIES.length) return Promise.resolve();
  return preloading ??= (async () => {
    const key = await musicCacheKey(new Blob([]), mode ?? 'fast');
    if (!key) return;
    const fingerprint = musicWorkerFingerprint(key);
    clearTimeout(idleTimer);
    await Promise.allSettled(PRELOAD_FAMILIES.map(family => warmWorker(workerFor(family, fingerprint), family)));
  })().finally(() => { preloading = undefined; parkWorker(); });
}

function warmWorker(worker: Worker, family: string): Promise<void> {
  const id = ++nextId;
  return new Promise<void>((resolve, reject) => {
    // A listener, not onmessage, so a real request that starts meanwhile keeps its own handler.
    const done = (error?: Error) => { clearTimeout(timer); worker.removeEventListener('message', onMessage); worker.removeEventListener('error', onError); if (error) reject(error); else resolve(); };
    const onMessage = ({ data }: MessageEvent<{ id: number; warmed?: boolean; error?: string }>) => {
      if (data.id !== id) return;
      if (data.error === THREADED_RUNTIME_STALLED) { switchToSingleThreadRuntime(); discard(worker, THREADED_RUNTIME_STALLED); }
      done(data.error ? new Error(data.error) : undefined);
    };
    const onError = () => done(new Error('Music model preload failed.'));
    const timer = setTimeout(() => done(new Error('Music model preload timed out.')), 180_000);
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ kind: 'warm', family, id, ...threadHint() });
  });
}

/** Tells a worker to use one inference thread once this browser has shown its threads never start. */
const threadHint = () => musicInferenceThreads() === 1 ? { singleThread: true } : {};
function request<T>(message: Record<string, unknown>, transfer: Transferable[], options: Options, priority: 'preview' | 'analysis', fingerprint?: string): Promise<T> {
  return queueFor(familyOf(message.kind)).schedule(priority, async () => {
    // Only a multi-threaded worker can stall; keep a copy of the audio (the first attempt transfers it away).
    const retryCopy = musicInferenceThreads() > 1 ? structuredClone(message) : undefined;
    try { return await runRequest<T>(message, transfer, options, fingerprint); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== THREADED_RUNTIME_STALLED || !retryCopy) throw error;
      // The stuck worker was discarded; run the same request once more on a fresh single-thread worker.
      switchToSingleThreadRuntime();
      return runRequest<T>(retryCopy, [], options, fingerprint);
    }
  }, options.signal);
}

function runRequest<T>(message: Record<string, unknown>, transfer: Transferable[], options: Options, fingerprint?: string): Promise<T> {
  options.signal?.throwIfAborted();
  clearTimeout(idleTimer);
  const current = workerFor(familyOf(message.kind), fingerprint);
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); current.onmessage = null; current.onerror = null; if (inFlight.get(current) === fail) inFlight.delete(current); };
    const fail = (error: Error) => { cleanup(); discard(current); reject(error); };
    inFlight.set(current, fail);
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
    try { current.postMessage({ ...message, id, ...threadHint() }, transfer); }
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
    const fingerprint = key ? musicWorkerFingerprint(key) : undefined;
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
          { ...options, fusion, sourceMime: blob.type, mode, initialPreview: first.preview, audioFingerprint: first.audioFingerprint, cache, concurrentModels: concurrentModels(),
            passt: options.passt ?? (async (samples, signal) => (await import('./passtFeatures')).passtFeatures(samples, signal)) });
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
