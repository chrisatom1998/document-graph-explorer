/** A track's CLAP sound fingerprint: the mean of its unit-length 10 s window embeddings, stored as
 * signed bytes. Only the direction matters (links compare cosines), so no scale is kept. Model output, not a label. */
export interface SoundEmbedding {
  /** Encoder identity. Fingerprints from different weights are never compared. */
  model: string;
  /** Audible windows averaged into this fingerprint. */
  windows: number;
  /** Base64 of an Int8Array of length SOUND_EMBEDDING_DIMENSIONS. */
  vector: string;
}
export const SOUND_EMBEDDING_DIMENSIONS = 512;

const unit = (values: ArrayLike<number>): Float32Array | undefined => {
  let norm = 0;
  for (let i = 0; i < values.length; i++) norm += values[i] * values[i];
  norm = Math.sqrt(norm);
  if (!norm || !Number.isFinite(norm)) return;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] / norm;
  return out;
};

export function encodeSoundEmbedding(values: ArrayLike<number>, model: string, windows: number): SoundEmbedding | undefined {
  const v = values.length === SOUND_EMBEDDING_DIMENSIONS ? unit(values) : undefined;
  if (!v) return;
  let max = 0;
  for (const x of v) max = Math.max(max, Math.abs(x));
  const bytes = new Uint8Array(v.length);
  for (let i = 0; i < v.length; i++) bytes[i] = Math.round(v[i] / max * 127) & 0xff;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return { model, windows, vector: btoa(binary) };
}

const decoded = new Map<string, Float32Array | null>();
/** Unit-length vector, memoized: link rebuilds run after every analysed track. */
export function decodeSoundEmbedding(embedding: SoundEmbedding): Float32Array | undefined {
  let v = decoded.get(embedding.vector);
  if (v === undefined) {
    try {
      const binary = atob(embedding.vector);
      v = binary.length === SOUND_EMBEDDING_DIMENSIONS ? unit(Int8Array.from(binary, c => (c.charCodeAt(0) << 24) >> 24)) ?? null : null;
    } catch { v = null; }
    if (decoded.size >= 4096) decoded.delete(decoded.keys().next().value!);
    decoded.set(embedding.vector, v);
  }
  return v ?? undefined;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Persisted analysis is untrusted input. */
export function sanitizeSoundEmbedding(raw: unknown): SoundEmbedding | undefined {
  if (!raw || typeof raw !== 'object') return;
  const e = raw as Record<string, unknown>;
  if (typeof e.model !== 'string' || !e.model || e.model.length > 128) return;
  if (typeof e.windows !== 'number' || !Number.isInteger(e.windows) || e.windows < 1 || e.windows > 20000) return;
  if (typeof e.vector !== 'string' || e.vector.length > 1024) return;
  const out = { model: e.model, windows: e.windows, vector: e.vector };
  return decodeSoundEmbedding(out) ? out : undefined;
}

/** Window embeddings arrive in a fixed order; each counts once, at unit length. */
export class SoundEmbeddingAccumulator {
  private sum = new Float64Array(SOUND_EMBEDDING_DIMENSIONS);
  private count = 0;
  add(values: ArrayLike<number> | undefined) {
    const v = values && values.length === SOUND_EMBEDDING_DIMENSIONS ? unit(values) : undefined;
    if (!v) return;
    for (let i = 0; i < v.length; i++) this.sum[i] += v[i];
    this.count++;
  }
  result(model: string): SoundEmbedding | undefined {
    return this.count ? encodeSoundEmbedding(this.sum, model, this.count) : undefined;
  }
}
