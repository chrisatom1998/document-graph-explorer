import { TIMBRE_SAMPLE_RATE } from './timbre';
/** Deterministic synthetic signals for the timbre tests (32 kHz mono). */
const R = TIMBRE_SAMPLE_RATE;
export function rng(seed = 1) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
export const sine = (hz: number, seconds = 1, amp = .5) => Float32Array.from({ length: Math.round(seconds * R) }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / R));
/** Band-limited sawtooth (harmonics up to Nyquist). */
export function saw(hz: number, seconds = 1, amp = .3) {
  const out = new Float32Array(Math.round(seconds * R));
  for (let n = 1; n * hz < R / 2; n++) for (let i = 0; i < out.length; i++) out[i] += amp * (2 / Math.PI) * Math.sin(2 * Math.PI * n * hz * i / R) / n * (n % 2 ? 1 : -1);
  return out;
}
export const clip = (x: Float32Array, gain: number) => x.map(v => Math.max(-.8, Math.min(.8, v * gain)));
export function noise(seconds = 1, amp = .3, seed = 7) { const r = rng(seed); return Float32Array.from({ length: Math.round(seconds * R) }, () => amp * (2 * r() - 1)); }
/** Crude high-pass: repeated first differences (each adds 6 dB/octave of tilt). */
export function highPass(x: Float32Array, order = 4) { let y = x; for (let o = 0; o < order; o++) { const z = new Float32Array(y.length); for (let i = 1; i < y.length; i++) z[i] = y[i] - y[i - 1]; y = z; } let peak = 0; for (const v of y) peak = Math.max(peak, Math.abs(v)); return y.map(v => v / peak * .3); }
/** Sum of decaying partials at the given frequency ratios. */
export function partials(f0: number, ratios: number[], seconds = 1, decay = 1.5, amps?: number[]) {
  const out = new Float32Array(Math.round(seconds * R));
  ratios.forEach((r, j) => { const a = (amps?.[j] ?? 1 / (j + 1)) * .3; for (let i = 0; i < out.length; i++) out[i] += a * Math.exp(-decay * i / R) * Math.sin(2 * Math.PI * f0 * r * i / R); });
  return out;
}
export const mix = (...xs: Float32Array[]) => { const out = new Float32Array(Math.max(...xs.map(x => x.length))); for (const x of xs) x.forEach((v, i) => { out[i] += v; }); return out; };
