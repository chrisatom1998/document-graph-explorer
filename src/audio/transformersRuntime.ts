import { musicInferenceThreads } from './musicRuntime';

/** Every model session in the music worker loads through here, so the shared onnxruntime is set up before its first
 * session, whichever model asks first. transformers.js points the runtime's WASM at a CDN by default; the app's CSP
 * blocks that, and a failed runtime start then fails every later session in the worker, the q8 WASM fallback
 * included. Since the graphics-card AST loads first (#168), it must not be the one to start the runtime from the CDN. */
export async function loadTransformers(): Promise<typeof import('@huggingface/transformers')> {
  const transformers = await import('@huggingface/transformers');
  const { env } = transformers;
  env.allowRemoteModels = false; env.allowLocalModels = true;
  env.localModelPath = import.meta.env.BASE_URL;
  // The bundled runtime (one WASM build serves both the WASM and WebGPU backends) loads from the app's own origin.
  if (env.backends.onnx.wasm) { env.backends.onnx.wasm.wasmPaths = undefined; env.backends.onnx.wasm.numThreads = musicInferenceThreads(); }
  return transformers;
}
