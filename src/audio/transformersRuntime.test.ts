import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// transformers.js's own default: the runtime WASM from a CDN, which the app's CSP blocks.
const CDN = { mjs: 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', wasm: 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm' };
const env = { allowRemoteModels: true, allowLocalModels: false, localModelPath: '/models/', backends: { onnx: { wasm: { wasmPaths: CDN as unknown, numThreads: 0 } } } };
vi.mock('@huggingface/transformers', () => ({ env }));

describe('music worker model runtime', () => {
  it('serves the runtime from the app and loads local models only, before any session starts', async () => {
    const { loadTransformers } = await import('./transformersRuntime');
    const transformers = await loadTransformers();
    expect(transformers.env).toBe(env);
    expect(env.backends.onnx.wasm.wasmPaths).toBeUndefined();
    expect(env.backends.onnx.wasm.numThreads).toBeGreaterThanOrEqual(1);
    expect(env.allowRemoteModels).toBe(false);
    expect(env.allowLocalModels).toBe(true);
  });

  it('loads every worker model, the graphics-card AST included, through that setup', () => {
    // The GPU AST loads first since #168. It once set up the runtime itself, kept the CDN default, and every
    // later AST session in the worker (the q8 WASM fallback too) failed, so each track lost its instrument scan.
    const worker = readFileSync(new URL('./musicAnalysis.worker.ts', import.meta.url), 'utf8');
    expect(worker).not.toMatch(/=\s*await import\(['"]@huggingface\/transformers['"]\)/);
    const loads = worker.match(/\.from_pretrained\(/g)?.length ?? 0;
    expect(loads).toBeGreaterThanOrEqual(3);
    expect(worker.match(/await loadTransformers\(\)/g)?.length).toBe(3);
  });
});
