/** A worker reports this when the multi-threaded runtime never finished starting. Some embedded browsers
 * offer shared memory but never bring the runtime's threads up; one thread then loads in about a second. */
export const THREADED_RUNTIME_STALLED = 'The multi-threaded model runtime did not start in this browser.';
const SINGLE_THREAD_KEY = 'dge-music-single-thread-runtime';
let singleThread = false;
try { singleThread = globalThis.localStorage?.getItem(SINGLE_THREAD_KEY) === '1'; } catch { /* Storage is optional. */ }
/** Use one inference thread from now on (and remember it in this browser when storage allows). */
export function switchToSingleThreadRuntime(persist = true): void {
  singleThread = true;
  if (persist) try { globalThis.localStorage?.setItem(SINGLE_THREAD_KEY, '1'); } catch { /* Storage is optional. */ }
}

/** Configured ONNX WASM parallelism. Hosts without shared memory keep working. */
export function musicInferenceThreads(): number {
  if (singleThread) return 1;
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') return 1;
  const concurrency = globalThis.navigator?.hardwareConcurrency;
  return typeof concurrency === 'number' && Number.isFinite(concurrency) && concurrency >= 1
    ? Math.min(4, Math.floor(concurrency)) : 4;
}

/** Thread variants cannot reuse each other's persisted native scores. */
export function musicRuntimeIdentity(family?: string): string {
  if (family === 'jamendo') return 'wasm-threads-1-v1';
  if (family) return `wasm-threads-${musicInferenceThreads()}-v1`;
  return `wasm-threads-${musicInferenceThreads()}-jamendo-1-v2`;
}

/** This describes configuration, not proof that a cache hit executed inference. */
export function musicRuntimeDiagnostics(family?: string) {
  return { backend: 'wasm' as const, configuredInferenceThreads: family === 'jamendo' ? 1 : musicInferenceThreads(), identity: musicRuntimeIdentity(family) };
}
