import type Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import type { MusicAnalysis } from './musicTypes';

type Key = NonNullable<MusicAnalysis['key']>;
export type KeyCnnEngine = Pick<Essentia, 'arrayToVector' | 'vectorToArray' | 'Spectrum'>;

/* Input of the learned key network (an all-convolutional key classifier after Korzeniowski & Widmer 2018, trained
 * on GiantSteps MTG key tracks and GTZAN; /mnt/project-files/models/key-cnn-2026-10-06). It was trained on 22.05 kHz
 * audio: Hann 8192, hop 4410 (5 frames per second), 144 quarter-tone triangular bins from MIDI 36 to 107.5,
 * log1p(1000 * magnitude / sqrt(8192)), bins 12-131 fed to the network. At 44.1 kHz a 16384-sample frame with an
 * 8820 hop covers the same time with the same frequency spacing, and its magnitudes are twice as large. */
const FRAME = 16384;
const HOP = 8820;
const BINS = 120;
const FIRST = 12;
const SCALE = 1 / (2 * Math.sqrt(8192));

const hann = Float32Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FRAME));

/** Triangular filters on quarter-tone centres (feats.py tri_bank), restricted to the 120 bins the network reads. */
export const keyFilterbank: { start: number; weights: Float32Array }[] = (() => {
  const centre = (j: number) => 440 * 2 ** ((36 + j / 2 - 69) / 12);   // j = -1 .. 144
  const binHz = 44100 / FRAME;
  return Array.from({ length: BINS }, (_, b) => {
    const i = b + FIRST + 1;   // centres index of this band: tri_bank's band i-1 uses centres i-1, i, i+1
    const [lo, c, hi] = [centre(i - 2), centre(i - 1), centre(i)];
    const start = Math.ceil(lo / binHz);
    const end = Math.floor(hi / binHz);
    const weights = Float32Array.from({ length: Math.max(0, end - start + 1) }, (_, k) => {
      const f = (start + k) * binHz;
      return Math.max(0, Math.min((f - lo) / (c - lo), (hi - f) / (hi - c)));
    });
    if (!weights.some(w => w > 0)) return { start: Math.round(c / binHz), weights: Float32Array.of(1) };
    return { start, weights };
  });
})();

/** The network's input for a mono 44.1 kHz excerpt: frames x 120, row-major. */
export function keySpectrogram(engine: KeyCnnEngine, samples: Float32Array): { data: Float32Array; frames: number } {
  const padded = samples.length >= FRAME ? samples : Float32Array.from({ length: FRAME }, (_, i) => samples[i] ?? 0);
  const frames = Math.floor((padded.length - FRAME) / HOP) + 1;
  const data = new Float32Array(frames * BINS);
  const windowed = new Float32Array(FRAME);
  for (let t = 0; t < frames; t++) {
    for (let i = 0; i < FRAME; i++) windowed[i] = padded[t * HOP + i] * hann[i];
    const vector = engine.arrayToVector(windowed);
    const spectrum = engine.Spectrum(vector, FRAME).spectrum;
    const magnitude = engine.vectorToArray(spectrum);
    vector.delete(); spectrum.delete();
    for (let b = 0; b < BINS; b++) {
      const { start, weights } = keyFilterbank[b];
      let sum = 0;
      for (let k = 0; k < weights.length; k++) sum += weights[k] * magnitude[start + k];
      data[t * BINS + b] = Math.log1p(1000 * sum * SCALE);
    }
  }
  return { data, frames };
}

/** Softmax over the network's 24 outputs: index = tonic (C = 0) + 12 for minor. */
export function keySoftmax(logits: ArrayLike<number>): number[] {
  const top = Math.max(...Array.from(logits));
  const e = Array.from(logits, v => Math.exp(v - top));
  const total = e.reduce((a, v) => a + v, 0);
  return e.map(v => v / total);
}

/** Weight of Essentia's stock key profile against the network (scripts/key/blend.py). */
export const PROFILE_WEIGHT = 0;

/** A recording's key from the mean probabilities of its tonal excerpts, which must be at least half of all
 * excerpts (the same rule as before). Each excerpt's Essentia key (stock profile), when given, adds
 * PROFILE_WEIGHT x its strength to that key's log probability, averaged over excerpts: the stock profile reads
 * clean loops better than the network, which reads songs better. Strength maps the network's probability p of the
 * chosen key to 0.6 + 0.4 p, so 0.6 still marks the weakest key the app shows. */
export function recordingKeyFromProbabilities(probabilities: number[][], excerptCount: number, profileKeys: (Key | undefined)[] = [], weight = PROFILE_WEIGHT): Key | undefined {
  if (!probabilities.length || probabilities.length < Math.ceil(excerptCount / 2)) return;
  const mean = Array.from({ length: 24 }, (_, i) => probabilities.reduce((a, p) => a + p[i], 0) / probabilities.length);
  if (mean.some(v => !Number.isFinite(v))) return;
  const score = mean.map(v => Math.log(Math.max(v, 1e-9)));
  for (const key of profileKeys) if (key) score[key.tonic + (key.mode === 'minor' ? 12 : 0)] += weight * Math.min(1, key.strength) / probabilities.length;
  const best = score.indexOf(Math.max(...score));
  return { tonic: best % 12, mode: best < 12 ? 'major' : 'minor', strength: Math.min(1, 0.6 + 0.4 * mean[best]) };
}

type Ort = typeof import('onnxruntime-web');
type Session = Awaited<ReturnType<Ort['InferenceSession']['create']>>;
let session: Promise<{ ort: Ort; session: Session }> | undefined;

/** Opens the key network once; a failed load is retried on the next call. `source` overrides the model location
 * (tests and the offline harness). */
export function loadKeyCnn(source?: string | Uint8Array): Promise<{ ort: Ort; session: Session }> {
  return session ??= (async () => {
    // Same ORT entry as the other audio models; no second runtime.
    const ort = await import('onnxruntime-web/webgpu') as unknown as Ort;
    ort.env.wasm.numThreads = 1;
    const model = source ?? `${import.meta.env.BASE_URL}key-model/key-cnn.onnx`;
    const created = typeof model === 'string'
      ? await ort.InferenceSession.create(model, { executionProviders: ['wasm'] })
      : await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
    return { ort, session: created };
  })().catch(error => { session = undefined; throw error; });
}

/** Key probabilities (24, tonic C = 0, minor + 12) for one excerpt. */
export async function keyProbabilities(engine: KeyCnnEngine, samples: Float32Array): Promise<number[]> {
  const { data, frames } = keySpectrogram(engine, samples);
  const { ort, session: s } = await loadKeyCnn();
  const input = new ort.Tensor('float32', data, [1, frames, BINS]);
  try {
    const outputs = await s.run({ spec: input });
    try { return keySoftmax(outputs.logits.data as Float32Array); }
    finally { for (const tensor of Object.values(outputs)) tensor.dispose(); }
  } finally { input.dispose(); }
}
