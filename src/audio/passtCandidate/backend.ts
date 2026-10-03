import { PASST_IDENTITY } from './identity';
let worker: Worker | undefined;
let nextId = 0;
// The analysis queue serializes calls; a separate worker isolates the large experimental session.
export function predictPaSST(samples: Float32Array, signal?: AbortSignal): Promise<number[]> {
 signal?.throwIfAborted();
 worker ??= new Worker(new URL('./passt.worker.ts', import.meta.url), { type: 'module' });
 const current = worker, id = ++nextId;
 return new Promise((resolve, reject) => {
  const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); current.onmessage = null; current.onerror = null; };
  const fail = (error: Error) => { cleanup(); current.terminate(); if (worker === current) worker = undefined; reject(error); };
  const abort = () => fail(new DOMException('PaSST analysis cancelled.', 'AbortError'));
  const timer = setTimeout(() => fail(Error('Experimental PaSST timeout')), 180000);
  signal?.addEventListener('abort', abort, { once: true });
  current.onerror = event => fail(Error(event.message || 'Experimental PaSST worker failed'));
  current.onmessage = ({ data }) => { if (data.id !== id) return; if (data.phase) { console.info('PaSST worker phase', data.phase); return; } if (data.error) fail(Error(data.error)); else { cleanup(); resolve(data.scores); } };
  const copy = new Float32Array(samples);
  current.postMessage({ id, samples: copy, expectedModelSha256: PASST_IDENTITY.modelSha256 }, [copy.buffer]);
 });
}
export function releasePaSST() { worker?.terminate(); worker = undefined; }
