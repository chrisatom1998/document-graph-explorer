import type Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import type { MusicAnalysis } from './musicTypes';
export type PitchEngine = Pick<Essentia, 'arrayToVector' | 'PitchYin'>;
const RATE = 44100;
const FRAME = 4096;

/** Quantize an audible fundamental, not its spectral harmonics. */
export function pitchClassAt(frequency: number): number | undefined {
  if (!Number.isFinite(frequency) || frequency < 40 || frequency > 1760) return;
  const midi = 69 + 12 * Math.log2(frequency / 440);
  const nearest = Math.round(midi);
  if (Math.abs(midi - nearest) > 0.35) return;
  return ((nearest % 12) + 12) % 12;
}

/** Fallback for sparse tonal clips. A detected pitch is not a musical key. */
export function detectRepeatedPitch(engine: PitchEngine, samples: Float32Array): MusicAnalysis['detectedPitch'] {
  // A single short note still needs enough analysis frames; denser hops give a 0.5-1.5 s note the same vote count.
  if (samples.length < RATE * 0.5) return;
  const hop = samples.length < RATE * 1.5 ? 1024 : 4410;
  const count = Math.min(96, Math.floor((samples.length - FRAME) / hop) + 1);
  const votes = new Array<number>(12).fill(0);
  const confidence = new Array<number>(12).fill(0);
  let voiced = 0;
  for (let i = 0; i < count; i++) {
    const start = Math.round((samples.length - FRAME) * i / Math.max(1, count - 1));
    const frame = samples.slice(start, start + FRAME);
    const energy = frame.reduce((sum, value) => sum + value * value, 0) / FRAME;
    if (!Number.isFinite(energy) || energy <= 1e-8) continue;
    const vector = engine.arrayToVector(frame);
    try {
      const result = engine.PitchYin(vector, FRAME, true, 1760, 40);
      if (!Number.isFinite(result.pitchConfidence) || result.pitchConfidence < 0.85 || result.pitchConfidence > 1) continue;
      const pitch = pitchClassAt(result.pitch);
      if (pitch === undefined) continue;
      votes[pitch]++; confidence[pitch] += result.pitchConfidence; voiced++;
    } finally { vector.delete(); }
  }
  const pitchClass = votes.indexOf(Math.max(...votes));
  if (voiced < 8 || voiced / count < 0.35 || votes[pitchClass] / voiced < 0.8) return;
  return { pitchClass, confidence: confidence[pitchClass] / voiced };
}
