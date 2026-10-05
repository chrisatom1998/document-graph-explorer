import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MusicAnalysis } from './musicTypes';
import { loadBuiltInFusion } from './fusionRelease';
import { analyzeMusic } from './analyzeMusic';

const state = vi.hoisted(() => ({
  duration: 3, decoders: 0, maxDecoders: 0, models: 0, maxModels: 0,
  events: [] as string[], opened: [] as string[], cache: undefined as MusicAnalysis | undefined,
  failFirst: false, failOpen: false, created: 0, terminated: 0, fingerprint: 'same-model' as string | undefined, abortNext: undefined as AbortController | undefined,
}));
vi.mock('./fusionRelease', async importOriginal => ({ ...(await importOriginal<typeof import('./fusionRelease')>()), loadBuiltInFusion: vi.fn(async () => undefined) }));
vi.mock('./musicAnalysisCache', () => ({
  musicCacheKey: vi.fn(async () => 'key'),
  musicCacheFingerprint: () => state.fingerprint,
  musicWorkerFingerprint: () => state.fingerprint,
  readMusicCache: vi.fn(async () => state.cache),
  writeMusicCache: vi.fn(async () => {}),
}));
vi.mock('./decodeMusic', () => ({
  openMusicDecoder: vi.fn(async (_blob, name) => {
    state.opened.push(name);
    if (state.failOpen) throw new Error('Decoder cannot initialize');
    state.decoders++;
    state.maxDecoders = Math.max(state.maxDecoders, state.decoders);
    return { durationSeconds: state.duration,
      read: async (_start: number, seconds: number, rate: number) => new Float32Array(Math.min(state.duration, seconds) * rate).fill(.1),
      close: () => { state.decoders--; },
    };
  }),
  decodeMusicExcerpts: async () => ({ durationSeconds: 3, samples: [new Float32Array(132300).fill(.1)] }),
  instrumentWindows: async function* () { yield { start: 0, end: 3, samples: new Float32Array(48000).fill(.1) }; },
}));

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  constructor() { state.created++; }
  terminate() { state.terminated++; }
  postMessage(message: { id: number; kind: string }) {
    state.models++;
    state.maxModels = Math.max(state.maxModels, state.models);
    state.events.push(message.kind);
    if (state.abortNext) { const controller = state.abortNext; state.abortNext = undefined; queueMicrotask(() => controller.abort()); }
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
  vi.mocked(loadBuiltInFusion).mockReset().mockResolvedValue(undefined);
  Object.assign(state, { duration:3, decoders: 0, maxDecoders: 0, models: 0, maxModels: 0, events: [], opened: [], cache: undefined, failFirst: false, failOpen: false });
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('navigator', { deviceMemory: 16 });
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


it('retains one worker per family on a reported 16 GiB device and serializes unseen songs', async () => {
  vi.resetModules();
  const isolated = await import('./analyzeMusic');
  const created = state.created;
  await isolated.analyzeMusic(new Blob(['warm-one']), 'one.wav', { mode: 'full', force: true });
  expect(state.created - created).toBe(4);
  await isolated.analyzeMusic(new Blob(['warm-two']), 'two.wav', { mode: 'full', force: true });
  expect(state.created - created).toBe(4);
  expect(state.maxModels).toBe(1);
});

it('discards every retained family when pinned model fingerprints change', async () => {
  vi.resetModules();
  const isolated = await import('./analyzeMusic');
  await isolated.analyzeMusic(new Blob(['before-update']), 'one.wav', { mode: 'full', force: true });
  const created = state.created, terminated = state.terminated;
  state.fingerprint = 'updated-model';
  await isolated.analyzeMusic(new Blob(['after-update']), 'two.wav', { mode: 'full', force: true });
  expect(state.created - created).toBe(4);
  expect(state.terminated - terminated).toBe(4);
  state.fingerprint = 'same-model';
});

it('releases retained workers after five idle minutes', async () => {
  vi.resetModules(); vi.useFakeTimers();
  try {
    const isolated = await import('./analyzeMusic');
    const running = isolated.analyzeMusic(new Blob(['idle-cleanup']), 'idle.wav', { mode: 'full', force: true });
    // Crypto runs outside fake timers; let queued IO and worker messages settle.
    await vi.waitFor(async () => { await vi.advanceTimersByTimeAsync(10); expect(state.events).toContain('profile'); });
    await running;
    const terminated = state.terminated;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(state.terminated - terminated).toBe(4);
  } finally { vi.useRealTimers(); }
});


it('does not reuse family sessions when manifest fingerprints are unavailable', async () => {
  vi.resetModules();
  const isolated = await import('./analyzeMusic');
  await isolated.analyzeMusic(new Blob(['known-pins']), 'one.wav', { mode: 'full', force: true });
  const terminated = state.terminated;
  state.fingerprint = undefined;
  try {
    await isolated.analyzeMusic(new Blob(['missing-pins']), 'two.wav', { mode: 'full', force: true });
    expect(state.terminated - terminated).toBe(8); // Four known sessions plus each preceding unverified request.
  } finally { state.fingerprint = 'same-model'; }
});

it('restarts a failed family while preserving unrelated warm sessions', async () => {
  vi.resetModules();
  const isolated = await import('./analyzeMusic');
  await isolated.analyzeMusic(new Blob(['healthy-pool']), 'one.wav', { mode: 'full', force: true });
  const created = state.created, terminated = state.terminated;
  state.failFirst = true;
  const result = await isolated.analyzeMusic(new Blob(['retry-one-family']), 'two.wav', { mode: 'full', force: true });
  expect(result.instrumentScan?.complete).toBe(true);
  expect(state.created - created).toBe(1);
  expect(state.terminated - terminated).toBe(1);
});


it.each([2, 4, undefined])('preserves single-session memory bounds when available device memory is %s', async deviceMemory => {
  vi.stubGlobal('navigator', { deviceMemory });
  vi.resetModules();
  const isolated = await import('./analyzeMusic');
  const created = state.created;
  await isolated.analyzeMusic(new Blob(['low-memory-one']), 'one.wav', { mode: 'full', force: true });
  await isolated.analyzeMusic(new Blob(['low-memory-two']), 'two.wav', { mode: 'full', force: true });
  expect(state.created - created).toBe(8);
});


it('discards an aborted in-flight family without invalidating other retained sessions', async () => {
  vi.resetModules();
  const isolated = await import('./analyzeMusic');
  await isolated.analyzeMusic(new Blob(['before-abort']), 'one.wav', { mode: 'full', force: true });
  const created = state.created, terminated = state.terminated;
  const controller = new AbortController();
  state.abortNext = controller;
  await expect(isolated.analyzeMusic(new Blob(['abort-family']), 'two.wav', { mode: 'full', force: true, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(state.terminated - terminated).toBe(1);
  await vi.waitFor(() => expect(state.models).toBe(0));
  await isolated.analyzeMusic(new Blob(['after-abort']), 'three.wav', { mode: 'full', force: true });
  expect(state.created - created).toBe(1);
  expect(state.maxModels).toBe(1);
});


it.each(['blob-read', 'decoder-open'])('releases every warm family after a %s failure before preview setup', async failure => {
  vi.resetModules(); vi.useFakeTimers();
  try {
    const isolated = await import('./analyzeMusic');
    const warm = isolated.analyzeMusic(new Blob(['warm-before-setup-error']), 'one.wav', { mode: 'full', force: true });
    await vi.waitFor(async () => { await vi.advanceTimersByTimeAsync(10); expect(state.events).toContain('profile'); });
    await warm;
    const blob = new Blob(['failing-setup']);
    if (failure === 'blob-read') vi.spyOn(blob, 'arrayBuffer').mockRejectedValue(new Error('Audio cannot be read'));
    else state.failOpen = true;
    await expect(isolated.analyzeMusic(blob, 'two.wav', { mode: 'full', force: true })).rejects.toThrow();
    const terminated = state.terminated;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(state.terminated - terminated).toBe(4);
  } finally { state.failOpen = false; vi.useRealTimers(); }
});

it('bypasses whole-analysis cache reads and writes for an optional fusion scorer', async () => {
  const { readMusicCache, writeMusicCache } = await import('./musicAnalysisCache');
  vi.mocked(readMusicCache).mockClear(); vi.mocked(writeMusicCache).mockClear();
  state.cache = { version: 2, durationSeconds: 3, analyzedSeconds: 2, instruments: [], notes: [] };
  const score = vi.fn(async () => []);
  const result = await analyzeMusic(new Blob(['fusion-isolated']), 'fusion.wav', {
    fusion: { identity: { modelSha256: 'a'.repeat(64), policySha256: 'b'.repeat(64), scorerSha256: 'c'.repeat(64) }, score },
  });
  expect(readMusicCache).not.toHaveBeenCalled(); expect(writeMusicCache).not.toHaveBeenCalled();
  expect(state.opened.length).toBe(2); expect(score).toHaveBeenCalledOnce();
  expect(result.fusion?.counts.failed).toBe(1); // Invalid synthetic scorer does not fake a successful decision.
});

it('does not load the trained head outside the qualified input tier', async () => {
 // Fast analysis samples a few sections, so its windows are not the scored tier.
 state.duration=10;
 await analyzeMusic(new Blob(['fast'],{type:'audio/ogg'}), 'fast.ogg', {mode:'fast'});
 expect(loadBuiltInFusion).not.toHaveBeenCalled();
 // Below policy.inputSupport.minimumSeconds nothing is scored either.
 state.duration=1;
 await analyzeMusic(new Blob(['tiny'],{type:'audio/wav'}), 'tiny.wav', {mode:'full'});
 expect(loadBuiltInFusion).not.toHaveBeenCalled();
});
it('loads the trained head for ordinary uploads of any container and length', async () => {
 for (const [duration, type, name] of [[9,'audio/wav','loop.wav'],[183,'audio/mpeg','song.mp3'],[10,'audio/ogg','clip.ogg']] as const) {
  vi.mocked(loadBuiltInFusion).mockClear(); state.duration=duration;
  await analyzeMusic(new Blob(['widened'],{type}), name, {mode:'full'});
  expect(loadBuiltInFusion).toHaveBeenCalledOnce();
 }
});
it('retains native analysis when a qualified artifact fails to load', async () => {
 state.duration=10; vi.mocked(loadBuiltInFusion).mockRejectedValue(new Error('Corrupt artifact'));
 const result=await analyzeMusic(new Blob(['corrupt-artifact-test'],{type:'audio/ogg'}), 'test.ogg', {mode:'full'});
 expect(loadBuiltInFusion).toHaveBeenCalledOnce();
 expect(result.recognition?.jobs).toHaveLength(5); expect(result.instrumentScan?.complete).toBe(true);
 expect(result.classifierConfiguration).toBeUndefined(); expect(result.notes).toContain('The trained source classifier is unavailable; native analysis is retained.');
});


it.each([{deviceMemory:8,hardwareConcurrency:8},{hardwareConcurrency:18}])('retains warm bounded families and runs them side by side on the faster host profile %j',async navigatorProfile=>{
 vi.stubGlobal('navigator',navigatorProfile);vi.resetModules();const isolated=await import('./analyzeMusic');const created=state.created;
 await isolated.analyzeMusic(new Blob(['warm-local-one']),'one.wav',{mode:'full',force:true});
 expect(state.created-created).toBe(4);
 await isolated.analyzeMusic(new Blob(['warm-local-two']),'two.wav',{mode:'full',force:true});expect(state.created-created).toBe(4);
 // One request per family worker at most: families overlap, a family never overlaps itself.
 expect(state.maxModels).toBeGreaterThan(1);expect(state.maxModels).toBeLessThanOrEqual(4);
});

it('retries a model request once on a fresh single-thread worker when the threaded runtime never starts', async () => {
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('SharedArrayBuffer', class {});
  vi.stubGlobal('navigator', { deviceMemory: 16, hardwareConcurrency: 18 });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  const { THREADED_RUNTIME_STALLED } = await import('./musicRuntime');
  const sent: { kind: string; singleThread?: boolean }[] = [];
  class StallingWorker extends FakeWorker {
    override postMessage(message: { id: number; kind: string; singleThread?: boolean; samples?: Float32Array }) {
      sent.push({ kind: message.kind, singleThread: message.singleThread });
      if ((message.kind === 'instruments' || message.kind === 'profile') && !message.singleThread) {
        setTimeout(() => this.onmessage?.({ data: { id: message.id, error: THREADED_RUNTIME_STALLED } }), 0);
        return;
      }
      expect(message.samples === undefined || message.samples.length > 0).toBe(true);
      super.postMessage(message);
    }
  }
  vi.stubGlobal('Worker', StallingWorker);
  vi.resetModules();
  const isolated = await import('./analyzeMusic');
  const terminated = state.terminated;
  const result = await isolated.analyzeMusic(new Blob(['stall']), 'stall.wav', { mode: 'full' });
  expect(result.instrumentScan?.complete).toBe(true);
  expect(sent.filter(m => m.kind === 'instruments').map(m => !!m.singleThread)).toEqual([false, true]);
  // Families run side by side, so CLAP may stall once too; it is retried the same way and later requests go single-thread.
  const profile = sent.filter(m => m.kind === 'profile').map(m => !!m.singleThread);
  expect(profile.at(-1)).toBe(true);
  expect(profile.filter(v => !v).length).toBeLessThanOrEqual(1);
  expect(state.terminated).toBeGreaterThan(terminated);
});

it('saves a result recovered on one thread under the single-thread cache key', async () => {
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('SharedArrayBuffer', class {});
  vi.stubGlobal('navigator', { deviceMemory: 16, hardwareConcurrency: 18 });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  const { THREADED_RUNTIME_STALLED } = await import('./musicRuntime');
  class StallingWorker extends FakeWorker {
    override postMessage(message: { id: number; kind: string; singleThread?: boolean }) {
      if (message.kind === 'instruments' && !message.singleThread) {
        setTimeout(() => this.onmessage?.({ data: { id: message.id, error: THREADED_RUNTIME_STALLED } }), 0);
        return;
      }
      super.postMessage(message);
    }
  }
  vi.stubGlobal('Worker', StallingWorker);
  vi.resetModules();
  const runtime = await import('./musicRuntime');
  const cacheModule = await import('./musicAnalysisCache');
  vi.mocked(cacheModule.writeMusicCache).mockClear();
  vi.mocked(cacheModule.musicCacheKey).mockImplementation(async () => `key:${runtime.musicRuntimeIdentity()}`);
  const isolated = await import('./analyzeMusic');
  await isolated.analyzeMusic(new Blob(['stall-key']), 'stall-key.wav', { mode: 'full' });
  expect(vi.mocked(cacheModule.writeMusicCache).mock.calls.map(([key]) => key)).toEqual([`key:${runtime.musicRuntimeIdentity()}`]);
  expect(runtime.musicRuntimeIdentity()).toContain('wasm-threads-1-');
  vi.mocked(cacheModule.musicCacheKey).mockImplementation(async () => 'key');
});

it('retires sibling model workers on the switch and retries their in-flight requests single-thread', async () => {
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('SharedArrayBuffer', class {});
  vi.stubGlobal('navigator', { deviceMemory: 16, hardwareConcurrency: 18 });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  const { THREADED_RUNTIME_STALLED } = await import('./musicRuntime');
  const sent: { kind: string; singleThread?: boolean }[] = [];
  class SiblingWorker extends FakeWorker {
    override postMessage(message: { id: number; kind: string; singleThread?: boolean }) {
      sent.push({ kind: message.kind, singleThread: message.singleThread });
      if (!message.singleThread && message.kind === 'profile') return;   // a sibling on a multi-threaded session, still working
      if (!message.singleThread && message.kind === 'instruments') {
        setTimeout(() => this.onmessage?.({ data: { id: message.id, error: THREADED_RUNTIME_STALLED } }), 5);
        return;
      }
      super.postMessage(message);
    }
  }
  vi.stubGlobal('Worker', SiblingWorker);
  vi.resetModules();
  const isolated = await import('./analyzeMusic');
  const result = await isolated.analyzeMusic(new Blob(['sibling']), 'sibling.wav', { mode: 'full', concurrentModels: true } as never);
  expect(result.instrumentScan?.complete).toBe(true);
  const profile = sent.filter(m => m.kind === 'profile').map(m => !!m.singleThread);
  expect(profile[0]).toBe(false);
  expect(profile.at(-1)).toBe(true);
});

it('retries an in-flight analysis request when a concurrent warmup hits the threaded stall', async () => {
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('SharedArrayBuffer', class {});
  vi.stubGlobal('navigator', { deviceMemory: 16, hardwareConcurrency: 18 });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  const { THREADED_RUNTIME_STALLED } = await import('./musicRuntime');
  const sent: { kind: string; singleThread?: boolean }[] = [];
  const pendingWarms: WarmStallWorker[] = [];
  class WarmStallWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { message: string }) => void) | null = null;
    private listeners = new Set<(event: { data: unknown }) => void>();
    private terminated = false;
    warmId?: number;
    constructor() { state.created++; }
    terminate() { this.terminated = true; state.terminated++; }
    addEventListener(type: string, listener: (event: { data: unknown }) => void) {
      if (type === 'message') this.listeners.add(listener);
    }
    removeEventListener(_type: string, listener: (event: { data: unknown }) => void) {
      this.listeners.delete(listener);
    }
    deliver(data: unknown) {
      if (this.terminated) return;
      const event = { data };
      for (const listener of [...this.listeners]) listener(event);
      this.onmessage?.(event);
    }
    stallWarm() {
      if (this.warmId === undefined) return;
      this.deliver({ id: this.warmId, error: THREADED_RUNTIME_STALLED });
      this.warmId = undefined;
    }
    postMessage(message: { id: number; kind: string; family?: string; singleThread?: boolean; samples?: Float32Array }) {
      sent.push({ kind: message.kind, singleThread: message.singleThread });
      if (this.terminated) return;
      if (message.kind === 'warm') {
        if (!message.singleThread && (message.family === 'instruments' || message.family === 'profile')) {
          this.warmId = message.id;
          pendingWarms.push(this);
          return;
        }
        queueMicrotask(() => this.deliver({ id: message.id, warmed: true }));
        return;
      }
      if ((message.kind === 'instruments' || message.kind === 'profile') && !message.singleThread) {
        // Stall every overlapping warmup now so discard hits this in-flight analysis request.
        for (const worker of pendingWarms.splice(0)) worker.stallWarm();
        if (this.warmId !== undefined) this.stallWarm();
        return;
      }
      queueMicrotask(() => {
        if (this.terminated) return;
        const result = message.kind === 'jamendo' ? { piano: .7 }
          : message.kind === 'rhythm' ? { version: 2, durationSeconds: 3, analyzedSeconds: 2, instruments: [], notes: [] }
          : message.kind === 'instruments' ? { scores: { piano: .95 }, musicScore: .9 }
          : [{ group: 'source', label: 'piano', score: .6 }];
        this.deliver({ id: message.id, result });
      });
    }
  }
  vi.stubGlobal('Worker', WarmStallWorker);
  vi.resetModules();
  const isolated = await import('./analyzeMusic');
  void isolated.preloadMusicModels('full');
  await vi.waitFor(() => expect(pendingWarms.length).toBeGreaterThan(0));
  const result = await isolated.analyzeMusic(new Blob(['warm-stall']), 'stall.wav', { mode: 'full' });
  expect(result.instrumentScan?.complete).toBe(true);
  expect(result.notes).not.toContain('Instrument recognition was unavailable. Reanalyze to retry.');
  expect(result.notes).not.toContain('Sound character recognition was unavailable. Reanalyze to retry.');
  expect(sent.filter(m => m.kind === 'instruments').map(m => !!m.singleThread)).toEqual([false, true]);
  expect(sent.filter(m => m.kind === 'profile').some(m => m.singleThread)).toBe(true);
});
