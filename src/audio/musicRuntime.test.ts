import { afterEach, expect, it, vi } from 'vitest';
import { musicInferenceThreads, musicRuntimeDiagnostics, musicRuntimeIdentity } from './musicRuntime';

afterEach(() => vi.unstubAllGlobals());

it('uses up to four inference threads on an isolated shared-memory host', () => {
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('SharedArrayBuffer', class {});
  for (const [hardwareConcurrency, expected] of [[18,4],[4,4],[2,2],[1,1]]) {
    vi.stubGlobal('navigator', {hardwareConcurrency});
    expect(musicInferenceThreads()).toBe(expected);
    expect(musicRuntimeIdentity()).toBe(`wasm-threads-${expected}-jamendo-1-v2`);
    expect(musicRuntimeDiagnostics()).toEqual({backend:'wasm',configuredInferenceThreads:expected,identity:`wasm-threads-${expected}-jamendo-1-v2`});
  }
});

it('keeps the one-thread fallback without isolation or shared memory', () => {
  vi.stubGlobal('crossOriginIsolated', false);
  expect(musicInferenceThreads()).toBe(1);
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('SharedArrayBuffer', undefined);
  expect(musicInferenceThreads()).toBe(1);
});

it('bounds invalid or unavailable concurrency reports', () => {
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('SharedArrayBuffer', class {});
  for (const hardwareConcurrency of [undefined, NaN, Infinity, 0, -1]) {
    vi.stubGlobal('navigator', {hardwareConcurrency});
    expect(musicInferenceThreads()).toBe(4);
  }
  vi.stubGlobal('navigator', undefined);
  expect(musicInferenceThreads()).toBe(4);
});

it('binds Jamendo to its frozen single-thread runtime independently of AST/CLAP', () => {
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('SharedArrayBuffer', class {});
  vi.stubGlobal('navigator', {hardwareConcurrency: 18});
  expect(musicRuntimeDiagnostics('jamendo')).toEqual({backend:'wasm',configuredInferenceThreads:1,identity:'wasm-threads-1-v1'});
  expect(musicRuntimeIdentity('ast')).toBe('wasm-threads-4-v1');
  expect(musicRuntimeIdentity('clap')).toBe('wasm-threads-4-v1');
});
