import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAGGER_POLICY } from './tagger';

const runtime = vi.hoisted(() => ({ run: vi.fn(), disposeInput: vi.fn(), disposeOutput: vi.fn() }));
vi.mock('onnxruntime-web/webgpu', () => ({
  env: { wasm: {} },
  InferenceSession: { create: vi.fn(async () => ({ run: runtime.run })) },
  Tensor: class { dispose = runtime.disposeInput; },
}));

const classes = TAGGER_POLICY.tags.map(tag => tag.output);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
    classes, sha256: { 'model.onnx': TAGGER_POLICY.modelSha256 },
  }) })));
});
afterEach(() => vi.unstubAllGlobals());

async function classify(scores: number[]) {
  runtime.run.mockResolvedValue({ [TAGGER_POLICY.input.output]: {
    data: Float32Array.from(scores), dispose: runtime.disposeOutput,
  } });
  const { classifyTagger } = await import('./taggerInference');
  return classifyTagger(new Float32Array(320000));
}

describe('tagger inference output validation', () => {
  it('preserves valid model probabilities without rounding', async () => {
    const values = classes.map((_, i) => i / classes.length);
    const result = await classify(values);
    expect(result).toEqual(Object.fromEntries(classes.map((label, i) => [label, Math.fround(values[i])])));
    expect(runtime.disposeInput).toHaveBeenCalledOnce();
    expect(runtime.disposeOutput).toHaveBeenCalledOnce();
  });

  it.each([NaN, Infinity, -Infinity, -.01, 1.01])('rejects invalid probability %s and releases tensors', async invalid => {
    const values = classes.map(() => .5);
    values[0] = invalid;
    await expect(classify(values)).rejects.toThrow('invalid probability');
    expect(runtime.disposeInput).toHaveBeenCalledOnce();
    expect(runtime.disposeOutput).toHaveBeenCalledOnce();
  });

  it('rejects incomplete model output and releases tensors', async () => {
    await expect(classify([.5])).rejects.toThrow('unexpected number');
    expect(runtime.disposeInput).toHaveBeenCalledOnce();
    expect(runtime.disposeOutput).toHaveBeenCalledOnce();
  });
});
