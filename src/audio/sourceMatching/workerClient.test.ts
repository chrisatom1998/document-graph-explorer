import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fingerprintInWorker, matchInWorker } from './workerClient';
class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { TestWorker.instances.push(this); }
}
const audio = { sampleRate: 8192, channels: [new Float32Array(8192)] };
beforeEach(() => { TestWorker.instances = []; vi.stubGlobal('Worker', TestWorker); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('uses a dedicated worker and terminates after successful reply', async () => {
  const pending = fingerprintInWorker(audio); const worker = TestWorker.instances[0];
  expect(worker.postMessage).toHaveBeenCalledWith({ kind: 'fingerprint', audio });
  worker.onmessage?.({ data: { ok: true, value: 'test-value' } } as MessageEvent);
  expect(await pending).toBe('test-value'); expect(worker.terminate).toHaveBeenCalledOnce();
});
it('aborts active computation and does not start a pre-aborted job', async () => {
  const controller = new AbortController(); const pending = fingerprintInWorker(audio, controller.signal);
  controller.abort(); await expect(pending).rejects.toHaveProperty('name', 'AbortError');
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
  expect(() => fingerprintInWorker(audio, controller.signal)).toThrow();
  expect(TestWorker.instances).toHaveLength(1);
});
it('bounds runaway work with timeout and surfaces worker failures', async () => {
  vi.useFakeTimers(); const pending = matchInWorker(audio, [], 'a'.repeat(64)); const assertion = expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(60_000); await assertion; expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
  const second = fingerprintInWorker(audio); TestWorker.instances[1].onerror?.(); await expect(second).rejects.toThrow('could not run');
});
