/** Configured ONNX WASM parallelism. Hosts without shared memory keep working. */
export function musicInferenceThreads(): number {
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
