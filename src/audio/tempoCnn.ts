// Learned tempo classifier (after Schreiber & Müller 2018), trained on DGE's tempo tuning clips only:
// models/tempo-cnn-2026-10-06 in the project files. Input features must match its feats.py exactly.
const RATE = 11025, DECIMATE = 4;   // from 44.1 kHz
const N = 1024, HOP = 512, BANDS = 40, FRAMES = 215, WINDOW_HOP = 107;
const MIN_BPM = 30, CLASSES = 256;
/** The CNN's tempo replaces the beat tracker's only when they disagree and the CNN is this sure (tuning clips only). */
export const CNN_OVERRIDE_CONFIDENCE = 0.5;

/** Kaiser-windowed sinc low-pass at 0.97 of the new Nyquist, close to ffmpeg's default resampler. */
const TAPS = (() => {
  const half = 32 * DECIMATE, cutoff = 0.97 / DECIMATE, beta = 9;
  const i0 = (x: number) => { let s = 1, t = 1; for (let k = 1; k < 50; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; };
  const h = Array.from({ length: 2 * half + 1 }, (_, j) => {
    const n = j - half, sinc = n === 0 ? cutoff : Math.sin(Math.PI * cutoff * n) / (Math.PI * n);
    return sinc * i0(beta * Math.sqrt(1 - (n / half) ** 2)) / i0(beta);
  });
  const sum = h.reduce((a, b) => a + b, 0);
  return h.map(v => v / sum);
})();

function resample(samples: Float32Array): Float32Array {
  const half = (TAPS.length - 1) / 2, out = new Float32Array(Math.ceil(samples.length / DECIMATE));
  for (let k = 0; k < out.length; k++) {
    let s = 0;
    const c = k * DECIMATE;
    for (let j = 0; j < TAPS.length; j++) {
      const i = c + j - half;
      if (i >= 0 && i < samples.length) s += TAPS[j] * samples[i];
    }
    out[k] = s;
  }
  return out;
}

const HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));

/** 40 triangular mel bands from 20 to 5000 Hz over the 513 FFT bins. */
const MEL = (() => {
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700), imel = (m: number) => 700 * (10 ** (m / 2595) - 1);
  const centers = Array.from({ length: BANDS + 2 }, (_, i) => imel(mel(20) + (mel(5000) - mel(20)) * i / (BANDS + 1)));
  const freqs = Array.from({ length: N / 2 + 1 }, (_, i) => i * RATE / N);
  return Array.from({ length: BANDS }, (_, b) => {
    const [lo, c, hi] = [centers[b], centers[b + 1], centers[b + 2]];
    const row = freqs.map(f => Math.max(0, Math.min((f - lo) / (c - lo), (hi - f) / (hi - c))));
    if (!row.some(v => v > 0)) row[freqs.reduce((best, f, i) => Math.abs(f - c) < Math.abs(freqs[best] - c) ? i : best, 0)] = 1;
    return row;
  });
})();

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array) {
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
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

/** Log mel frames (frames x 40) of 44.1 kHz mono audio at 11025 Hz, hop 512. */
export function tempoMel(samples: Float32Array): Float32Array[] {
  let y = resample(samples);
  if (y.length < N) { const padded = new Float32Array(N); padded.set(y); y = padded; }
  const frames: Float32Array[] = [];
  const re = new Float64Array(N), im = new Float64Array(N), mag = new Float64Array(N / 2 + 1);
  for (let start = 0; start + N <= y.length; start += HOP) {
    for (let i = 0; i < N; i++) { re[i] = y[start + i] * HANN[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= N / 2; k++) mag[k] = Math.hypot(re[k], im[k]) / Math.sqrt(N);
    frames.push(Float32Array.from(MEL, row => { let s = 0; for (let k = 0; k < row.length; k++) s += row[k] * mag[k]; return Math.log1p(1000 * s); }));
  }
  return frames;
}

/** 10 s model windows (215 frames, hop 107), zero-padded when the audio is shorter. */
export function tempoWindows(frames: Float32Array[]): Float32Array[] {
  const blank = new Float32Array(BANDS);
  const window = (o: number) => {
    const w = new Float32Array(FRAMES * BANDS);
    for (let t = 0; t < FRAMES; t++) w.set(frames[o + t] ?? blank, t * BANDS);
    return w;
  };
  if (frames.length <= FRAMES) return [window(0)];
  const out: Float32Array[] = [];
  for (let o = 0; o + FRAMES <= frames.length; o += WINDOW_HOP) out.push(window(o));
  return out;
}

/** Tempo from logits ([windows, 256]): argmax of the window-averaged softmax, and the top-3 mass within 4% of it. */
export function cnnTempo(logits: Float32Array, windows: number): { bpm: number; confidence: number } {
  const mean = new Float64Array(CLASSES);
  for (let w = 0; w < windows; w++) {
    const row = logits.subarray(w * CLASSES, (w + 1) * CLASSES);
    const top = Math.max(...row), e = Array.from(row, v => Math.exp(v - top)), sum = e.reduce((a, b) => a + b, 0);
    for (let k = 0; k < CLASSES; k++) mean[k] += e[k] / sum / windows;
  }
  const order = Array.from(mean.keys()).sort((a, b) => mean[b] - mean[a]);
  const bpm = MIN_BPM + order[0];
  const confidence = order.slice(0, 3).filter(k => Math.abs(MIN_BPM + k - bpm) <= 0.04 * bpm).reduce((s, k) => s + mean[k], 0);
  return { bpm, confidence };
}

/** Within 4%, as the accuracy scores count it. */
function sameTempo(a: number, b: number) { return Math.abs(b / a - 1) <= 0.04; }

/**
 * The app's tempo unless the CNN confidently reads a different one within the app's 40-250 BPM range. An overriding
 * reading carries the CNN's own confidence, not the beat tracker's.
 */
export function combineTempo(app: { bpm: number; confidence: number }, cnn: { bpm: number; confidence: number }): { bpm: number; confidence: number } {
  const usable = cnn.bpm >= 40 && cnn.bpm <= 250 && cnn.confidence > CNN_OVERRIDE_CONFIDENCE;
  return usable && !sameTempo(app.bpm, cnn.bpm) ? { bpm: cnn.bpm, confidence: Math.min(1, cnn.confidence) } : app;
}

let session: Promise<{ ort: typeof import('onnxruntime-web/webgpu'); model: import('onnxruntime-web/webgpu').InferenceSession }> | undefined;
async function loadModel() {
  // Same ORT entry as the Jamendo models; 1.4 MB, single-thread WASM.
  const ort = await import('onnxruntime-web/webgpu');
  ort.env.wasm.numThreads = 1;
  const model = await ort.InferenceSession.create(`${import.meta.env.BASE_URL}tempo-model/tempo-cnn.onnx`, { executionProviders: ['wasm'] });
  return { ort, model };
}

/** CNN tempo over every 10 s window of the excerpts (44.1 kHz mono), or undefined for silence or a missing model. */
export async function predictCnnTempo(excerpts: Float32Array[]): Promise<{ bpm: number; confidence: number } | undefined> {
  const windows = excerpts.flatMap(s => tempoWindows(tempoMel(s)));
  if (!windows.length) return;
  const { ort, model } = await (session ??= loadModel().catch(error => { session = undefined; throw error; }));
  const input = new Float32Array(windows.length * FRAMES * BANDS);
  windows.forEach((w, i) => input.set(w, i * FRAMES * BANDS));
  const tensor = new ort.Tensor('float32', input, [windows.length, FRAMES, BANDS]);
  try {
    const output = await model.run({ mel: tensor });
    try { return cnnTempo(output.logits.data as Float32Array, windows.length); }
    finally { for (const t of Object.values(output)) t.dispose(); }
  } finally { tensor.dispose(); }
}
