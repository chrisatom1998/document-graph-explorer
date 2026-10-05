import type * as Ort from 'onnxruntime-web';
import manifest from '../../public/passt-model/manifest.json';

const MODEL_SHA = manifest.sha256['model.onnx'];
let session: Promise<{ ort: typeof Ort; model: Ort.InferenceSession }> | undefined;
/** The graphics card when the browser offers one (about 0.15 s a clip, measured 2026-10-05), else WASM on the
 * app's configured thread count (2-10 s a clip). The main thread watches a threaded WASM start for the
 * stall some embedded browsers show and retries on one thread. */
async function load(threads: number) {
  const ort = await import('onnxruntime-web/webgpu') as unknown as typeof Ort;
  ort.env.wasm.numThreads = threads;
  const response = await fetch(`${import.meta.env.BASE_URL}passt-model/model.onnx`);
  if (!response.ok) throw Error('PaSST model unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
  if (hash !== MODEL_SHA) throw Error('PaSST model SHA mismatch');
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu && await gpu.requestAdapter().catch(() => null)) {
    self.postMessage({ phase: 'creating', backend: 'webgpu' });
    try { return { ort, model: await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] }) }; }
    catch { /* An adapter without the needed features: fall back to WASM below. */ }
  }
  self.postMessage({ phase: 'creating', backend: 'wasm', threads });
  return { ort, model: await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }) };
}
/** The frozen backbone's 768 features for exactly 10 s of 32 kHz mono, as scripts/embed-passt.py computes them. */
self.onmessage = async ({ data }: MessageEvent<{ id: number; samples: Float32Array; threads: number }>) => {
  try {
    if (data.samples.length !== 320000 || !data.samples.every(Number.isFinite)) throw Error('Invalid PaSST request');
    const { ort, model } = await (session ??= load(Number.isInteger(data.threads) && data.threads >= 1 ? data.threads : 1));
    const input = new ort.Tensor('float32', data.samples, [1, 320000]);
    try {
      const outputs = await model.run({ samples32k: input }, ['features']);
      try { self.postMessage({ id: data.id, features: Array.from(outputs.features.data as Float32Array, Number) }); }
      finally { for (const output of Object.values(outputs)) output.dispose(); }
    } finally { input.dispose(); }
  } catch (error) { self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }); }
};
