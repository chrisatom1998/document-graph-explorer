import { afterEach, expect, it, vi } from 'vitest';
import { createRecognition, recognitionConfiguration, refreshRuntimeIdentity } from './recognition';
import { switchToSingleThreadRuntime } from './musicRuntime';

afterEach(() => vi.unstubAllGlobals());

it('stamps a run that fell back to one thread with the single-thread runtime', () => {
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('SharedArrayBuffer', class {});
  vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
  const recognition = createRecognition(30, 'full');
  const threaded = recognition.jobs.find(j => j.modelId === 'ast')!.preprocessingVersion;
  expect(threaded).toContain('wasm-threads-4-');
  switchToSingleThreadRuntime(false);
  expect(recognition.configurationHash).not.toBe(recognitionConfiguration('full', 30));
  refreshRuntimeIdentity(recognition, 30);
  expect(recognition.configurationHash).toBe(recognitionConfiguration('full', 30));
  expect(recognition.jobs.find(j => j.modelId === 'ast')!.preprocessingVersion).toContain('wasm-threads-1-');
  expect(recognition.jobs.find(j => j.modelId === 'clap')!.preprocessingVersion).toContain('wasm-threads-1-');
});
