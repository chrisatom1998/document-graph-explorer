import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage({ id }: { id: number }) { setTimeout(() => this.onmessage?.({ data: { id, features: new Array(768).fill(id) } }), 5); }
  terminate() {}
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('PaSST features', () => {
  it('answers overlapping requests in turn instead of dropping the first', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { passtFeatures, passtExpected } = await import('./passtFeatures');
    const [a, b] = await Promise.all([passtFeatures(new Float32Array(32000)), passtFeatures(new Float32Array(32000))]);
    expect(a?.length).toBe(768); expect(b?.length).toBe(768);
    expect(a![0]).not.toBe(b![0]);
    expect(passtExpected()).toBe(true);
  });
  it('retries on one thread when a multi-threaded WASM start stalls', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('crossOriginIsolated', true);
    vi.stubGlobal('SharedArrayBuffer', class {});
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    const threads: number[] = [];
    class StallingWorker extends FakeWorker {
      override postMessage(message: { id: number; threads: number }) {
        threads.push(message.threads);
        setTimeout(() => this.onmessage?.({ data: { phase: 'creating', backend: 'wasm', threads: message.threads } }), 1);
        if (message.threads === 1) super.postMessage(message);   // a threaded start never answers
      }
    }
    vi.stubGlobal('Worker', StallingWorker);
    const { passtFeatures } = await import('./passtFeatures');
    const pending = passtFeatures(new Float32Array(32000));
    await vi.advanceTimersByTimeAsync(25_000);
    expect((await pending)?.length).toBe(768);
    expect(threads).toEqual([4, 1]);
    expect(store.get('dge-music-single-thread-runtime')).toBe('1');
    vi.useRealTimers();
  });
  it('names whether PaSST was used in a short clip\'s configuration, so a CLAP-only result is redone', async () => {
    const { recognitionConfiguration } = await import('./recognition');
    expect(recognitionConfiguration('full', 1, true)).toContain('-passt-');
    expect(recognitionConfiguration('full', 1, false)).not.toContain('-passt-');
    expect(recognitionConfiguration('full', 60, true)).toBe(recognitionConfiguration('full', 60, false));
    const { createRecognition, refreshRuntimeIdentity } = await import('./recognition');
    const run = createRecognition(1, 'full'); refreshRuntimeIdentity(run, 1, false);
    expect(run.configurationHash).toBe(recognitionConfiguration('full', 1, false));
  });
});
