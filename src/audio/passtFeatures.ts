import soundManifest from '../../public/sound-model/manifest.json';

/** PaSST features for one short clip, or undefined so the clip keeps its CLAP-only heads.
 * The ~340 MB session loads on the first short clip only. After any load failure, timeout or
 * low-memory device it stays off for the session; a slow or broken model never blocks analysis. */
let worker: Worker | undefined;
let disabled = !(soundManifest.sha256 as Record<string, string>)['short-clip-passt.json'];
let loaded = false;
let nextId = 0;
const deviceMemory = () => typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

/** Whether this tab can still produce PaSST features; a saved CLAP-only result stays current when it cannot. */
export function passtExpected(): boolean {
  const memory = deviceMemory();
  return !disabled && !(memory !== undefined && memory < 4) && typeof Worker !== 'undefined';
}
// One shared worker answers one request at a time: concurrent analyses wait their turn, so a second
// caller never replaces the first one's reply handler (which would time out and turn PaSST off).
let queue: Promise<unknown> = Promise.resolve();
export function passtFeatures(samples32k: Float32Array, signal?: AbortSignal): Promise<number[] | undefined> {
  const run = queue.then(() => passtFeaturesNow(samples32k, signal));
  queue = run.catch(() => {});
  return run;
}
function passtFeaturesNow(samples32k: Float32Array, signal?: AbortSignal): Promise<number[] | undefined> {
  if (!passtExpected()) return Promise.resolve(undefined);
  signal?.throwIfAborted();
  if (!worker) worker = new Worker(new URL('./passtFeatures.worker.ts', import.meta.url), { type: 'module' });
  const current = worker, id = ++nextId;
  const samples = new Float32Array(320000); samples.set(samples32k.subarray(0, 320000));
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); current.onmessage = null; current.onerror = null; };
    const off = () => { cleanup(); disabled = true; current.terminate(); worker = undefined; resolve(undefined); };
    const abort = () => { cleanup(); current.terminate(); worker = undefined; reject(new DOMException('PaSST analysis cancelled.', 'AbortError')); };
    // The first call downloads and compiles the model; later clips take about 2 s each.
    const timer = setTimeout(off, loaded ? 30_000 : 240_000);
    signal?.addEventListener('abort', abort, { once: true });
    current.onerror = off;
    current.onmessage = ({ data }) => {
      if (data.id !== id) return;
      if (data.error || !Array.isArray(data.features) || data.features.length !== 768) { off(); return; }
      cleanup(); loaded = true; resolve(data.features);
    };
    current.postMessage({ id, samples }, [samples.buffer]);
  });
}
export function releasePasstFeatures() { worker?.terminate(); worker = undefined; }
