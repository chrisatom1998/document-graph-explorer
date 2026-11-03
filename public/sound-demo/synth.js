// Built-in test sounds, generated from math (no audio files, no downloads).
// Because we make them ourselves, we know the right answer for each one, which
// lets the page grade itself honestly. Plain JavaScript, no Web Audio needed,
// so the same code runs in the browser and in Node tests.

export const SAMPLE_RATE = 44100;

const TWO_PI = Math.PI * 2;

// Small seeded random generator so "noise" is the same every time.
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function whiteNoise(length, seed) {
  const rng = makeRng(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = rng() * 2 - 1;
  return out;
}

// One-pole filters. Cheap, and plenty good enough to shape a noise burst.
function highpass(x, cutoffHz, sr = SAMPLE_RATE) {
  const rc = 1 / (TWO_PI * cutoffHz);
  const dt = 1 / sr;
  const a = rc / (rc + dt);
  const y = new Float32Array(x.length);
  for (let i = 1; i < x.length; i++) y[i] = a * (y[i - 1] + x[i] - x[i - 1]);
  return y;
}

function lowpass(x, cutoffHz, sr = SAMPLE_RATE) {
  const rc = 1 / (TWO_PI * cutoffHz);
  const dt = 1 / sr;
  const a = dt / (rc + dt);
  const y = new Float32Array(x.length);
  for (let i = 1; i < x.length; i++) y[i] = y[i - 1] + a * (x[i] - y[i - 1]);
  return y;
}

function normalize(x, target = 0.9) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak === 0) return x;
  const g = target / peak;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

export function makeKick() {
  const n = Math.floor(SAMPLE_RATE * 0.5);
  const out = new Float32Array(n);
  const click = whiteNoise(n, 11);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const freq = 45 + 105 * Math.exp(-t / 0.04); // pitch drops fast: the "thump"
    phase += (TWO_PI * freq) / SAMPLE_RATE;
    out[i] = Math.sin(phase) * Math.exp(-t / 0.11) + (t < 0.002 ? click[i] * 0.2 : 0);
  }
  return normalize(out);
}

export function makeSnare() {
  const n = Math.floor(SAMPLE_RATE * 0.4);
  // Real snares are mid-range "crack", not hiss: keep the noise between ~1.2k and ~4k.
  const noise = lowpass(lowpass(highpass(whiteNoise(n, 22), 1200), 4000), 4000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const body = Math.sin(TWO_PI * 190 * t) * Math.exp(-t / 0.05) * 0.1;
    out[i] = body + noise[i] * Math.exp(-t / 0.09);
  }
  return normalize(out);
}

export function makeClap() {
  const n = Math.floor(SAMPLE_RATE * 0.4);
  const noise = lowpass(lowpass(highpass(whiteNoise(n, 33), 900), 4500), 4500);
  const out = new Float32Array(n);
  const burstStarts = [0, 0.011, 0.023];
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let env = Math.exp(-Math.max(0, t - 0.035) / 0.07) * (t >= 0.035 ? 1 : 0);
    for (const s of burstStarts) {
      if (t >= s && t < s + 0.011) env = Math.max(env, Math.exp(-(t - s) / 0.008));
    }
    out[i] = noise[i] * env;
  }
  return normalize(out);
}

export function makeHat() {
  const n = Math.floor(SAMPLE_RATE * 0.25);
  const noise = highpass(highpass(whiteNoise(n, 44), 7000), 7000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = noise[i] * Math.exp(-(i / SAMPLE_RATE) / 0.03);
  return normalize(out);
}

export function makeBass() {
  const n = Math.floor(SAMPLE_RATE * 1.1);
  const out = new Float32Array(n);
  const freq = 55; // the note A1
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const attack = Math.min(1, t / 0.005);
    const release = t > 0.95 ? Math.max(0, 1 - (t - 0.95) / 0.15) : 1;
    out[i] = Math.tanh(1.6 * Math.sin(TWO_PI * freq * t)) * attack * release;
  }
  return normalize(out);
}

export function makePad() {
  const n = Math.floor(SAMPLE_RATE * 3.0);
  const out = new Float32Array(n);
  const notes = [220, 261.63, 329.63]; // A minor chord
  const detune = [-1.5, 0, 1.5];
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let s = 0;
    for (const f of notes) {
      for (const d of detune) {
        for (let h = 1; h <= 6; h++) s += Math.sin(TWO_PI * (f + d) * h * t) / h;
      }
    }
    const up = Math.min(1, t / 0.6);
    const attack = up * up * (3 - 2 * up); // slow fade-in
    const release = t > 2.4 ? Math.max(0, 1 - (t - 2.4) / 0.6) : 1;
    out[i] = s * attack * release;
  }
  return normalize(lowpass(out, 2500));
}

export function makePluck() {
  const n = Math.floor(SAMPLE_RATE * 1.2);
  const out = new Float32Array(n);
  const freq = 440; // the note A4
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let s = 0;
    for (let h = 1; h <= 8; h++) s += (Math.sin(TWO_PI * freq * h * t) / h) * Math.exp(-t * (3 + h * 2));
    out[i] = s * Math.min(1, t / 0.002);
  }
  return normalize(out);
}

export function makeRiser() {
  const seconds = 2.0;
  const n = Math.floor(SAMPLE_RATE * seconds);
  const noise = whiteNoise(n, 55);
  const out = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const cutoff = 300 * Math.pow(9000 / 300, t / seconds); // filter opens up over time
    const rc = 1 / (TWO_PI * cutoff);
    const a = 1 / SAMPLE_RATE / (rc + 1 / SAMPLE_RATE);
    y += a * (noise[i] - y);
    const rise = (t / seconds) * (t / seconds);
    out[i] = y * rise;
  }
  return normalize(out);
}

// What the page offers as one-click samples. `expected` is the known right answer.
export const SAMPLES = [
  { id: 'kick', name: 'Kick drum', expected: 'kick', blurb: 'A deep thump that drops in pitch.', make: makeKick },
  { id: 'snare', name: 'Snare', expected: 'snare / clap', blurb: 'A crack of noise on top of a short tone.', make: makeSnare },
  { id: 'clap', name: 'Clap', expected: 'snare / clap', blurb: 'Several quick noise bursts, like hands.', make: makeClap },
  { id: 'hat', name: 'Hi-hat', expected: 'hi-hat', blurb: 'A tiny, bright tick of high noise.', make: makeHat },
  { id: 'bass', name: 'Sub bass', expected: 'bass', blurb: 'One long, low note (A1, 55 Hz).', make: makeBass },
  { id: 'pad', name: 'Soft pad', expected: 'pad / sustained tone', blurb: 'A slow-fading chord that hangs around.', make: makePad },
  { id: 'pluck', name: 'Pluck', expected: 'pluck / lead', blurb: 'A quick, bright note that dies away (A4).', make: makePluck },
  { id: 'riser', name: 'Riser', expected: 'riser / sweep', blurb: 'Rushing noise that builds and brightens.', make: makeRiser },
];
