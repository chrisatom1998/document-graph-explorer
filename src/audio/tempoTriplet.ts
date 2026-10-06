import model from './tempoTriplet.json';
import { levelProbabilities, peak, tempogramOf } from './tempoCorrection';

type Node = [feature: number, threshold: number, left: number, right: number, leaf: number];
const CLASS_TREES = model.trees as Node[][][];
const RATE = 44100, HOP = 512, FRAME = 1024;
const GRID_MIN = 40, GRID_MAX = 250;
// Tempogram strength at these multiples of the current tempo, in the full-band, kick and hi-hat tempograms.
const RATIOS = [1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 3 / 4, 1, 4 / 3, 3 / 2, 2, 8 / 3, 3];
// The two triplet-feel families: a tempo read at two-thirds of the truth needs x3/2 (or x3/4), one read at 3/2 or 3/4
// of the truth needs x2/3 (or x4/3).
const FAMILIES: Record<1 | 2, number[]> = { 1: [3 / 2, 3 / 4], 2: [2 / 3, 4 / 3] };

type Biquad = [b0: number, b1: number, b2: number, a1: number, a2: number];

/** RBJ cookbook low- or high-pass at Q = 1/√2, normalised by a0. */
function biquad(kind: 'low' | 'high', hz: number): Biquad {
  const w = 2 * Math.PI * hz / RATE, cos = Math.cos(w), alpha = Math.sin(w) / Math.SQRT2, a0 = 1 + alpha;
  const b0 = (kind === 'low' ? 1 - cos : 1 + cos) / 2, b1 = kind === 'low' ? 1 - cos : -(1 + cos);
  return [b0 / a0, b1 / a0, b0 / a0, -2 * cos / a0, (1 - alpha) / a0];
}

/** Two cascaded passes (fourth order), so a kick or a hi-hat dominates its band. */
function filtered(samples: Float32Array, [b0, b1, b2, a1, a2]: Biquad): Float64Array {
  let x = Float64Array.from(samples);
  for (let pass = 0; pass < 2; pass++) {
    const y = new Float64Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    x = y;
  }
  return x;
}

/** Rise in log-compressed frame energy: a band's onset strength every 512 samples. */
function energyFlux(band: Float64Array): number[] {
  const frames = Math.max(0, Math.floor((band.length - FRAME) / HOP) + 1);
  const energy = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * HOP; i < f * HOP + FRAME; i++) s += band[i] * band[i];
    energy[f] = s / FRAME;
  }
  const mean = energy.reduce((s, v) => s + v, 0) / (frames || 1) || 1;
  const out: number[] = [];
  let prev = Math.log1p(100 * energy[0] / mean);
  for (let f = 1; f < frames; f++) {
    const c = Math.log1p(100 * energy[f] / mean);
    out.push(Math.max(0, c - prev)); prev = c;
  }
  return out;
}

/**
 * Tempograms of the kick band (below 150 Hz) and the hi-hat band (above 5 kHz). On dance music both usually tick on
 * the beat grid, while a dotted bassline or synth riff, which fools the full-band onset function into two-thirds
 * or four-thirds time, sits between them.
 */
export function bandTempograms(samples: Float32Array): { low: number[]; high: number[] } {
  return {
    low: tempogramOf(energyFlux(filtered(samples, biquad('low', 150)))),
    high: tempogramOf(energyFlux(filtered(samples, biquad('high', 5000)))),
  };
}

/** Softmax over stay / x3/2 family / x4/3 family / other. */
function familyProbabilities(features: number[]): number[] {
  const raw = CLASS_TREES.map((trees, k) => {
    let s = model.baseline[k];
    for (const tree of trees) {
      let n = 0;
      while (tree[n][0] >= 0) n = features[tree[n][0]] <= tree[n][1] ? tree[n][2] : tree[n][3];
      s += tree[n][4];
    }
    return s;
  });
  const top = Math.max(...raw), e = raw.map(v => Math.exp(v - top)), sum = e.reduce((a, b) => a + b, 0);
  return e.map(v => v / sum);
}

/**
 * Checks a tempo for triplet-feel errors (93 for a 140 track, or 172 for a 129 track): dotted riffs make a beat
 * tracker lock onto two-thirds or four-thirds time. Switches to the other family only when the full-band, kick and
 * hi-hat periodicities clearly favour it, then lets the half-time correction pick the octave. Tuned on clips held
 * apart from both DJ tests; see docs/evaluations/tempo-triplet-2026-10-06.
 */
export function correctTriplet(tg: number[], bands: { low: number[]; high: number[] }, bpm: number): number {
  if (!(Math.max(...tg) > 0)) return bpm;
  const features: number[] = [];
  for (const t of [tg, bands.low, bands.high]) {
    const top = Math.max(...t) > 0 ? Math.max(...t) : 1;
    for (const r of RATIOS) features.push(bpm * r >= GRID_MIN && bpm * r <= GRID_MAX ? peak(t, bpm * r) / top : 0);
  }
  features.push(Math.log2(bpm / 120));
  const p = familyProbabilities(features);
  const k = p[1] >= p[2] ? 1 : 2;
  if (!(p[k] - p[0] > model.margin)) return bpm;
  const options = levelProbabilities(tg, bpm).filter(o => FAMILIES[k].some(m => Math.abs(o.multiplier - m) < 1e-9));
  return options.length ? options.reduce((a, b) => b.p > a.p ? b : a).bpm : bpm;
}
