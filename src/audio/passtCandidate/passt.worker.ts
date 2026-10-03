import type * as Ort from 'onnxruntime-web/webgpu';
import { musicInferenceThreads } from '../musicRuntime';
import { PASST_IDENTITY } from './identity';
let session: Promise<{ort:typeof Ort;model:Ort.InferenceSession}> | undefined;
async function load() {
 const ort = await import('onnxruntime-web/webgpu');
 ort.env.wasm.numThreads = musicInferenceThreads();
 const response = await fetch(`${import.meta.env.BASE_URL}experimental-passt/model.onnx`);
 if (!response.ok) throw Error('Local experimental PaSST model unavailable');
 const bytes = new Uint8Array(await response.arrayBuffer());
 const digest = await crypto.subtle.digest('SHA-256', bytes);
 const hash = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
 if (hash !== PASST_IDENTITY.modelSha256) throw Error('Experimental PaSST model SHA mismatch');
 return {ort,model:await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })};
}
self.onmessage = async ({ data }: MessageEvent<{ id: number; samples: Float32Array; expectedModelSha256: string }>) => {
 try {
  if (data.expectedModelSha256 !== PASST_IDENTITY.modelSha256 || data.samples.length !== 320000 || !data.samples.every(Number.isFinite)) throw Error('Invalid experimental PaSST request');
  self.postMessage({id:data.id,phase:'Loading pinned ONNX model, threads='+musicInferenceThreads()});
  const {ort,model} = await (session ??= load().catch(error => { session = undefined; throw error; }));
  self.postMessage({id:data.id,phase:'Running20-output inference'});
  const input = new ort.Tensor('float32', data.samples, [1, 320000]);
  try {
   const outputs = await model.run({ samples32k: input });
   try { self.postMessage({ id: data.id, scores: Array.from(outputs.scores.data, Number) }); }
   finally { for (const output of Object.values(outputs)) output.dispose(); }
  } finally { input.dispose(); }
 } catch (error) { self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }); }
};
