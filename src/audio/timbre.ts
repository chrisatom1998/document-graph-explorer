import { fftInPlace } from './structure';

/**
 * A small, fixed-rule measurement of how a recording sounds (band balance, noisiness, clipping via the crest factor, decay, a mid scoop,
 * a 1–2.5 kHz resonance, how many octaves carry sound, and partials that do not line up as harmonics). Plain DSP, no model: the plain-English words
 * built from it live in timbreDescriptions.ts. Computed from up to three 4 s excerpts of 32 kHz mono audio in
 * 64 ms frames with 50% overlap, so it costs under four hundred 2048-point FFTs per recording.
 */
export const TIMBRE_SAMPLE_RATE = 32000;
/** v2 gives every sample nonzero spectral coverage and uses a 16 ms decay envelope. Older preview measurements are discarded on load;
 * this does not invalidate the model-analysis cache, so those recordings need reanalysis to regain a description. */
export const TIMBRE_VERSION = 2;
const FFT = 2048, HALF = FFT / 2, HZ = TIMBRE_SAMPLE_RATE / FFT;
const EXCERPT_SECONDS = 4;
/** Overlap keeps frame-boundary transients near a window peak. */
const HOP = HALF;
/** A finer envelope keeps a short hit's decay visible even when it fits in one FFT frame. */
const LEVEL_FRAME = FFT / 4;
/** Recordings up to this long are measured whole (one-shots and short loops keep their real decay). */
const WHOLE_SECONDS = 12;
/** Band edges in Hz for `bands`: sub, body, mid, presence, brightness, air. */
export const TIMBRE_BAND_EDGES = [20, 150, 600, 2000, 4000, 8000, 16000] as const;
export const TIMBRE_BAND_NAMES = ['sub', 'body', 'mid', 'presence', 'brightness', 'air'] as const;
/** Frames quieter than −80 dBFS (mean square) are silence and are not measured. */
const SILENT = 1e-8;

export interface TimbreSummary {
  version: typeof TIMBRE_VERSION;
  /** Share of 20 Hz–16 kHz energy per TIMBRE_BAND_EDGES band (sums to about 1). */
  bands: number[];
  /** Mean spectral flatness 150 Hz–16 kHz: 0 = pure tones, about 0.5 = white noise. */
  flatness: number;
  /** Mean spectral flatness 8–16 kHz on frames with some air; 0 when the top octave is empty. */
  airFlatness: number;
  /** Median per-frame crest factor (peak / RMS amplitude): a sine is 1.41, a clipped or square wave nears 1, music is usually 3+. */
  crest: number;
  /** Share of the 21 third-octaves (125 Hz–12.5 kHz) within 30 dB of the loudest: a pure tone is about 0.05, a full mix near 1. */
  richness: number;
  /** Median 16 ms frame level over peak frame level (amplitude): 1 = steady, near 0 = a hit that dies away. */
  sustain: number;
  /** dB by which the 500 Hz–2 kHz third-octaves sit below the quieter of their two neighbours (150–500 Hz, 2–5 kHz). */
  scoopDb: number;
  /** dB by which the strongest third-octave in 1–2.5 kHz stands above the median third-octave in 300 Hz–6 kHz. */
  resonanceDb: number;
  /** 0 = spectral peaks sit on a harmonic series, toward 1 = they do not (bells, struck metal). */
  inharmonicity: number;
}

// Hamming retains nonzero weight at excerpt edges without adding padded, broadband edge frames.
const window = Float64Array.from({ length: FFT }, (_, i) => .54 - .46 * Math.cos(2 * Math.PI * i / FFT));
const windowPower = window.reduce((sum, value) => sum + value * value, 0);
const binOf = (hz: number) => Math.min(HALF, Math.max(0, Math.round(hz / HZ)));
const THIRDS = Array.from({ length: 21 }, (_, i) => 125 * 2 ** (i / 3));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 1000) / 1000;

/** Inharmonicity of one power spectrum: how far its strongest peaks sit from the best of a few harmonic series. */
export function frameInharmonicity(p: ArrayLike<number>): number | undefined {
  let max = 0;
  const lo = Math.ceil(60 / HZ), hi = Math.min(HALF - 1, Math.floor(12000 / HZ));
  for (let k = lo; k <= hi; k++) if (p[k] > max) max = p[k];
  if (max <= 0) return;
  const peaks: { f: number; p: number }[] = [];
  // −25 dB keeps Hamming side lobes (about −43 dB) out of the peak list.
  for (let k = lo; k <= hi; k++) if (p[k] > p[k - 1] && p[k] >= p[k + 1] && p[k] >= max * 10 ** -2.5) {
    const a = Math.log(p[k - 1] + 1e-30), b = Math.log(p[k]), c = Math.log(p[k + 1] + 1e-30);
    const d = a - 2 * b + c, delta = d < 0 ? clamp(.5 * (a - c) / d, -.5, .5) : 0;
    peaks.push({ f: (k + delta) * HZ, p: p[k] });
  }
  if (peaks.length < 3) return;
  const top = peaks.sort((x, y) => y.p - x.p).slice(0, 8).sort((x, y) => x.f - y.f);
  let best = Infinity;
  // Try the lowest peak and its 1/2, 1/3, 1/4 as the fundamental, so a missing fundamental or a plain chord is not "inharmonic".
  for (let divisor = 1; divisor <= 4; divisor++) {
    const f0 = top[0].f / divisor;
    if (f0 < 30) break;
    let dev = 0;
    for (let i = 1; i < top.length; i++) { const r = top[i].f / f0; dev += Math.abs(r - Math.round(r)); }
    best = Math.min(best, dev / (top.length - 1));
  }
  return clamp(2 * best, 0, 1);
}

/** Accumulates excerpts (32 kHz mono, each read on its own) into one TimbreSummary. */
export class TimbreFeatures {
  private power = new Float64Array(HALF + 1);
  private re = new Float64Array(FFT); private im = new Float64Array(FFT);
  private frames = 0; private flat = 0; private airFlat = 0; private airFrames = 0;
  private crests: { value: number; weight: number }[] = []; private sustain = 0; private excerpts = 0;
  private inharm = 0; private inharmFrames = 0;

  add(samples: Float32Array): void {
    if (!samples.length) return;
    let peak = 0;
    for (const v of samples) { const a = Math.abs(v); if (a > peak) peak = a; }
    if (!(peak >= 1e-4)) return;
    const levels: number[] = [];
    for (let start = 0; start < samples.length; start += LEVEL_FRAME) {
      const end = Math.min(start + LEVEL_FRAME, samples.length);
      let ms = 0;
      for (let i = start; i < end; i++) ms += samples[i] * samples[i];
      levels.push(Math.sqrt(ms / (end - start)));
    }
    const flatLo = binOf(150), airLo = binOf(8000);
    const frames: { start: number; weight: number; powerScale?: number }[] = [];
    if (samples.length < FFT) {
      // Centre short clips under the window peak, including a single-sample transient.
      const start = -Math.floor((FFT - samples.length) / 2);
      const coveredPower = window.subarray(-start, -start + samples.length).reduce((sum, value) => sum + value * value, 0);
      // Match the full-frame power scale before duration weighting; padding must not count duration twice.
      frames.push({ start, weight: samples.length / FFT, powerScale: windowPower / coveredPower });
    } else {
      // Count the first frame once and subsequent frames only for their newly covered half.
      for (let start = 0; start + FFT <= samples.length; start += HOP) frames.push({ start, weight: start === 0 ? 1 : HOP / FFT });
      // Keep real audio in the end-aligned spectrum; only its newly covered duration counts.
      const last = samples.length - FFT, remainder = last % HOP;
      if (remainder) frames.push({ start: last, weight: remainder / FFT });
    }
    for (const { start, weight, powerScale = 1 } of frames) {
      let ms = 0, top = 0;
      for (let i = 0; i < FFT; i++) { const v = samples[start + i] ?? 0; ms += v * v; top = Math.max(top, Math.abs(v)); this.re[i] = v * window[i]; this.im[i] = 0; }
      ms /= Math.min(samples.length, start + FFT) - Math.max(0, start);
      if (ms < SILENT) continue;
      this.crests.push({ value: top / Math.sqrt(ms), weight });
      fftInPlace(this.re, this.im);
      const p = this.re;
      for (let k = 0; k <= HALF; k++) { p[k] = this.re[k] * this.re[k] + this.im[k] * this.im[k]; this.power[k] += p[k] * weight * powerScale; }
      this.frames += weight;
      this.flat += flatness(p, flatLo, HALF) * weight;
      let air = 0, all = 0;
      for (let k = 1; k <= HALF; k++) { all += p[k]; if (k >= airLo) air += p[k]; }
      if (all > 0 && air / all >= .02) { this.airFlat += flatness(p, airLo, HALF) * weight; this.airFrames += weight; }
      const inharm = frameInharmonicity(p);
      if (inharm !== undefined) { this.inharm += inharm * weight; this.inharmFrames += weight; }
    }
    const top = Math.max(...levels);
    if (top > 0) { const sorted = [...levels].sort((a, b) => a - b); this.sustain += sorted[Math.floor(sorted.length / 2)] / top; this.excerpts++; }
  }

  summary(): TimbreSummary | undefined {
    if (!this.frames) return;
    const p = this.power, bands = TIMBRE_BAND_NAMES.map(() => 0);
    for (let k = 1; k <= HALF; k++) {
      const hz = k * HZ, band = TIMBRE_BAND_EDGES.findIndex((edge, i) => i > 0 && hz < edge);
      if (hz >= TIMBRE_BAND_EDGES[0]) bands[band < 0 ? bands.length - 1 : band - 1] += p[k];
    }
    const total = bands.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return;
    let mean = 0;
    for (let k = 1; k <= HALF; k++) mean += p[k];
    const floor = mean / HALF * 1e-9;
    // Third-octave power density in dB; a band narrower than one bin takes its nearest bin.
    const thirds = THIRDS.map(c => {
      const a = binOf(c * 2 ** (-1 / 6)), b = Math.max(a, binOf(c * 2 ** (1 / 6)) - 1);
      let s = 0; for (let k = a; k <= b; k++) s += p[k];
      return { c, db: 10 * Math.log10(s / (b - a + 1) + floor) };
    });
    const avg = (lo: number, hi: number) => { const v = thirds.filter(t => t.c >= lo && t.c <= hi).map(t => t.db); return v.reduce((a, b) => a + b, 0) / v.length; };
    const loudest = Math.max(...thirds.map(t => t.db));
    const scoop = Math.min(avg(150, 499), avg(2001, 5000)) - avg(500, 2000);
    const around = thirds.filter(t => t.c >= 300 && t.c <= 6000).map(t => t.db).sort((a, b) => a - b);
    const resonance = Math.max(...thirds.filter(t => t.c >= 1000 && t.c <= 2500).map(t => t.db)) - around[Math.floor(around.length / 2)];
    let crest = 1, crestWeight = 0;
    for (const frame of this.crests.sort((a, b) => a.value - b.value)) {
      crest = frame.value; crestWeight += frame.weight;
      if (crestWeight > this.frames / 2) break;
    }
    return {
      version: TIMBRE_VERSION,
      bands: bands.map(b => round(b / total)),
      flatness: round(clamp(this.flat / this.frames, 0, 1)),
      airFlatness: round(this.airFrames ? clamp(this.airFlat / this.airFrames, 0, 1) : 0),
      crest: round(clamp(crest, 1, 30)),
      richness: round(thirds.filter(t => t.db >= loudest - 30).length / thirds.length),
      sustain: round(this.excerpts ? clamp(this.sustain / this.excerpts, 0, 1) : 0),
      scoopDb: round(clamp(scoop, -60, 60)),
      resonanceDb: round(clamp(resonance, -60, 60)),
      inharmonicity: round(this.inharmFrames >= 3 ? clamp(this.inharm / this.inharmFrames, 0, 1) : 0),
    };
  }
}

/** Geometric over arithmetic mean of power bins [lo, hi]; a tiny relative floor keeps empty bins finite. */
function flatness(p: ArrayLike<number>, lo: number, hi: number): number {
  let sum = 0;
  for (let k = lo; k <= hi; k++) sum += p[k];
  const am = sum / (hi - lo + 1);
  if (!(am > 0)) return 0;
  let logs = 0;
  for (let k = lo; k <= hi; k++) logs += Math.log(p[k] + am * 1e-10);
  return clamp(Math.exp(logs / (hi - lo + 1)) / am, 0, 1);
}

/** Up to three 4 s excerpts (20%, 50%, 80% of the way through), or the whole recording when it is short. */
export function timbreExcerpts(duration: number): { start: number; seconds: number }[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  if (duration <= WHOLE_SECONDS) return [{ start: 0, seconds: duration }];
  return [.2, .5, .8].map(at => ({ start: Math.max(0, Math.min(duration - EXCERPT_SECONDS, duration * at - EXCERPT_SECONDS / 2)), seconds: EXCERPT_SECONDS }));
}

export async function computeTimbre(read: (start: number, seconds: number) => Promise<Float32Array>, duration: number, signal?: AbortSignal): Promise<TimbreSummary | undefined> {
  const features = new TimbreFeatures();
  for (const { start, seconds } of timbreExcerpts(duration)) {
    signal?.throwIfAborted();
    features.add(await read(start, seconds));
  }
  return features.summary();
}

const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const crest = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 30;
const db = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -60 && v <= 60;
/** Persisted analysis is untrusted: keep the summary only when every value is in range. */
export function sanitizeTimbre(value: unknown): TimbreSummary | undefined {
  if (!value || typeof value !== 'object') return;
  const t = value as Record<string, unknown>;
  if (t.version !== TIMBRE_VERSION || !Array.isArray(t.bands) || t.bands.length !== TIMBRE_BAND_NAMES.length || !t.bands.every(unit)) return;
  if (![t.flatness, t.airFlatness, t.richness, t.sustain, t.inharmonicity].every(unit) || !crest(t.crest) || !db(t.scoopDb) || !db(t.resonanceDb)) return;
  return { version: TIMBRE_VERSION, bands: [...t.bands as number[]], flatness: t.flatness as number, airFlatness: t.airFlatness as number, crest: t.crest as number, richness: t.richness as number,
    sustain: t.sustain as number, scoopDb: t.scoopDb as number, resonanceDb: t.resonanceDb as number, inharmonicity: t.inharmonicity as number };
}
