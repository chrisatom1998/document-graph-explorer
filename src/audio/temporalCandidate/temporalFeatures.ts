/** Frozen label-free temporal feature contract; no fitting, state, or network access. */
const FRAME = 1024, HOP = 256, RATE = 16000, BINS = FRAME / 2 + 1;
const STATS = ['mean', 'std', 'q10', 'q50', 'q90'];
const METRICS = ['logRms', 'zeroCrossing', 'centroid', 'spread', 'rolloff85', 'flatness', 'entropy', 'positiveFlux', 'highBandFraction', 'lowBandFraction', 'crest'];
export const TEMPORAL_FEATURE_NAMES = Object.freeze([
  ...Array.from({ length: 13 }, (_, i) => STATS.map(s => `mfcc${i + 1}:${s}`)).flat(),
  ...METRICS.flatMap(k => STATS.map(s => `${k}:${s}`)),
  ...Array.from({ length: 10 }, (_, i) => `energyFraction:${i}`), 'attackDensity', 'loudFrameFraction', 'crestGlobal',
]);
const window = Float64Array.from({ length: FRAME }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (FRAME - 1)));
const reverse = Uint16Array.from({ length: FRAME }, (_, i) => {
  let v = i, r = 0; for (let bit = 0; bit < 10; bit++) { r = (r << 1) | (v & 1); v >>= 1; } return r;
});
const cosine = Float64Array.from({ length: FRAME / 2 }, (_, k) => Math.cos(2 * Math.PI * k / FRAME));
const sine = Float64Array.from({ length: FRAME / 2 }, (_, k) => -Math.sin(2 * Math.PI * k / FRAME));
const mel = (f: number) => 2595 * Math.log10(1 + f / 700);
const hz = (m: number) => 700 * (10 ** (m / 2595) - 1);
const points = Float64Array.from({ length: 42 }, (_, i) => hz(mel(30) + (mel(7800) - mel(30)) * i / 41));
const filters = Array.from({ length: 40 }, (_, k) => Float64Array.from({ length: BINS }, (_, i) => {
  const f = i * RATE / FRAME; return Math.max(0, Math.min((f - points[k]) / (points[k + 1] - points[k]), (points[k + 2] - f) / (points[k + 2] - points[k + 1])));
}));
const dct = Array.from({ length: 13 }, (_, k) => Float64Array.from({ length: 40 }, (_, i) => Math.sqrt(2 / 40) * Math.cos(Math.PI * (k + 1) * (i + .5) / 40)));
function spectrum(input: Float32Array, offset: number, re: Float64Array, im: Float64Array) {
  im.fill(0); for (let i = 0; i < FRAME; i++) re[reverse[i]] = input[offset + i] * window[i];
  for (let size = 2; size <= FRAME; size *= 2) {
    const half = size / 2, stride = FRAME / size;
    for (let start = 0; start < FRAME; start += size) for (let j = 0; j < half; j++) {
      const a = start + j, b = a + half, k = j * stride;
      const tr = cosine[k] * re[b] - sine[k] * im[b], ti = cosine[k] * im[b] + sine[k] * re[b];
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}
function quantile(sorted: number[], q: number) {
  const z = (sorted.length - 1) * q, lo = Math.floor(z); return sorted[lo] + (sorted[Math.ceil(z)] - sorted[lo]) * (z - lo);
}
function stats(values: number[]) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  const sorted = values.slice().sort((a, b) => a - b); return [mean, std, quantile(sorted, .1), quantile(sorted, .5), quantile(sorted, .9)];
}
/** Matches scipy.find_peaks(height=median+2*std, distance=3), including plateaus. */
function attacks(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b), mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  const height = quantile(sorted, .5) + 2 * std, candidates: number[] = [];
  for (let i = 1; i < values.length - 1; i++) if (values[i] > values[i - 1]) {
    let end = i; while (end + 1 < values.length && values[end + 1] === values[i]) end++;
    if (end < values.length - 1 && values[end] > values[end + 1] && values[i] >= height) candidates.push(Math.floor((i + end) / 2));
    i = end;
  }
  const accepted: number[] = [];
  for (const i of candidates.sort((a, b) => values[b] - values[a] || b - a)) if (accepted.every(j => Math.abs(i - j) >= 3)) accepted.push(i);
  return accepted.length;
}
/** Bounded first-window input. Unknown source/effect/character truth is never generated. */
export function extractTemporalFeatures(samples: Float32Array, sampleRate = RATE): number[] {
  if (sampleRate !== RATE || !samples.length || samples.length > RATE * 10 || !samples.every(Number.isFinite)) throw new Error('Temporal features require finite, bounded mono16k PCM');
  let input = samples;
  if (input.length < FRAME) { input = new Float32Array(FRAME); input.set(samples); }
  const columns: number[][] = Array.from({ length: 24 }, () => []), fluxValues: number[] = [], rmsValues: number[] = [];
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME), power = new Float64Array(BINS), magnitude = new Float64Array(BINS), previous = new Float64Array(BINS);
  for (let offset = 0; offset + FRAME <= input.length; offset += HOP) {
    spectrum(input, offset, re, im);
    let sum = 0, squares = 0, crossing = 0, peak = 0, centroid = 0, logSum = 0, high = 0, low = 0;
    for (let i = 0; i < FRAME; i++) { const v = input[offset + i]; squares += v * v; peak = Math.max(peak, Math.abs(v)); if (i && input[offset + i - 1] * v < 0) crossing++; }
    for (let i = 0; i < BINS; i++) { const p = re[i] ** 2 + im[i] ** 2; magnitude[i] = Math.sqrt(p); power[i] = p + 1e-20; sum += power[i]; logSum += Math.log(power[i]); }
    const norm = Math.sqrt(sum), rms = Math.sqrt(squares / FRAME + 1e-20);
    let entropy = 0, cumulative = 0, rolloff = -1, flux = 0;
    for (let i = 0; i < BINS; i++) {
      const f = i * RATE / FRAME, distribution = power[i] / sum; centroid += distribution * f; entropy -= distribution * Math.log(distribution);
      cumulative += distribution; if (rolloff < 0 && cumulative >= .85) rolloff = f;
      if (f > 4000) high += power[i]; if (f < 250) low += power[i];
      const v = magnitude[i] / (norm + 1e-20), difference = Math.max(0, v - previous[i]); flux += difference ** 2; previous[i] = v;
    }
    let spread = 0; for (let i = 0; i < BINS; i++) spread += power[i] / sum * (i * RATE / FRAME - centroid) ** 2;
    flux = offset ? Math.sqrt(flux / BINS) : 0; fluxValues.push(flux); rmsValues.push(rms);
    const logMel = filters.map(filter => Math.log(filter.reduce((a, w, i) => a + w * power[i], 0) + 1e-20));
    for (let k = 0; k < 13; k++) columns[k].push(dct[k].reduce((a, w, i) => a + w * logMel[i], 0));
    const metrics = [Math.log(rms), crossing / (FRAME - 1), centroid / RATE, Math.sqrt(spread) / RATE, rolloff / RATE, Math.exp(logSum / BINS) / (sum / BINS), entropy / Math.log(BINS), flux, high / sum, low / sum, peak / (rms + 1e-20)];
    metrics.forEach((v, i) => columns[13 + i].push(v));
  }
  const result = columns.flatMap(stats), energy: number[] = []; let start = 0, total = 0, peak = 0;
  const width = Math.floor(input.length / 10), remainder = input.length % 10;
  for (let block = 0; block < 10; block++) { const end = start + width + (block < remainder ? 1 : 0); let sum = 0; for (let i = start; i < end; i++) { sum += input[i] ** 2; peak = Math.max(peak, Math.abs(input[i])); } energy.push(sum); total += sum; start = end; }
  result.push(...energy.map(v => v / (total + 1e-20)));
  const maxRms = Math.max(...rmsValues);
  result.push(attacks(fluxValues) / (input.length / RATE), rmsValues.filter(v => v >= maxRms * .1).length / rmsValues.length, peak / (Math.sqrt(total / input.length) + 1e-20));
  if (result.length !== 133 || !result.every(Number.isFinite)) throw new Error('Invalid temporal feature output');
  return result;
}
