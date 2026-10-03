import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ values: new Map<string, unknown>(), unavailable: false }));
vi.mock('../persistence/db', () => ({ getDb: async () => {
  if (state.unavailable) throw new Error('Storage unavailable');
  const store = {
    get: async (key: string) => state.values.get(key),
    put: async (value: unknown, key: string) => { state.values.set(key, value); },
    delete: async (key: string) => { state.values.delete(key); },
    getAllKeys: async () => [...state.values.keys()],
  };
  return { get: async (_store: string, key: string) => store.get(key), transaction: () => ({ store, done: Promise.resolve() }) };
} }));
let encoder: string; let review: string;
beforeEach(() => {
  vi.resetModules(); state.values.clear(); state.unavailable = false;
  encoder = 'a'.repeat(64); review = 'b'.repeat(64);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sha256: { 'model.onnx': encoder, 'config.json': 'c'.repeat(64), 'learned.json': review, 'prompts.json': review } })));
});
afterEach(() => vi.unstubAllGlobals());
const samples = () => new Float32Array([.1, .2, .3]);

it('persists raw features across workers and applies new reviews without recomputing the encoder', async () => {
  const compute = vi.fn(async () => Array.from({ length: 512 }, (_, i) => i === 0 ? 1 : 0));
  let cache = await import('./audioInferenceCache');
  const first = await cache.cachedAudioInference('sound-model', 'clap', samples(), cache.isAudioEmbedding, compute);
  review = 'd'.repeat(64); vi.resetModules(); // A model update restarts the worker.
  cache = await import('./audioInferenceCache');
  const hit = vi.fn();
  expect(await cache.cachedAudioInference('sound-model', 'clap', samples(), cache.isAudioEmbedding, compute, hit)).toEqual(first);
  expect(compute).toHaveBeenCalledTimes(1); expect(hit).toHaveBeenCalledTimes(1);
  encoder = 'e'.repeat(64); vi.resetModules(); cache = await import('./audioInferenceCache');
  await cache.cachedAudioInference('sound-model', 'clap', samples(), cache.isAudioEmbedding, compute);
  expect(compute).toHaveBeenCalledTimes(2);
});

it('keys exact PCM slices and keeps different model tasks separate', async () => {
  const { cachedAudioInference, isScoreMap } = await import('./audioInferenceCache');
  const compute = vi.fn(async () => ({ piano: .7 }));
  const bytes = new Float32Array([9, .1, .2, .3, 8]);
  await cachedAudioInference('music-model', 'ast', bytes.subarray(1, 4), isScoreMap, compute);
  await cachedAudioInference('music-model', 'ast', samples(), isScoreMap, compute);
  expect(compute).toHaveBeenCalledTimes(1);
  await cachedAudioInference('music-model', 'ast', new Float32Array([.1, .2, .31]), isScoreMap, compute);
  await cachedAudioInference('music-model', 'other', samples(), isScoreMap, compute);
  expect(compute).toHaveBeenCalledTimes(3);
});

it('recomputes corrupt entries and works when storage is unavailable', async () => {
  const { cachedAudioInference, isScoreMap } = await import('./audioInferenceCache');
  const compute = vi.fn(async () => ({ piano: .7 }));
  await cachedAudioInference('music-model', 'ast', samples(), isScoreMap, compute);
  const key = [...state.values.keys()][0]; state.values.set(key, { value: { piano: NaN } });
  expect(await cachedAudioInference('music-model', 'ast', samples(), isScoreMap, compute)).toEqual({ piano: .7 });
  state.unavailable = true;
  expect(await cachedAudioInference('music-model', 'ast', samples(), isScoreMap, compute)).toEqual({ piano: .7 });
  expect(compute).toHaveBeenCalledTimes(3);
});

it('does not store failed computations and bounds features without deleting user data', async () => {
  const { cachedAudioInference, isScoreMap } = await import('./audioInferenceCache');
  await expect(cachedAudioInference('music-model', 'ast', samples(), isScoreMap, async () => { throw new Error('Inference failed'); })).rejects.toThrow('Inference failed');
  expect(state.values.size).toBe(0);
  for (let i = 0; i < 4100; i++) state.values.set(`audio-inference:v2:decoder-mono-v1:old-${i}`, { savedAt: i, value: { piano: .2 } });
  state.values.set('user-settings', { preserve: true });
  await cachedAudioInference('music-model', 'ast', samples(), isScoreMap, async () => ({ piano: .7 }));
  expect([...state.values.keys()].filter(k => k.startsWith('audio-inference:'))).toHaveLength(4096);
  expect(state.values.get('user-settings')).toEqual({ preserve: true });
});

it('bypasses the cache when model fingerprints cannot be verified', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
  const { cachedAudioInference, isScoreMap } = await import('./audioInferenceCache');
  const compute = vi.fn(async () => ({ piano: .7 }));
  await cachedAudioInference('music-model', 'ast', samples(), isScoreMap, compute);
  await cachedAudioInference('music-model', 'ast', samples(), isScoreMap, compute);
  expect(compute).toHaveBeenCalledTimes(2); expect(state.values.size).toBe(0);
});
