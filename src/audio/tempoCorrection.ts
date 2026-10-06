import model from './tempoCorrection.json';
import type { TempoEngine } from './tempo';

type Node = [feature: number, threshold: number, left: number, right: number, leaf: number];
const TREES = model.trees as Node[][];
const FPS = 44100 / 512;
const GRID_MIN = 40, GRID_MAX = 250;
// Beat trackers lock onto half time, two-thirds time (triplet feel) or 4/3 time on broken beats.
const MULTIPLIERS = [1, 2, 1 / 2, 3 / 2, 2 / 3, 4 / 3, 3 / 4];
const HARMONICS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 4 / 3, 3 / 2, 2, 3];

/** Autocorrelation of the beat-emphasis onset function at every whole BPM from 40 to 250, relative to lag zero. */
export function beatTempogram(engine: TempoEngine, vector: ReturnType<TempoEngine['arrayToVector']>): number[] {
  const detections = engine.OnsetDetectionGlobal(vector, 2048, 512, 'beat_emphasis', 44100).onsetDetections;
  let odf: Float32Array;
  try { odf = engine.vectorToArray(detections); } finally { detections.delete(); }
  const mean = odf.reduce((s, v) => s + v, 0) / odf.length;
  const x = Array.from(odf, v => v - mean);
  const ac = (lag: number) => { let s = 0; for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag]; return s / (x.length - lag); };
  const zero = ac(0) || 1;
  const out: number[] = [];
  for (let bpm = GRID_MIN; bpm <= GRID_MAX; bpm++) {
    const lag = 60 * FPS / bpm, l0 = Math.floor(lag), f = lag - l0;
    // Rounded like the offline features the correction was trained on.
    out.push(+(((1 - f) * ac(l0) + f * ac(l0 + 1)) / zero).toFixed(4));
  }
  return out;
}

function at(tg: number[], bpm: number): number {
  if (bpm < GRID_MIN || bpm > GRID_MAX) return 0;
  const f = bpm - GRID_MIN, i = Math.floor(f);
  if (i >= tg.length - 1) return tg[tg.length - 1];
  const w = f - i;
  return tg[i] * (1 - w) + tg[i + 1] * w;
}

/** Strongest periodicity within 3% of bpm, so a slightly-off estimate still finds its peak. */
function peak(tg: number[], bpm: number): number {
  const lo = bpm * 0.97, hi = bpm * 1.03;
  let best = -Infinity;
  for (let k = 0; k <= 6; k++) best = Math.max(best, at(tg, lo + (hi - lo) * k / 6));
  return best;
}

function probability(features: number[]): number {
  let s = model.baseline;
  for (const tree of TREES) {
    let n = 0;
    while (tree[n][0] >= 0) n = features[tree[n][0]] <= tree[n][1] ? tree[n][2] : tree[n][3];
    s += tree[n][4];
  }
  return 1 / (1 + Math.exp(-s));
}

/**
 * Re-picks the metrical level of a beat-tracker tempo from the tempogram's periodicity pattern.
 * Keeps the tracker's tempo unless an alternative is clearly more likely (tuned on clips held apart from
 * the 500-clip DJ test; see docs/evaluations/tempo-2026-10-06).
 */
export function correctTempo(tg: number[], bpm: number): number {
  const max = Math.max(...tg);
  if (!(max > 0)) return bpm;
  let base = -1, best = -1, bestBpm = bpm;
  for (const m of MULTIPLIERS) {
    const c = bpm * m;
    if (m !== 1 && (c < 60 || c > 200)) continue;
    const features = [peak(tg, c) / max,
      ...HARMONICS.map(h => c * h >= GRID_MIN && c * h <= GRID_MAX ? peak(tg, c * h) / max : 0),
      Math.log2(c / 120), Math.log2(c / 120) ** 2,
      ...MULTIPLIERS.map(v => v === m ? 1 : 0)];
    const p = probability(features);
    if (m === 1) base = p;
    if (p > best) { best = p; bestBpm = c; }
  }
  return best - base > model.margin ? bestBpm : bpm;
}
