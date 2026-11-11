/**
 * Test-only boundary for browser tests. It is OFF in every normal, desktop,
 * airgap and Vercel build: it turns on only when a build is made with
 * VITE_E2E_NO_INFERENCE=1, and Vite then folds this constant at build time.
 *
 * When on, nothing that loads or runs a model may start:
 *  - audio model preloading (app-open warmup, drop-time preload, analysis preload),
 *  - audio analysis (the coordinator skips it and counts the skip),
 *  - text embeddings (the pipeline worker answers with E2E_STUB vectors instead of loading bge).
 * File-input parsing, hashing, persistence, graph nodes, WebAudio decoding and
 * playback of the saved original are untouched.
 *
 * Every guarded entry point that is reached anyway records a violation, which the
 * browser tests assert is zero. Counters live on globalThis (window in the page).
 */
export const E2E_NO_INFERENCE = import.meta.env.VITE_E2E_NO_INFERENCE === '1';

export interface E2eCounters {
  /** Analysis runs the coordinator skipped because the boundary is on. */
  skippedAnalysis: number;
  /** Times model preloading was requested and refused. */
  skippedPreload: number;
  /** Inference entry points reached despite the boundary: must stay 0. */
  violations: string[];
}

export function e2eCounters(): E2eCounters {
  const g = globalThis as { __DGE_E2E__?: E2eCounters };
  return (g.__DGE_E2E__ ??= { skippedAnalysis: 0, skippedPreload: 0, violations: [] });
}

/** Call at the top of any function that would run or load a model; throws when the boundary is on. */
export function assertNoInference(entry: string): void {
  if (!E2E_NO_INFERENCE) return;
  e2eCounters().violations.push(entry);
  throw new Error(`E2E boundary: ${entry} must not run (inference is disabled in this build).`);
}

/**
 * Deterministic stand-in for the text embedder, used ONLY when the boundary is on.
 * Hashed bag-of-words folded into `dims` unit-length slots: no model, no network, stable across runs.
 * It exists so graph building can be exercised; its vectors are never meaningful output.
 */
export function e2eStubEmbed(texts: string[], dims: number): Float32Array {
  const out = new Float32Array(texts.length * dims);
  texts.forEach((text, row) => {
    for (const word of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
      let h = 2166136261;
      for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
      out[row * dims + ((h >>> 0) % dims)] += 1;
    }
    let norm = 0;
    for (let d = 0; d < dims; d++) norm += out[row * dims + d] ** 2;
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dims; d++) out[row * dims + d] /= norm;
  });
  return out;
}
