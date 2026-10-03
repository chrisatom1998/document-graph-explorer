import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MusicAnalysis } from './musicTypes';
import { analyzeMusic } from './analyzeMusic';

const state = vi.hoisted(() => ({
  decoders: 0, maxDecoders: 0, models: 0, maxModels: 0,
  events: [] as string[], opened: [] as string[], cache: undefined as MusicAnalysis | undefined,
  failFirst: false,
}));
vi.mock('./musicAnalysisCache', () => ({
  musicCacheKey: vi.fn(async () => 'key'),
  musicCacheFingerprint: () => 'same-model',
  readMusicCache: vi.fn(async () => state.cache),
  writeMusicCache: vi.fn(async () => {}),
}));
vi.mock('./decodeMusic', () => ({
  openMusicDecoder: vi.fn(async (_blob, name) => {
    state.opened.push(name);
    state.decoders++;
    state.maxDecoders = Math.max(state.maxDecoders, state.decoders);
    return { durationSeconds: 3,
      read: async (_start: number, seconds: number, rate: number) => new Float32Array(Math.min(3, seconds) * rate).fill(.1),
      close: () => { state.decoders--; },
    };
  }),
  decodeMusicExcerpts: async () => ({ durationSeconds: 3, samples: [new Float32Array(132300).fill(.1)] }),
  instrumentWindows: async function* () { yield { start: 0, end: 3, samples: new Float32Array(48000).fill(.1) }; },
}));

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminate() {}
  postMessage(message: { id: number; kind: string }) {
    state.models++;
    state.maxModels = Math.max(state.maxModels, state.models);
    state.events.push(message.kind);
    setTimeout(() => {
      state.models--;
      if (state.failFirst) {
        state.failFirst = false;
        this.onmessage?.({ data: { id: message.id, error: 'Model unavailable' } });
        return;
      }
      const result = message.kind === 'jamendo' ? { piano: .7 }
        : message.kind === 'rhythm' ? { version: 2, durationSeconds: 3, analyzedSeconds: 2, instruments: [], notes: [] }
        : message.kind === 'instruments' ? { scores: { piano: .95 }, musicScore: .9 }
        : [{ group: 'source', label: 'piano', score: .6 }];
      this.onmessage?.({ data: { id: message.id, result } });
    }, 0);
  }
}
beforeEach(() => {
  Object.assign(state, { decoders: 0, maxDecoders: 0, models: 0, maxModels: 0, events: [], opened: [], cache: undefined, failFirst: false });
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

it.each(['fast', 'full'] as const)('previews a folder before deeper %s checks without duplicating model inference', async mode => {
  const previews: string[] = [];
  const results = await Promise.all(['a.wav', 'b.wav', 'c.wav'].map(name =>
    analyzeMusic(new Blob([name,mode]), name, { mode, onPreview: result => {
      if (!previews.includes(name)) { previews.push(name); expect(result.stage).toBe('preview'); }
    } })));
  expect(previews.sort()).toEqual(['a.wav', 'b.wav', 'c.wav']);
  expect(state.events.slice(0, 3)).toEqual(['jamendo', 'jamendo', 'jamendo']);
  expect(state.events.filter(kind => kind === 'jamendo')).toHaveLength(3);
  expect(state.maxDecoders).toBe(2);
  expect(state.maxModels).toBe(1);
  expect(state.decoders).toBe(0);
  expect(results.every(result => result.stage === undefined && result.instrumentScan?.complete)).toBe(true);
});

it('reuses a finished analysis without opening audio decoders', async () => {
  state.cache = { version: 2, durationSeconds: 3, analyzedSeconds: 2, instruments: [], notes: [],
    instrumentScan: { complete: true, analyzedSeconds: 2, windows: 1 } };
  expect(await analyzeMusic(new Blob(['audio']), 'cached.wav')).toBe(state.cache);
  expect(state.opened).toEqual([]);
});

it('cancels a queued upload before its decoder is opened', async () => {
  const controller = new AbortController();
  const active = ['a.wav', 'b.wav'].map(name => analyzeMusic(new Blob(['audio']), name));
  const cancelled = analyzeMusic(new Blob(['audio']), 'cancelled.wav', { signal: controller.signal });
  const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  await Promise.all(active);
  expect(state.opened).not.toContain('cancelled.wav');
  expect(state.decoders).toBe(0);
});

it('retries a failed preview in the deeper pass and completes other songs', async () => {
  state.failFirst = true;
  const results = await Promise.all(['a.wav', 'b.wav'].map(name => analyzeMusic(new Blob(['audio']), name, { mode: 'fast' })));
  expect(results.every(result => result.instrumentScan?.complete)).toBe(true);
  expect(state.maxModels).toBe(1);
  expect(state.decoders).toBe(0);
});
