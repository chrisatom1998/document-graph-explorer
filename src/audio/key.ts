import type Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import type { MusicAnalysis } from './musicTypes';
import keyModel from './keyModel.json';

type Key = NonNullable<MusicAnalysis['key']>;
export type KeyEngine = Pick<Essentia, 'arrayToVector' | 'vectorToArray' | 'KeyExtractor' | 'Windowing' | 'Spectrum' | 'SpectralPeaks' | 'SpectralWhitening' | 'HPCP'>;
const RATE = 44100;
export const TONICS: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** Harmonics of one tone fill only one or two pitch classes; a key needs at least three. */
export function hasPitchDiversity(engine: KeyEngine, samples: Float32Array): boolean {
  const bins = new Float32Array(12);
  for (let i = 0; i < 12 && samples.length >= 4096; i++) {
    const start = Math.floor((samples.length - 4096) * i / 12);
    const frame = engine.arrayToVector(samples.slice(start, start + 4096));
    const windowed = engine.Windowing(frame).frame;
    const spectrum = engine.Spectrum(windowed).spectrum;
    const peaks = engine.SpectralPeaks(spectrum);
    const hpcp = engine.HPCP(peaks.frequencies, peaks.magnitudes).hpcp;
    const values = engine.vectorToArray(hpcp);
    for (let j = 0; j < 12; j++) bins[j] += values[j];
    for (const vector of [frame, windowed, spectrum, peaks.frequencies, peaks.magnitudes, hpcp]) vector.delete();
  }
  const ranked = [...bins].sort((a,b) => b-a);
  return ranked[0] > 0 && ranked[2] > ranked[0] * 0.18;
}

/** Essentia's key extractor (default profile 'bgate', which the app used before the learned profiles); kept for comparison. */
export function essentiaKey(engine: KeyEngine, samples: Float32Array, profile?: string): Key | undefined {
  const vector = engine.arrayToVector(samples);
  try {
    const key = profile ? engine.KeyExtractor(vector, true, 4096, 4096, 12, 3500, 60, 25, 0.2, profile) : engine.KeyExtractor(vector);
    if (TONICS[key.key] === undefined || (key.scale !== 'major' && key.scale !== 'minor')) return;
    return { tonic: TONICS[key.key], mode: key.scale, strength: Math.min(1, key.strength) };
  } finally { vector.delete(); }
}

/** Mean pitch-class profiles of a mono 44.1 kHz excerpt: 36 bins (a third of a semitone each, bin 0 = A) over
 * 25-3500 Hz and, when asked for (tuning only), 12 bass bins over 30-250 Hz from longer frames; each scaled to a maximum of 1. */
export function chromaFeatures(engine: KeyEngine, samples: Float32Array, withBass = false): { full: number[]; bass: number[] } | undefined {
  const band = (frameSize: number, hop: number, size: number, minFrequency: number, maxFrequency: number) => {
    const sum = new Float64Array(size);
    let frames = 0;
    for (let start = 0; start + frameSize <= samples.length; start += hop) {
      const frame = engine.arrayToVector(samples.subarray(start, start + frameSize));
      const windowed = engine.Windowing(frame, true, frameSize, 'blackmanharris62').frame;
      const spectrum = engine.Spectrum(windowed, frameSize).spectrum;
      const peaks = engine.SpectralPeaks(spectrum, 1e-4, maxFrequency, 60, minFrequency, 'magnitude', RATE);
      const white = engine.SpectralWhitening(spectrum, peaks.frequencies, peaks.magnitudes, maxFrequency, RATE).magnitudes;
      const hpcp = engine.HPCP(peaks.frequencies, white, false, 500, 0, maxFrequency, false, minFrequency, false, 'unitMax', 440, RATE, size, 'cosine', 1).hpcp;
      const values = engine.vectorToArray(hpcp);
      if (values.some(v => v > 0)) { for (let j = 0; j < size; j++) sum[j] += values[j]; frames++; }
      for (const vector of [frame, windowed, spectrum, peaks.frequencies, peaks.magnitudes, white, hpcp]) vector.delete();
    }
    const max = Math.max(...sum);
    return frames && max > 0 ? Array.from(sum, v => v / max) : undefined;
  };
  const full = band(4096, 2048, 36, 25, 3500);
  const bass = withBass ? band(16384, 4096, 12, 30, 250) : undefined;
  return full ? { full, bass: bass ?? new Array<number>(12).fill(0) } : undefined;
}

/** One excerpt's key, or nothing when the excerpt is too short, holds one repeated pitch, or is not confidently tonal.
 * Essentia's stock profile called most minor EDM tracks major; the learned profiles replace it. */
export function excerptKey(engine: KeyEngine, samples: Float32Array, repeatedPitch?: MusicAnalysis['detectedPitch']): Key | undefined {
  // Harmonics of a single short note can resemble a major/minor profile.
  // Strong fundamental agreement is evidence for a pitch, not a mode.
  if (repeatedPitch && repeatedPitch.confidence >= 0.9) return;
  if (samples.length < 3 * RATE || !hasPitchDiversity(engine, samples)) return;
  const chroma = chromaFeatures(engine, samples);
  return chroma ? learnedKey(chroma.full) : undefined;
}

/** Key from a 36-bin mean chroma with profiles learned on Beatport EDM and GTZAN (scripts/key/tune.py). Each key's
 * score is its mode's weights against the log-compressed, centred, unit-length chroma rotated to that tonic; the
 * softmax over the 24 keys must reach keyModel.threshold. Strength maps that threshold to 0.6 and certainty to 1,
 * so 0.6 still marks the weakest key the app shows. */
export function learnedKey(full36: number[]): Key | undefined {
  if (full36.length !== 36) return;
  const c = Array.from({ length: 36 }, (_, i) => Math.log1p(10 * Math.max(0, full36[(i + 9) % 36])));   // index 0 = C
  const mean = c.reduce((a, v) => a + v, 0) / 36;
  const centred = c.map(v => v - mean);
  const length = Math.hypot(...centred);
  if (!(length > 0)) return;
  const x = centred.map(v => v / length);
  const scores: { tonic: number; mode: 'major' | 'minor'; z: number }[] = [];
  for (const mode of ['major', 'minor'] as const) {
    const { weights, bias } = keyModel[mode];
    for (let tonic = 0; tonic < 12; tonic++) {
      let z = bias;
      for (let i = 0; i < 36; i++) z += weights[i] * x[(i + 3 * tonic) % 36];
      scores.push({ tonic, mode, z });
    }
  }
  const top = Math.max(...scores.map(s => s.z));
  const total = scores.reduce((a, s) => a + Math.exp(s.z - top), 0);
  const best = scores.find(s => s.z === top)!;
  const p = 1 / total;
  if (p < keyModel.threshold) return;
  return { tonic: best.tonic, mode: best.mode, strength: Math.min(1, 0.6 + 0.4 * (p - keyModel.threshold) / (1 - keyModel.threshold)) };
}

/** A recording's key is shown only when at least half of its excerpts agree on it. */
export function combineKeys(keys: Key[], excerptCount: number): Key | undefined {
  for (const key of keys) {
    const same = keys.filter(k => k.tonic === key.tonic && k.mode === key.mode);
    if (same.length >= Math.ceil(excerptCount / 2)) return { ...key, strength: Math.min(...same.map(k => k.strength)) };
  }
  return undefined;
}
