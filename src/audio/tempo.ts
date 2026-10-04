import type Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import type { MusicAnalysis } from './musicTypes';

type Tempo = NonNullable<MusicAnalysis['tempo']>;
export type TempoEngine = Pick<Essentia, 'arrayToVector' | 'OnsetRate' | 'LoopBpmEstimator' | 'RhythmExtractor2013'>;
const RATE = 44100;
const validBpm = (bpm: number) => Number.isFinite(bpm) && bpm >= 40 && bpm <= 250;

function shortEstimate(bpm: number, confidence: number): Tempo {
  return {
    bpm, confidence,
    // A short recording does not establish the intended metrical level.
    // These are alternatives, never extra evidence for graph links.
    alternatives: [bpm / 2, bpm * 2].filter(validBpm).map(v => Math.round(v * 10) / 10),
  };
}

/** Input is real 44.1 kHz audio: never repeat a clip or infer BPM from its name. */
export function estimateTempo(engine: TempoEngine, samples: Float32Array): Tempo | undefined {
  if (samples.length < 2 * RATE) return;
  const energy = samples.reduce((sum, value) => sum + value * value, 0) / samples.length;
  if (!Number.isFinite(energy) || energy <= 1e-8) return;
  const vector = engine.arrayToVector(samples);
  const short = samples.length < 8 * RATE;
  try {
    if (short) {
      // Beat trackers can report a convincing BPM for a steady tone or noise.
      // Require at least three actual attacks before trying the loop estimator.
      const attacks = engine.OnsetRate(vector);
      try { if (attacks.onsets.size() < 3) return; }
      finally { attacks.onsets.delete(); }
      try {
        // Uses Percival's periodicity estimate and requires a 0.95 loop fit.
        const loop = engine.LoopBpmEstimator(vector, 0.95);
        if (validBpm(loop.bpm)) return shortEstimate(loop.bpm, 0.75);
      } catch { /* Non-loop fragments can still be supported by beat tracking. */ }
    }
    const rhythm = engine.RhythmExtractor2013(vector);
    try {
      if (rhythm.confidence >= 1.5 && rhythm.ticks.size() >= (short ? 4 : 6) && validBpm(rhythm.bpm)) {
        const confidence = Math.min(short ? 0.75 : 1, rhythm.confidence / 3);
        return short ? shortEstimate(rhythm.bpm, confidence) : { bpm: rhythm.bpm, confidence };
      }
    } finally {
      rhythm.ticks.delete(); rhythm.estimates.delete(); rhythm.bpmIntervals.delete();
    }
  } catch { /* Leave tempo uncertain while allowing key/instrument analysis. */ }
  finally { vector.delete(); }
  return undefined;
}
