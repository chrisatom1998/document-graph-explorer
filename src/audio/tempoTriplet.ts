const RATE = 44100, HOP = 512, FRAME = 1024;
const FPS = RATE / HOP;
const GRID_MIN = 40, GRID_MAX = 250;

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

/** Autocorrelation of an onset function (512-sample hops) at every whole BPM from 40 to 250, relative to lag zero. */
export function tempogramOf(odf: ArrayLike<number>): number[] {
  const n = odf.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += odf[i];
  mean /= n || 1;
  const x = Array.from(odf, v => v - mean);
  const ac = (lag: number) => { let s = 0; for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag]; return s / (n - lag); };
  const zero = ac(0) || 1;
  const out: number[] = [];
  for (let bpm = GRID_MIN; bpm <= GRID_MAX; bpm++) {
    const lag = 60 * FPS / bpm, l0 = Math.floor(lag), f = lag - l0;
    // Rounded like the offline features the corrections were trained on.
    const v = ((1 - f) * ac(l0) + f * ac(l0 + 1)) / zero;
    out.push(Number.isFinite(v) ? +v.toFixed(4) : 0);
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
