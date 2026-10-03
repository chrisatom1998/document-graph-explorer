export interface PcmAudio { sampleRate: number; channels: readonly Float32Array[] }
export interface Fingerprint {
  version: 1;
  hopSeconds: number;
  durationSeconds: number;
  frames: Float32Array[];
  envelope: Float32Array;
  stereoWidth: Float32Array;
  summary: Float32Array;
}
const RATE = 8192;
const SIZE = 2048;
const HOP = 256;
const BINS = 72; // Semitone bins from 64 Hz, six octaves.
const MAX_SECONDS = 20;

function powerSpectrum(signal: Float32Array, start: number): Float64Array {
  const real = new Float64Array(SIZE); const imag = new Float64Array(SIZE);
  for (let i = 0; i < SIZE; i++) real[i] = (signal[start + i] ?? 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SIZE - 1)));
  for (let i = 1, j = 0; i < SIZE; i++) {
    let bit = SIZE >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let length = 2; length <= SIZE; length <<= 1) {
    const angle = -2 * Math.PI / length;
    for (let start = 0; start < SIZE; start += length) {
      for (let j = 0; j < length / 2; j++) {
        const a = start + j; const b = a + length / 2;
        const c = Math.cos(angle * j); const s = Math.sin(angle * j);
        const r = real[b] * c - imag[b] * s; const im = real[b] * s + imag[b] * c;
        real[b] = real[a] - r; imag[b] = imag[a] - im; real[a] += r; imag[a] += im;
      }
    }
  }
  return Float64Array.from(real.slice(0, SIZE / 2 + 1), (v, i) => v * v + imag[i] * imag[i]);
}

/** Bounded local DSP, no model, external upload, or implicit source attribution. */
export function fingerprint(audio: PcmAudio): Fingerprint {
  const length = audio.channels[0]?.length ?? 0;
  if (!Number.isFinite(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 384000 || !length || audio.channels.length > 32 || audio.channels.some(c => c.length !== length || c.some(v => !Number.isFinite(v)))) throw new Error('invalid PCM');
  if (length / audio.sampleRate > MAX_SECONDS) throw new Error('select a clip of at most 20 seconds');
  // Windowed sinc low-pass resampling prevents high frequencies aliasing into the fingerprint.
  const count = Math.floor(length * RATE / audio.sampleRate);
  const mono = new Float32Array(count); const side = new Float32Array(count);
  const cutoff = Math.min(1, RATE / audio.sampleRate) * 0.9;
  const radius = Math.ceil(12 / cutoff);
  for (let i = 0; i < count; i++) {
    const position = i * audio.sampleRate / RATE;
    let sum = 0; let weight = 0; let difference = 0;
    for (let j = Math.max(0, Math.ceil(position - radius)); j <= Math.min(length - 1, Math.floor(position + radius)); j++) {
      const distance = j - position;
      const x = Math.PI * distance * cutoff;
      const w = (Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x) * (0.5 + 0.5 * Math.cos(Math.PI * distance / radius));
      let mixed = 0;
      for (const channel of audio.channels) mixed += channel[j] / audio.channels.length;
      sum += mixed * w; weight += w;
      if (audio.channels.length >= 2) difference += (audio.channels[0][j] - audio.channels[1][j]) * 0.5 * w;
    }
    mono[i] = sum / weight; side[i] = difference / weight;
  }
  if (count < SIZE) throw new Error('clip must contain at least 0.25 seconds');
  const frames: Float32Array[] = []; const energies: number[] = []; const widths: number[] = [];
  for (let start = 0; start + SIZE <= count; start += HOP) {
    const spectrum = powerSpectrum(mono, start); const bins = new Float32Array(BINS);
    for (let i = 1; i < spectrum.length; i++) {
      const bin = 12 * Math.log2(i * RATE / SIZE / 64);
      const lower = Math.floor(bin); const fraction = bin - lower;
      if (lower >= 0 && lower < BINS) bins[lower] += spectrum[i] * (1 - fraction);
      if (lower + 1 >= 0 && lower + 1 < BINS) bins[lower + 1] += spectrum[i] * fraction;
    }
    let norm = 0;
    for (let i = 0; i < BINS; i++) { bins[i] = Math.sqrt(bins[i]); norm += bins[i] ** 2; }
    norm = Math.sqrt(norm);
    if (norm > 1e-8) for (let i = 0; i < BINS; i++) bins[i] /= norm;
    frames.push(bins);
    let energy = 0; let sideEnergy = 0;
    for (let i = start; i < start + SIZE; i++) { energy += mono[i] ** 2; sideEnergy += side[i] ** 2; }
    energies.push(Math.sqrt(energy / SIZE)); widths.push(Math.sqrt(sideEnergy / (energy + sideEnergy + 1e-12)));
  }
  const summary = new Float32Array(BINS);
  for (const frame of frames) for (let i = 0; i < BINS; i++) summary[i] += frame[i] / frames.length;
  return { version: 1, hopSeconds: HOP / RATE, durationSeconds: length / audio.sampleRate, frames, envelope: Float32Array.from(energies), stereoWidth: Float32Array.from(widths), summary };
}

export function validateFingerprint(value: Fingerprint): void {
  if (value.version !== 1 || value.hopSeconds !== HOP / RATE || !Number.isFinite(value.durationSeconds) || value.durationSeconds < 0.25 || value.durationSeconds > MAX_SECONDS || !value.frames.length || value.frames.length !== Math.floor((Math.floor(value.durationSeconds * RATE) - SIZE) / HOP) + 1 || value.envelope.length !== value.frames.length || value.stereoWidth.length !== value.frames.length || value.summary.length !== BINS || [...value.frames, value.envelope, value.stereoWidth, value.summary].some(a => a.some(v => !Number.isFinite(v) || v < 0)) || value.frames.some(f => f.length !== BINS)) throw new Error('incompatible or invalid fingerprint');
}

export function spectralCosine(a: Float32Array, b: Float32Array, shift: number): number {
  let dot = 0; let aa = 0; let bb = 0;
  // Norms include unmatched edge bins so truncation cannot manufacture a perfect match.
  for (let i = 0; i < a.length; i++) { aa += a[i] ** 2; bb += b[i] ** 2; const j = i - shift; if (j >= 0 && j < b.length) dot += a[i] * b[j]; }
  return aa && bb ? Math.min(1, dot / Math.sqrt(aa * bb)) : 0;
}
