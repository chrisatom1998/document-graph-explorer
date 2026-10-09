import { fft } from './tempoCnn';

// Tells a sample-pack loop from an excerpt cut out of a song. A loop is cut so that it repeats: where its end runs back
// into its start, little sound stops abruptly. An excerpt cut at an arbitrary point usually ends mid-note, so the
// wrap is the biggest drop in the whole file. Tuned on FSL10K loops and GTZAN excerpts outside every judge set.
const N = 1024, HOP = 256, PAD = 8 * HOP + N;
/** A recording is a seamless loop when its wrap drops less sound than this share of its own moments do. */
export const SEAMLESS_LOOP_PERCENTILE = 0.95;

const HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));

/** Falling spectral flux (log magnitude that disappears from one frame to the next), frame i to i + 1. */
function fallingFlux(y: Float32Array): Float64Array {
  const frames = Math.floor((y.length - N) / HOP) + 1;
  const re = new Float64Array(N), im = new Float64Array(N);
  let previous = new Float64Array(N / 2 + 1), current = new Float64Array(N / 2 + 1);
  const out = new Float64Array(Math.max(0, frames - 1));
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) { re[i] = y[f * HOP + i] * HANN[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= N / 2; k++) current[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
    if (f > 0) { let s = 0; for (let k = 0; k <= N / 2; k++) s += Math.max(0, previous[k] - current[k]); out[f - 1] = s; }
    [previous, current] = [current, previous];
  }
  return out;
}

const maxOf = (a: Float64Array, from: number, to: number) => { let m = -Infinity; for (let i = from; i < to; i++) m = Math.max(m, a[i]); return m; };

/**
 * Share of the recording's own moments (6-frame maxima of falling flux) that drop less sound than the wrap from its
 * end back to its start does. Undefined when the recording is too short to judge. Input: 44.1 kHz mono.
 */
export function wrapDropPercentile(y: Float32Array): number | undefined {
  if (y.length < 4 * N) return;
  const tiled = new Float32Array(y.length + 2 * PAD);
  tiled.set(y.subarray(y.length - PAD), 0);
  tiled.set(y, PAD);
  tiled.set(y.subarray(0, PAD), PAD + y.length);
  const f = fallingFlux(tiled);
  const start = Math.floor(PAD / HOP), end = Math.floor((PAD + y.length) / HOP);
  const wrap = Math.max(maxOf(f, start - 4, start + 2), maxOf(f, end - 4, end + 2));
  const from = start + 2, to = end - 4;
  if (to - from < 8) return;
  let below = 0, count = 0;
  for (let i = from; i + 6 <= to; i++, count++) if (maxOf(f, i, i + 6) < wrap) below++;
  return below / count;
}

export function isSeamlessLoop(y: Float32Array): boolean {
  const p = wrapDropPercentile(y);
  return p !== undefined && p < SEAMLESS_LOOP_PERCENTILE;
}
