/** Event-shape features for short one-shots: how a hit starts (attack), holds (body) and dies away (decay).
 * Pure and dependency-free so the browser worker and the training scripts compute identical numbers.
 * Input is mono 16 kHz audio exactly as decoded: never looped, stretched or padded. */
export const EVENT_FEATURE_RATE = 16000;
export const EVENT_FEATURE_VERSION = 'event-shape-v1';
const FRAME = 512, HOP = 160, BANDS = 24;
const EPS = 1e-10;

let melCache: Float32Array[] | undefined;
function melFilters(): Float32Array[] {
  if (melCache) return melCache;
  const hz = (m: number) => 700 * (10 ** (m / 2595) - 1), mel = (f: number) => 2595 * Math.log10(1 + f / 700);
  const lo = mel(30), hi = mel(7800), bins = FRAME / 2 + 1;
  const edges = Array.from({ length: BANDS + 2 }, (_, i) => hz(lo + (hi - lo) * i / (BANDS + 1)) * FRAME / EVENT_FEATURE_RATE);
  melCache = Array.from({ length: BANDS }, (_, b) => {
    const f = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      const up = (k - edges[b]) / (edges[b + 1] - edges[b]), down = (edges[b + 2] - k) / (edges[b + 2] - edges[b + 1]);
      f[k] = Math.max(0, Math.min(up, down));
    }
    return f;
  });
  return melCache;
}

/** In-place radix-2 FFT; returns the power spectrum of one Hann-windowed frame. */
function power(frame: Float32Array): Float32Array {
  const n = FRAME, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = frame[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
  const out = new Float32Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k];
  return out;
}

const mean = (v: ArrayLike<number>, a = 0, b = v.length) => { let s = 0; for (let i = a; i < b; i++) s += v[i]; return b > a ? s / (b - a) : 0; };

/** Names of the returned values, in order. */
export const EVENT_FEATURE_NAMES: string[] = [
  'log_duration', 'log_effective_duration', 'peak_db', 'rms_db', 'crest_db', 'log_attack', 'log_decay20', 'log_decay40', 'temporal_centroid',
  'onset_count', 'tail_fraction', 'zcr_attack', 'zcr_body', 'centroid_attack', 'centroid_body', 'centroid_tail', 'flatness_attack', 'flatness_body',
  'flatness_tail', 'pitch_confidence', 'pitch_log_hz', 'centroid_slope',
  ...['attack', 'body', 'tail'].flatMap(s => Array.from({ length: BANDS }, (_, b) => `mel_${s}_${b}`)),
];

/** Fixed-length description of one clip's main event. Silent input returns undefined. */
export function eventFeatures(samples: Float32Array): number[] | undefined {
  if (samples.length < FRAME) return;
  let peak = 0, energy = 0;
  for (const v of samples) { const a = Math.abs(v); if (a > peak) peak = a; energy += v * v; }
  if (energy / samples.length <= 1e-8) return;
  // Level-normalise the spectral part; level itself is kept as separate features.
  const frames = Math.floor((samples.length - FRAME) / HOP) + 1;
  const env = new Float32Array(frames), mels: Float32Array[] = [], cent = new Float32Array(frames), flat = new Float32Array(frames), zcr = new Float32Array(frames);
  const filters = melFilters();
  for (let f = 0; f < frames; f++) {
    const frame = samples.subarray(f * HOP, f * HOP + FRAME);
    let e = 0, z = 0;
    for (let i = 0; i < FRAME; i++) { e += frame[i] * frame[i]; if (i && (frame[i] >= 0) !== (frame[i - 1] >= 0)) z++; }
    env[f] = Math.sqrt(e / FRAME); zcr[f] = z / FRAME;
    const p = power(frame);
    let ps = 0, pw = 0, lg = 0;
    for (let k = 1; k < p.length; k++) { ps += p[k]; pw += p[k] * k; lg += Math.log(p[k] + EPS); }
    cent[f] = ps > EPS ? pw / ps / (p.length - 1) : 0;
    flat[f] = ps > EPS ? Math.exp(lg / (p.length - 1)) / (ps / (p.length - 1)) : 0;
    mels.push(Float32Array.from(filters, w => { let s = 0; for (let k = 0; k < p.length; k++) s += w[k] * p[k]; return s; }));
  }
  const top = Math.max(...env), at = env.indexOf(top);
  const db = (v: number) => 20 * Math.log10(v + EPS);
  // Attack: first crossing of 10% to the first 90% of the envelope peak.
  let a10 = 0; while (a10 < at && env[a10] < top * .1) a10++;
  let a90 = a10; while (a90 < at && env[a90] < top * .9) a90++;
  const after = (ratio: number) => { let i = at; while (i < frames && env[i] > top * ratio) i++; return i; };
  const d20 = after(.1), d40 = after(.01);
  let active = 0, weighted = 0, total = 0;
  for (let f = 0; f < frames; f++) { if (env[f] > top * .05) active++; weighted += f * env[f]; total += env[f]; }
  // Separate onsets: rises of at least 9 dB from a local dip that reach within 12 dB of the peak.
  // The clip start counts as silence, so the first hit is always one onset.
  let onsets = 0, low = 0, high = 0, armed = true;
  for (let f = 0; f < frames; f++) {
    if (armed) {
      low = Math.min(low, env[f]);
      if (env[f] > top * .25 && env[f] > low * 2.8) { onsets++; armed = false; high = env[f]; }
    } else {
      high = Math.max(high, env[f]);
      if (env[f] < high / 2.8) { armed = true; low = env[f]; }
    }
  }
  const t = (frames_: number) => Math.log(Math.max(frames_, .5) * HOP / EVENT_FEATURE_RATE + 1e-3);
  const seg = [[a10, Math.min(frames, at + 3)], [Math.min(frames - 1, at + 3), Math.min(frames, at + 15)], [Math.min(frames - 1, at + 15), frames]] as const;
  const fixed = (s: readonly [number, number]) => s[1] > s[0] ? s : [Math.max(0, s[0] - 1), Math.max(1, s[0])] as const;
  const segs = seg.map(fixed);
  const melSeg = segs.flatMap(([a, b]) => {
    const m = new Float64Array(BANDS);
    for (let f = a; f < b; f++) for (let k = 0; k < BANDS; k++) m[k] += mels[f][k];
    const sum = m.reduce((s, v) => s + v, 0) + EPS;
    return Array.from(m, v => Math.log(v / sum + 1e-6));
  });
  // Pitch: normalised autocorrelation peak over the body (50-1000 Hz).
  const body = samples.subarray(Math.min(samples.length - 1, (at + 2) * HOP), Math.min(samples.length, (at + 2) * HOP + 2048));
  let bestR = 0, bestLag = 0;
  if (body.length >= 1024) {
    let r0 = 0; for (let i = 0; i < body.length; i++) r0 += body[i] * body[i];
    for (let lag = 16; lag <= 320 && lag < body.length / 2; lag++) {
      let r = 0, e2 = 0;
      for (let i = 0; i + lag < body.length; i++) { r += body[i] * body[i + lag]; e2 += body[i + lag] * body[i + lag]; }
      const v = r / Math.sqrt(r0 * e2 + EPS);
      if (v > bestR) { bestR = v; bestLag = lag; }
    }
  }
  const cTail = mean(cent, segs[2][0], segs[2][1]), cAttack = mean(cent, segs[0][0], segs[0][1]);
  const out = [
    Math.log(samples.length / EVENT_FEATURE_RATE), t(active), db(peak), db(Math.sqrt(energy / samples.length)), db(peak) - db(Math.sqrt(energy / samples.length)),
    t(a90 - a10), t(d20 - at), t(d40 - at), total ? weighted / total / frames : 0,
    Math.min(onsets, 8), frames ? (frames - d20) / frames : 0,
    mean(zcr, ...segs[0]), mean(zcr, ...segs[1]), cAttack, mean(cent, ...segs[1]), cTail,
    mean(flat, ...segs[0]), mean(flat, ...segs[1]), mean(flat, ...segs[2]),
    bestR, bestLag ? Math.log(EVENT_FEATURE_RATE / bestLag) : 0, cTail - cAttack,
    ...melSeg,
  ];
  return out.map(v => Number.isFinite(v) ? Math.round(v * 1e5) / 1e5 : 0);
}
