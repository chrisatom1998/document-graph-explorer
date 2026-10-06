/** Track structure for DJ mix points: intro, buildups, drops, breakdowns and outro, from signal processing only.
 * The whole recording is read once at 16 kHz in bounded chunks and reduced to a few band energies per quarter
 * second; the decision below works on those numbers alone, so the offline evaluation (scripts/structure-evaluate.ts) runs the
 * same code on the same features. A drop is the loud, full-bass part of an EDM track; the detector looks for long
 * runs of high "intensity" (bass + loudness + kick density) separated by quieter runs. */
export const STRUCTURE_RATE = 16000;
export const STRUCTURE_REVISION = 1;
/** Shorter recordings (loops, one-shots, previews of a single section) get no structure. */
export const STRUCTURE_MIN_SECONDS = 60;
const FRAME = 1024, HOP = 512, BLOCK_FRAMES = 8; // 32 ms hops, 0.256 s blocks
export const STRUCTURE_BLOCK_SECONDS = HOP * BLOCK_FRAMES / STRUCTURE_RATE;
/** Band edges in Hz: sub, bass, low-mid, mid, high. */
const BANDS = [[30, 100], [100, 250], [250, 1000], [1000, 3500], [3500, 8000]] as const;
export const STRUCTURE_FEATURES = ['sub', 'bass', 'lowMid', 'mid', 'high', 'loud', 'kick', 'flux'] as const;
export type SectionLabel = 'intro' | 'buildup' | 'drop' | 'breakdown' | 'outro';
export interface TrackSection { start: number; end: number; label: SectionLabel }
export interface TrackStructure { revision: number; sections: TrackSection[]; drops: number[] }

function fftInPlace(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** Streams 16 kHz mono PCM into per-block features (log band energies, loudness, kick and spectral flux). */
export class StructureFeatures {
  private tail = new Float32Array(0);
  private window = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FRAME));
  private re = new Float64Array(FRAME); private im = new Float64Array(FRAME);
  private prev = new Float64Array(FRAME / 2); private hasPrev = false;
  private acc = new Float64Array(STRUCTURE_FEATURES.length); private accFrames = 0;
  private bins = BANDS.map(([lo, hi]) => [Math.max(1, Math.round(lo * FRAME / STRUCTURE_RATE)), Math.round(hi * FRAME / STRUCTURE_RATE)] as const);
  /** Band index of each FFT bin, -1 outside every band. */
  private bandOf = Int8Array.from({ length: FRAME / 2 }, (_, k) => this.bins.findIndex(([lo, hi]) => k >= lo && k < hi));
  readonly blocks: number[][] = [];

  add(samples: Float32Array) {
    const data = new Float32Array(this.tail.length + samples.length);
    data.set(this.tail); data.set(samples, this.tail.length);
    let offset = 0;
    for (; offset + FRAME <= data.length; offset += HOP) this.frame(data, offset);
    this.tail = data.slice(offset);
  }

  private frame(data: Float32Array, offset: number) {
    const { re, im, prev } = this;
    for (let i = 0; i < FRAME; i++) { re[i] = data[offset + i] * this.window[i]; im[i] = 0; }
    fftInPlace(re, im);
    let total = 0, flux = 0, kick = 0;
    const band = new Float64Array(BANDS.length);
    for (let k = 1; k < FRAME / 2; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const power = mag * mag; total += power;
      const b = this.bandOf[k]; if (b >= 0) band[b] += power;
      if (this.hasPrev) {
        const rise = Math.log1p(mag) - Math.log1p(prev[k]);
        if (rise > 0) { flux += rise; if (k < this.bins[1][1]) kick += rise; }
      }
      prev[k] = mag;
    }
    this.hasPrev = true;
    const db = (p: number) => 10 * Math.log10(p + 1e-9);
    for (let b = 0; b < BANDS.length; b++) this.acc[b] += db(band[b]);
    this.acc[5] += db(total); this.acc[6] += kick; this.acc[7] += flux;
    if (++this.accFrames === BLOCK_FRAMES) {
      this.blocks.push(Array.from(this.acc, v => Math.round(v / BLOCK_FRAMES * 100) / 100));
      this.acc.fill(0); this.accFrames = 0;
    }
  }
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] : 0;
};
const movingMean = (v: number[], radius: number) => {
  const prefix = [0]; for (const x of v) prefix.push(prefix[prefix.length - 1] + x);
  return v.map((_, i) => { const a = Math.max(0, i - radius), b = Math.min(v.length, i + radius + 1); return (prefix[b] - prefix[a]) / (b - a); });
};
export interface StructureParams {
  /** Weight of each feature (STRUCTURE_FEATURES order) in the intensity curve. */
  weights: number[];
  /** Seconds of intensity compared before and after a candidate boundary. */
  stepSeconds: number;
  /** Minimum rise in intensity (0..1 scale) for a drop to start, and fall for it to end. */
  minRise: number;
  /** Intensity the part after a drop entry must reach, as a quantile of the track's intensity. */
  dropLevel: number;
  minGapSeconds: number;
  /** A rise followed within this many seconds by a rise to a clearly higher level is a buildup, not a drop. */
  buildupSeconds: number;
  /** How much higher (0..1 scale) the later level must be for the earlier rise to count as a buildup. */
  buildupMargin: number;
  /** The first drop never comes before this fraction of the track (DJ intros; 5% of the labelled first drops come earlier). */
  firstDropMinFraction: number;
  /** Seconds either side of a coarse drop start searched for the bass entry. */
  refineSeconds: number;
}
/** Tuned on Raveform folds 0-3 (153 tracks), docs/evaluations/structure-2026-10-06. */
export const DEFAULT_STRUCTURE_PARAMS: StructureParams = {
  weights: [1, 1, 0, 0, 0, 1, 1, 0], stepSeconds: 12, minRise: 0.12, dropLevel: 0.3, minGapSeconds: 16,
  buildupSeconds: 64, buildupMargin: 0.03, firstDropMinFraction: 0.12, refineSeconds: 4,
};

/** Per-block intensity on a 0..1 scale for this track (each feature scaled from its 5th to 95th percentile). */
export function intensityCurve(blocks: number[][], params = DEFAULT_STRUCTURE_PARAMS): number[] {
  const used = params.weights.map((w, c) => [w, c] as const).filter(([w]) => w > 0);
  const total = used.reduce((a, [w]) => a + w, 0) || 1;
  const scaled = used.map(([, c]) => {
    const col = blocks.map(b => b[c]), lo = percentile(col, 0.05), hi = percentile(col, 0.95);
    return col.map(v => Math.min(1, Math.max(0, (v - lo) / Math.max(1e-6, hi - lo))));
  });
  return blocks.map((_, i) => scaled.reduce((sum, col, k) => sum + col[i] * used[k][0], 0) / total);
}

/** Drops start where intensity steps up to a high level and end where it steps back down; what lies between is
 * the intro, breakdowns and outro. Every drop start is then moved to the strongest bass entry nearby. */
export function detectStructure(blocks: number[][], params = DEFAULT_STRUCTURE_PARAMS): TrackStructure {
  const step = STRUCTURE_BLOCK_SECONDS, n = blocks.length;
  const empty: TrackStructure = { revision: STRUCTURE_REVISION, sections: [], drops: [] };
  if (n * step < STRUCTURE_MIN_SECONDS) return empty;
  const curve = movingMean(intensityCurve(blocks, params), Math.round(0.5 / step));
  const prefix = [0]; for (const v of curve) prefix.push(prefix[prefix.length - 1] + v);
  const mean = (a: number, b: number) => { a = Math.max(0, a); b = Math.min(n, b); return b > a ? (prefix[b] - prefix[a]) / (b - a) : 0; };
  const w = Math.max(1, Math.round(params.stepSeconds / step)), gap = Math.round(params.minGapSeconds / step);
  const level = percentile(curve, params.dropLevel);
  const rise = curve.map((_, i) => i < w || i > n - w ? 0 : mean(i, i + w) - mean(i - w, i));
  // Local maxima of the rise that reach a high level, strongest first, at least minGap apart.
  const candidates: number[] = [];
  for (let i = w; i <= n - w; i++) {
    if (rise[i] < params.minRise || mean(i, i + w) < level) continue;
    let peak = true;
    for (let k = Math.max(0, i - w); k <= Math.min(n - 1, i + w) && peak; k++) if (rise[k] > rise[i] || (rise[k] === rise[i] && k < i)) peak = false;
    if (peak) candidates.push(i);
  }
  const starts: number[] = [];
  for (const c of candidates.sort((a, b) => rise[b] - rise[a])) if (starts.every(s => Math.abs(s - c) >= gap)) starts.push(c);
  starts.sort((a, b) => a - b);
  const post = (i: number) => mean(i, i + w);
  const reachBuildup = Math.round(params.buildupSeconds / step);
  const buildups = new Set(starts.filter(a => starts.some(b => b > a && b - a <= reachBuildup && post(b) > post(a) + params.buildupMargin)));
  starts.splice(0, starts.length, ...starts.filter(a => !buildups.has(a) && a >= params.firstDropMinFraction * n));
  if (!starts.length) return empty;
  // Each drop runs until intensity falls back by minRise (or the next drop starts).
  const runs: [number, number][] = starts.map((a, k) => {
    const limit = k + 1 < starts.length ? starts[k + 1] : n;
    let b = limit;
    for (let i = a + w; i < limit; i++) if (-rise[i] >= params.minRise) { b = i; break; }
    return [a, b];
  });
  const bass = blocks.map(b => (b[0] + b[1]) / 2);
  const reach = Math.round(params.refineSeconds / step), half = Math.max(1, Math.round(1 / step));
  const drops = runs.map(([a, b], index) => {
    const lo = Math.max(index ? runs[index - 1][1] : 0, a - reach) + half, hi = Math.min(b - half, a + reach);
    let best = a, bestRise = -Infinity;
    for (let i = lo; i <= hi; i++) {
      let before = 0, after = 0;
      for (let k = 1; k <= half; k++) { before += bass[i - k] ?? bass[0]; after += bass[i + k - 1] ?? bass[n - 1]; }
      if (after - before > bestRise) { bestRise = after - before; best = i; }
    }
    return [best, b] as [number, number];
  });
  const sections: TrackSection[] = [];
  const at = (i: number) => Math.round(i * step * 100) / 100;
  let cursor = 0;
  drops.forEach(([a, b], index) => {
    if (a > cursor) sections.push({ start: at(cursor), end: at(a), label: index === 0 ? 'intro' : 'breakdown' });
    sections.push({ start: at(a), end: at(b), label: 'drop' });
    cursor = b;
  });
  if (cursor < n) sections.push({ start: at(cursor), end: at(n), label: 'outro' });
  return { revision: STRUCTURE_REVISION, sections: sections.filter(x => x.end - x.start >= step), drops: drops.map(([a]) => at(a)) };
}

const LABELS: readonly SectionLabel[] = ['intro', 'buildup', 'drop', 'breakdown', 'outro'];
/** Persisted structure is untrusted input: ordered, inside the recording, at most 64 sections. */
export function sanitizeStructure(raw: unknown, duration: number): TrackStructure | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= duration;
  if (typeof s.revision !== 'number' || !Number.isInteger(s.revision) || s.revision < 1 || s.revision > 1000 || !Array.isArray(s.sections) || !Array.isArray(s.drops)) return undefined;
  const sections: TrackSection[] = [];
  for (const v of s.sections.slice(0, 64)) {
    const x = v as Record<string, unknown> | null;
    if (!x || !time(x.start) || !time(x.end) || x.end <= x.start || !LABELS.includes(x.label as SectionLabel)) return undefined;
    if (sections.length && x.start < sections[sections.length - 1].end - 1e-6) return undefined;
    sections.push({ start: x.start, end: x.end, label: x.label as SectionLabel });
  }
  const drops = s.drops.slice(0, 64).filter(time).sort((a, b) => a - b);
  return { revision: s.revision, sections, drops };
}

/** Where a single ten-second description window should go: the first drop when one was found (the part with
 * every instrument playing), otherwise the middle of the recording. */
export function representativeStart(duration: number, structure?: TrackStructure): number | undefined {
  const drop = structure?.drops[0];
  return drop !== undefined && drop + 10 <= duration ? drop : undefined;
}
