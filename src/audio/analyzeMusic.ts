import { openMusicDecoder } from './decodeMusic';
import { analyzeDecodedMusic, type AnalysisOptions } from './analyzeDecodedMusic';
import type { MusicAnalysis } from './musicTypes';
import { ResultCache } from './recognition';
let worker: Worker | null = null;
let workerFamily = '';
const cache = new ResultCache(128);
let tail: Promise<unknown> = Promise.resolve();
let nextId = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
function discard() { worker?.terminate(); worker = null; }
type Options = AnalysisOptions;

function request<T>(message: Record<string, unknown>, transfer: Transferable[], options: Options): Promise<T> {
  options.signal?.throwIfAborted();
  clearTimeout(idleTimer);
  const family = message.kind === 'rhythm' || message.kind === 'tonal' ? 'essentia' : String(message.kind);
  // Keep only one loaded model family resident. Tracks and requests are serialized.
  if (worker && workerFamily !== family) discard();
  workerFamily = family;
  worker ??= new Worker(new URL('./musicAnalysis.worker.ts', import.meta.url), { type: 'module' });
  const current = worker; const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); current.onmessage = null; current.onerror = null; };
    const fail = (error: Error) => { cleanup(); discard(); reject(error); };
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
    current.postMessage({ ...message, id }, transfer);
  });
}

/** Scan the full recording in bounded sections; serialize tracks to keep model memory bounded. */
export function analyzeMusic(blob: Blob, name: string, options: Options = {}): Promise<MusicAnalysis> {
  const run = async () => {
    options.signal?.throwIfAborted();
    clearTimeout(idleTimer);
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const audioFingerprint = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
    options.signal?.throwIfAborted();
    options.onProgress?.('Decoding tempo and key excerpts');
    const decoder = await openMusicDecoder(blob, name, options.signal);
    try {
      return await analyzeDecodedMusic(decoder, (message, transfer) => request(message, transfer, options), { ...options, audioFingerprint, cache });
    } finally { decoder.close(); idleTimer = setTimeout(discard, 60_000); }
  };
  const result = tail.then(run, run); tail = result.catch(() => undefined); return result;
}
