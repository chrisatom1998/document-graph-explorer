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
  it('names whether PaSST was used in a short clip\'s configuration, so a CLAP-only result is redone', async () => {
    const { recognitionConfiguration } = await import('./recognition');
    expect(recognitionConfiguration('full', 1, true)).toContain('-passt-');
    expect(recognitionConfiguration('full', 1, false)).not.toContain('-passt-');
    expect(recognitionConfiguration('full', 60, true)).toBe(recognitionConfiguration('full', 60, false));
  });
});
