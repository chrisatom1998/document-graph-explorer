/** Version print: a small time series of what a recording plays (pitch classes), how it is
 * mixed (band balance) and how loud it is, two frames per second. Two files of the same
 * recording line up frame by frame even after re-encoding, trimming, a pitch or tempo shift;
 * a remix lines up only in places (shared vocal or melody) and is mixed differently.
 * Local DSP only; no model, upload or source attribution. */
export const VERSION_PRINT_SAMPLE_RATE = 16000;
export const VERSION_PRINT_FRAME_SECONDS = .5;
export const VERSION_PRINT_MAX_SECONDS = 480;
const FRAME = VERSION_PRINT_SAMPLE_RATE * VERSION_PRINT_FRAME_SECONDS;
const FFT = 4096;
const SUBFRAMES = 4;
const CHROMA = 12, BANDS = 7, NIBBLES = CHROMA + BANDS + 1, BYTES = NIBBLES / 2;
const FORMAT = 1;
const MIN_FRAMES = 8;
/** Clips shorter than this get no print: too little to tell a copy from a lookalike. */
export const VERSION_PRINT_MIN_SECONDS = MIN_FRAMES * VERSION_PRINT_FRAME_SECONDS;
const BAND_EDGES = [30, 120, 250, 500, 1000, 2000, 4000, 8000];

let tables: { window: Float64Array; cos: Float64Array; sin: Float64Array; pitch: Int8Array; band: Int8Array } | undefined;
function fftTables() {
  if (tables) return tables;
  const window = Float64Array.from({ length: FFT }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / FFT));
  const cos = Float64Array.from({ length: FFT / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / FFT));
  const sin = Float64Array.from({ length: FFT / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / FFT));
  const pitch = new Int8Array(FFT / 2 + 1).fill(-1), band = new Int8Array(FFT / 2 + 1).fill(-1);
  for (let k = 1; k <= FFT / 2; k++) {
    const hz = k * VERSION_PRINT_SAMPLE_RATE / FFT;
    if (hz >= 110 && hz <= 3520) pitch[k] = ((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12;
    const b = BAND_EDGES.findIndex((edge, i) => i < BANDS && hz >= edge && hz < BAND_EDGES[i + 1]);
    band[k] = b;
  }
  return tables = { window, cos, sin, pitch, band };
}

function powerSpectrum(samples: Float32Array, start: number, real: Float64Array, imag: Float64Array): void {
  const { window, cos, sin } = fftTables();
  for (let i = 0; i < FFT; i++) { real[i] = (samples[start + i] ?? 0) * window[i]; imag[i] = 0; }
  for (let i = 1, j = 0; i < FFT; i++) {
    let bit = FFT >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = real[i]; real[i] = real[j]; real[j] = t; }
  }
  for (let size = 2; size <= FFT; size <<= 1) {
    const step = FFT / size, half = size >> 1;
    for (let start = 0; start < FFT; start += size) for (let j = 0; j < half; j++) {
      const a = start + j, b = a + half, c = cos[j * step], s = sin[j * step];
      const r = real[b] * c - imag[b] * s, im = real[b] * s + imag[b] * c;
      real[b] = real[a] - r; imag[b] = imag[a] - im; real[a] += r; imag[a] += im;
    }
  }
  for (let k = 0; k <= FFT / 2; k++) real[k] = real[k] * real[k] + imag[k] * imag[k];
}

const nibble = (value: number) => Math.max(0, Math.min(15, Math.round(value)));

/** Packed frames for mono 16 kHz samples that start on a frame boundary. Samples past the
 * end read as silence, so the caller may pass a little extra audio for the last windows. */
export function versionPrintFrames(samples: Float32Array, frames: number): Uint8Array {
  const { pitch, band } = fftTables();
  const out = new Uint8Array(frames * BYTES);
  const real = new Float64Array(FFT), imag = new Float64Array(FFT);
  const chroma = new Float64Array(CHROMA), bands = new Float64Array(BANDS), values = new Array<number>(NIBBLES);
  for (let f = 0; f < frames; f++) {
    chroma.fill(0); bands.fill(0);
    let total = 0, energy = 0;
    for (let s = 0; s < SUBFRAMES; s++) {
      powerSpectrum(samples, f * FRAME + s * FRAME / SUBFRAMES, real, imag);
      for (let k = 1; k <= FFT / 2; k++) {
        const p = real[k];
        if (pitch[k] >= 0) chroma[pitch[k]] += Math.sqrt(p);
        if (band[k] >= 0) { bands[band[k]] += p; total += p; }
      }
    }
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) energy += (samples[i] ?? 0) ** 2;
    const peak = Math.max(...chroma);
    for (let c = 0; c < CHROMA; c++) values[c] = peak > 0 ? nibble(15 * Math.log1p(9 * chroma[c] / peak) / Math.log(10)) : 0;
    for (let b = 0; b < BANDS; b++) values[CHROMA + b] = total > 0 ? nibble((10 * Math.log10(bands[b] / total + 1e-12) + 45) / 3) : 0;
    values[NIBBLES - 1] = nibble((20 * Math.log10(Math.sqrt(energy / FRAME) + 1e-9) + 60) / 4);
    for (let n = 0; n < BYTES; n++) out[f * BYTES + n] = values[2 * n] << 4 | values[2 * n + 1];
  }
  return out;
}

const toBase64 = (bytes: Uint8Array) => { let text = ''; for (const b of bytes) text += String.fromCharCode(b); return btoa(text); };

/** Reads the recording in bounded sections and returns the encoded print, or undefined below four seconds. */
export async function computeVersionPrint(read: (start: number, seconds: number) => Promise<Float32Array>, duration: number, signal?: AbortSignal): Promise<string | undefined> {
  const frames = Math.floor(Math.min(duration, VERSION_PRINT_MAX_SECONDS) / VERSION_PRINT_FRAME_SECONDS);
  if (!Number.isFinite(frames) || frames < MIN_FRAMES) return;
  const bytes = new Uint8Array(1 + frames * BYTES);
  bytes[0] = FORMAT;
  const CHUNK = 60;
  for (let first = 0; first < frames; first += CHUNK) {
    signal?.throwIfAborted();
    const count = Math.min(CHUNK, frames - first), start = first * VERSION_PRINT_FRAME_SECONDS;
    const samples = await read(start, Math.min(duration - start, count * VERSION_PRINT_FRAME_SECONDS + FFT / VERSION_PRINT_SAMPLE_RATE));
    bytes.set(versionPrintFrames(samples, count), 1 + first * BYTES);
  }
  return toBase64(bytes);
}

const MAX_TEXT = Math.ceil((1 + VERSION_PRINT_MAX_SECONDS / VERSION_PRINT_FRAME_SECONDS * BYTES) / 3) * 4;
/** Persisted prints are untrusted: keep only a well-formed current-format string. */
export function sanitizeVersionPrint(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_TEXT || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return;
  try {
    const text = atob(value);
    return text.charCodeAt(0) === FORMAT && (text.length - 1) % BYTES === 0 && (text.length - 1) / BYTES >= MIN_FRAMES ? value : undefined;
  } catch { return; }
}

export interface DecodedVersionPrint {
  frames: number;
  /** Mean-removed, unit-length pitch-class profile per frame; zero where the frame is silent or flat. */
  chroma: Float32Array;
  /** Mean-removed, unit-length band balance per frame. */
  bands: Float32Array;
  active: Uint8Array;
}
function unitRows(values: Float32Array, width: number, rows: number, active: Uint8Array): void {
  for (let r = 0; r < rows; r++) {
    let mean = 0, norm = 0;
    for (let i = 0; i < width; i++) mean += values[r * width + i] / width;
    for (let i = 0; i < width; i++) { values[r * width + i] -= mean; norm += values[r * width + i] ** 2; }
    norm = Math.sqrt(norm);
    if (norm < .5) { active[r] = 0; for (let i = 0; i < width; i++) values[r * width + i] = 0; }
    else for (let i = 0; i < width; i++) values[r * width + i] /= norm;
  }
}
export function decodeVersionPrint(value: string): DecodedVersionPrint | undefined {
  if (!sanitizeVersionPrint(value)) return;
  const text = atob(value), frames = (text.length - 1) / BYTES;
  const chroma = new Float32Array(frames * CHROMA), bands = new Float32Array(frames * BANDS), active = new Uint8Array(frames);
  for (let f = 0; f < frames; f++) {
    const at = (n: number) => { const byte = text.charCodeAt(1 + f * BYTES + (n >> 1)); return n & 1 ? byte & 15 : byte >> 4; };
    for (let c = 0; c < CHROMA; c++) chroma[f * CHROMA + c] = at(c);
    for (let b = 0; b < BANDS; b++) bands[f * BANDS + b] = at(CHROMA + b);
    // Below about -48 dB a frame is silence or a fade tail, not material to match.
    active[f] = at(NIBBLES - 1) >= 3 ? 1 : 0;
  }
  unitRows(chroma, CHROMA, frames, active);
  const bandActive = new Uint8Array(frames).fill(1);
  unitRows(bands, BANDS, frames, bandActive);
  return { frames, chroma, bands, active };
}

/** `factor` frames averaged into one step for the coarse search. */
function pooled(print: DecodedVersionPrint, factor: number): DecodedVersionPrint {
  if (factor === 1) return print;
  const frames = Math.floor(print.frames / factor);
  const chroma = new Float32Array(frames * CHROMA), active = new Uint8Array(frames);
  for (let f = 0; f < frames; f++) {
    let norm = 0;
    for (let k = f * factor; k < (f + 1) * factor; k++) if (print.active[k]) for (let c = 0; c < CHROMA; c++) chroma[f * CHROMA + c] += print.chroma[k * CHROMA + c];
    for (let c = 0; c < CHROMA; c++) norm += chroma[f * CHROMA + c] ** 2;
    norm = Math.sqrt(norm);
    if (norm < 1e-6) continue;
    for (let c = 0; c < CHROMA; c++) chroma[f * CHROMA + c] /= norm;
    active[f] = 1;
  }
  return { frames, chroma, bands: new Float32Array(0), active };
}

export interface VersionComparison {
  /** Best ten-to-twenty-second stretch of matching pitch content, -1 to 1. */
  window: number;
  /** Fraction of the shorter recording's audible frames that line up with the other recording. */
  coverage: number;
  /** Band balance agreement on the matched frames, -1 to 1: high for the same mix, lower for a remix. */
  timbre: number;
  /** The second recording's playback speed relative to the first (1.05 = 5% faster). */
  tempoRatio: number;
  /** The second recording's pitch relative to the first, in semitones (-5 to 6). */
  semitones: number;
  /** Where the first recording's start falls in the second, in seconds (negative = before it starts). */
  offsetSeconds: number;
}

/** Playback speeds tried: DJ pitch faders and edits stay within about 15%. */
const SLOPES = Array.from({ length: 17 }, (_, i) => Math.round((.86 + i * .02) * 1000) / 1000);
/** Similarity a matched frame needs (after five-frame smoothing) to count toward coverage. */
const COVER_FLOOR = .55;
/** Below this coarse match nothing downstream can fire, so the full-resolution pass is skipped. */
const FINE_FLOOR = .5;

/** Similarity of each frame pair on the line j = offset + slope * i; NaN where either is silent or outside. */
function lineValues(a: DecodedVersionPrint, b: DecodedVersionPrint, shift: number, slope: number, offset: number, out: Float32Array): Float32Array {
  for (let i = 0; i < a.frames; i++) {
    const j = Math.round(offset + slope * i);
    if (j < 0 || j >= b.frames || !a.active[i] || !b.active[j]) { out[i] = NaN; continue; }
    let dot = 0;
    for (let c = 0; c < CHROMA; c++) dot += a.chroma[i * CHROMA + c] * b.chroma[j * CHROMA + (c + shift) % CHROMA];
    out[i] = dot;
  }
  return out;
}
/** Best sliding-window mean of a line's values (at least three quarters of the window audible). */
function bestWindow(values: Float32Array, rows: number, width: number): number {
  let best = -Infinity, sum = 0, count = 0;
  for (let i = 0; i < rows; i++) {
    const v = values[i];
    if (v === v) { sum += v; count++; }
    if (i >= width) { const old = values[i - width]; if (old === old) { sum -= old; count--; } }
    if (i >= width - 1 && count >= .75 * width) { const mean = sum / count; if (mean > best) best = mean; }
  }
  return best;
}
/** Five-frame smoothing; NaN stays NaN. */
function smooth(raw: Float32Array, rows: number): Float32Array {
  const out = new Float32Array(rows);
  for (let i = 0; i < rows; i++) {
    let sum = 0, count = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(rows - 1, i + 2); k++) if (raw[k] === raw[k]) { sum += raw[k]; count++; }
    out[i] = raw[i] !== raw[i] || count < 3 ? NaN : sum / count;
  }
  return out;
}

type Line = { score: number; raw: number; shift: number; slope: number; offset: number };
const SILENT = -2;
/** Every line j = offset + slope * i through the frame-similarity grid: the best twenty-second stretch (`local`)
 * and the best line over the whole shorter recording (`whole`), with per-line window scores for edits.
 * Hot loop: one pass per line, silent cells marked by a sentinel rather than NaN. */
function scanLines(ca: DecodedVersionPrint, cb: DecodedVersionPrint, shifts: number[], slopes: number[], width: number) {
  const rows = ca.frames, cols = cb.frames;
  const coarseActive = ca.active.reduce((s, v) => s + v, 0);
  const grid = new Float32Array(rows * cols), steps = new Int32Array(rows);
  const need = .75 * width;
  let local: Line = { score: -Infinity, raw: -Infinity, shift: 0, slope: 1, offset: 0 }, whole = { ...local };
  const offsetsBy = new Map<string, { offset: number; score: number }[]>(), byShift = new Map<number, number>();
  for (const shift of shifts) {
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      if (!ca.active[i] || !cb.active[j]) { grid[i * cols + j] = SILENT; continue; }
      let dot = 0;
      for (let c = 0; c < CHROMA; c++) dot += ca.chroma[i * CHROMA + c] * cb.chroma[j * CHROMA + (c + shift) % CHROMA];
      grid[i * cols + j] = dot;
    }
    for (const slope of slopes) {
      for (let i = 0; i < rows; i++) steps[i] = Math.round(slope * i);
      const found: { offset: number; score: number }[] = [];
      // Repeating material (loops, choruses) fits several speeds equally well: prefer no change.
      const prior = .02 * Math.abs(Math.log(slope)) + (shift ? .01 : 0);
      let first = rows, last = rows;
      for (let offset = -steps[rows - 1]; offset < cols; offset++) {
        // Rows whose column falls inside the grid; outside them a window only loses cells.
        while (first > 0 && offset + steps[first - 1] >= 0) first--;
        while (last > 0 && offset + steps[last - 1] >= cols) last--;
        if (last - first < need) continue;
        let sum = 0, count = 0, wsum = 0, wcount = 0, raw = -Infinity;
        for (let i = first; i < last; i++) {
          const v = grid[i * cols + offset + steps[i]];
          if (v > SILENT) { sum += v; count++; wsum += v; wcount++; }
          if (i - first >= width) { const old = grid[(i - width) * cols + offset + steps[i - width]]; if (old > SILENT) { wsum -= old; wcount--; } }
          if (i - first >= width - 1 && wcount >= need) { const mean = wsum / wcount; if (mean > raw) raw = mean; }
        }
        if (raw === -Infinity) continue;
        found.push({ offset, score: raw });
        if (raw - prior > local.score) local = { score: raw - prior, raw, shift, slope, offset };
        // The whole-recording line rewards length: a copy lines up end to end, a remix only in places.
        const full = sum / count * Math.sqrt(count / coarseActive) - prior;
        if (full > whole.score) whole = { score: full, raw: sum / count, shift, slope, offset };
        if (full > (byShift.get(shift) ?? -Infinity)) byShift.set(shift, full);
      }
      offsetsBy.set(`${shift}:${slope}`, found);
    }
  }
  return { local, whole, offsetsBy, byShift };
}

/** Align two prints over pitch shift, playback speed and start offset. Undefined when either is too short.
 * A coarse pass (two-second steps for songs) finds the lines: the one that holds over the whole shorter
 * recording (copies) and the best twenty-second stretch (remixes). The full-resolution pass measures along them. */
export function compareVersionPrints(first: DecodedVersionPrint, second: DecodedVersionPrint): VersionComparison | undefined {
  const swap = first.frames > second.frames;
  const a = swap ? second : first, b = swap ? first : second;
  const activeA = a.active.reduce((s, v) => s + v, 0);
  if (activeA < MIN_FRAMES || b.active.reduce((s, v) => s + v, 0) < MIN_FRAMES) return;
  const factor = a.frames >= 64 ? 4 : a.frames >= 24 ? 2 : 1;
  const ca = pooled(a, factor), cb = pooled(b, factor);
  const width = Math.max(3, Math.min(Math.round(20 / VERSION_PRINT_FRAME_SECONDS / factor), Math.round(.6 * ca.frames)));
  // Every pitch shift is tried on a rougher grid first (four-second steps for songs); the three best go to the coarse pass.
  let shifts = [...Array(CHROMA).keys()], slopes = SLOPES;
  if (factor === 4 && a.frames >= 128) {
    const ra = pooled(a, 8), rb = pooled(b, 8);
    const rough = scanLines(ra, rb, shifts, SLOPES.filter((_, i) => i % 2 === 0), Math.max(3, Math.round(width / 2)));
    shifts = [...rough.byShift].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([shift]) => shift);
    slopes = SLOPES.filter(slope => [rough.whole.slope, rough.local.slope].some(near => Math.abs(slope - near) <= .045));
  }
  const { local, whole, offsetsBy } = scanLines(ca, cb, shifts, slopes, width);
  if (!Number.isFinite(local.score)) return;
  const report = (window: number, coverage: number, timbre: number, shift: number, slope: number, offset: number): VersionComparison => {
    // Slope maps the shorter print onto the longer one; express everything as second relative to first.
    const semitone = (swap ? CHROMA - shift : shift) % CHROMA, startInB = offset * VERSION_PRINT_FRAME_SECONDS;
    return { window, coverage, timbre, tempoRatio: Math.round((swap ? slope : 1 / slope) * 1000) / 1000,
      semitones: semitone > 6 ? semitone - CHROMA : semitone, offsetSeconds: swap ? -startInB / slope : startInB };
  };
  if (local.raw < FINE_FLOOR) return report(local.raw, 0, 0, local.shift, local.slope, local.offset * factor);
  // Refine the whole-recording line at full resolution: slope in half-percent steps, offset in frames.
  const fineWidth = Math.max(8, Math.min(40, Math.round(.6 * a.frames)));
  const line = new Float32Array(a.frames);
  const shift = whole.shift;
  let fine = { score: -Infinity, slope: whole.slope, offset: whole.offset * factor };
  for (let slope = whole.slope - .015; slope <= whole.slope + .0151; slope += .005) {
    for (let offset = whole.offset * factor - factor - 1; offset <= whole.offset * factor + factor + 1; offset++) {
      lineValues(a, b, shift, slope, offset, line);
      let sum = 0, count = 0;
      for (let i = 0; i < a.frames; i++) if (line[i] === line[i]) { sum += line[i]; count++; }
      const score = count >= Math.min(fineWidth, .5 * activeA) ? sum / count * Math.sqrt(count / activeA) - .02 * Math.abs(Math.log(slope)) : -Infinity;
      if (score > fine.score) fine = { score, slope, offset };
    }
  }
  if (!Number.isFinite(fine.score)) return report(local.raw, 0, 0, local.shift, local.slope, local.offset * factor);
  // Edits remove or repeat sections: the next-best offsets at the same speed may cover the rest.
  const tops = [...(offsetsBy.get(`${shift}:${whole.slope}`) ?? [])].sort((x, y) => y.score - x.score);
  const others = tops.filter((t, k) => Math.abs(t.offset - whole.offset) > 2 && tops.slice(0, k).every(u => Math.abs(u.offset - t.offset) > 2)).slice(0, 3);
  const profiles = [{ offset: fine.offset, profile: smooth(lineValues(a, b, shift, fine.slope, fine.offset, new Float32Array(a.frames)), a.frames) }];
  let windowBest = bestWindow(lineValues(a, b, shift, fine.slope, fine.offset, line), a.frames, fineWidth);
  const nearby = (lineShift: number, slope: number, around: number) => {
    let pick = { offset: around, score: -Infinity };
    for (let offset = around - factor; offset <= around + factor; offset++) {
      const score = bestWindow(lineValues(a, b, lineShift, slope, offset, line), a.frames, fineWidth);
      if (score > pick.score) pick = { offset, score };
    }
    return pick;
  };
  for (const other of others) {
    const pick = nearby(shift, fine.slope, other.offset * factor);
    windowBest = Math.max(windowBest, pick.score);
    profiles.push({ offset: pick.offset, profile: smooth(lineValues(a, b, shift, fine.slope, pick.offset, new Float32Array(a.frames)), a.frames) });
  }
  // The best local stretch may sit on another line entirely (a remix reuses a hook at a new tempo).
  windowBest = Math.max(windowBest, nearby(local.shift, local.slope, local.offset * factor).score);
  let covered = 0, timbre = 0;
  for (let i = 0; i < a.frames; i++) {
    if (!a.active[i]) continue;
    let top = -Infinity, at = -1;
    for (const { offset, profile } of profiles) if (profile[i] > top) { top = profile[i]; at = Math.round(offset + fine.slope * i); }
    if (top < COVER_FLOOR) continue;
    covered++;
    let dot = 0;
    for (let k = 0; k < BANDS; k++) dot += a.bands[i * BANDS + k] * b.bands[at * BANDS + k];
    timbre += dot;
  }
  return report(windowBest, covered / activeA, covered ? timbre / covered : 0, shift, fine.slope, fine.offset);
}
