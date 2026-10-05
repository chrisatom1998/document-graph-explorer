import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MusicRequest } from './analyzeDecodedMusic';
import type { MusicDecoder } from './decodeMusic';

beforeEach(() => {
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('SharedArrayBuffer', class {});
  vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

/** Runs a fast analysis whose runtime falls back to one thread on the first request of `switchOn`. */
async function runWithFallback(switchOn: 'instruments' | 'profile') {
  const { analyzeDecodedMusic } = await import('./analyzeDecodedMusic');
  const { recognitionConfiguration } = await import('./recognition');
  const { switchToSingleThreadRuntime } = await import('./musicRuntime');
  const duration = 30;
  const decoder: MusicDecoder = { durationSeconds: duration, close() {}, read: async (start, seconds, rate) =>
    new Float32Array(Math.round(Math.max(0, Math.min(seconds, duration - start)) * rate)).fill(.1) };
  const order: string[] = [];
  const request: MusicRequest = async <T>(message: Record<string, unknown>) => {
    const kind = String(message.kind);
    order.push(kind);
    if (kind === switchOn) switchToSingleThreadRuntime(false);
    if (kind === 'rhythm' || kind === 'tonal') return { version: 2, durationSeconds: duration, analyzedSeconds: duration, instruments: [], notes: [] } as T;
    if (kind === 'instruments') return { scores: { piano: .95 }, musicScore: .9 } as T;
    if (kind === 'jamendo') return { synthesizer: .7 } as T;
    return [{ group: 'source', label: 'piano', score: .6 }] as T;
  };
  const result = await analyzeDecodedMusic(decoder, request, { mode: 'fast' });
  return { result, order, current: recognitionConfiguration('fast', duration) };
}

it('stamps the single-thread runtime when every model output came after the fallback', async () => {
  const { result, current } = await runWithFallback('instruments');
  expect(result.recognition?.status).toBe('complete');
  expect(result.recognition?.configurationHash).toBe(current);
  expect(result.recognition?.jobs.find(j => j.modelId === 'ast')?.preprocessingVersion).toContain('wasm-threads-1-');
});

it('leaves a run stale when some model outputs came from the threaded runtime before the fallback', async () => {
  const { result, order, current } = await runWithFallback('profile');
  expect(order.indexOf('instruments')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('instruments')).toBeLessThan(order.indexOf('profile'));
  expect(result.recognition?.configurationHash).not.toBe(current);
  expect(result.recognition?.jobs.find(j => j.modelId === 'ast')?.preprocessingVersion).toContain('wasm-threads-4-');
});
