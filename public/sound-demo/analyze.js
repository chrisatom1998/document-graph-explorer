// A small, honest sound "listener".
//
// It measures a few easy-to-explain things about a clip (how fast it starts,
// how long it lasts, how deep or bright it is, how noisy vs. musical it is)
// and turns them into rule-of-thumb scores for seven everyday sound types.
//
// This is NOT the full recognizer inside the Resonance app (that one uses a
// large AI model and 192 categories). Scores here are "how well do the
// measurements fit this description", not probabilities and not accuracy.

export const LABELS = [
  'kick',
  'bass',
  'snare / clap',
  'hi-hat',
  'pluck / lead',
  'pad / sustained tone',
  'riser / sweep',
];

const MAX_SECONDS = 10; // only ever look at the first ten seconds
const FFT_SIZE = 2048;
const ENV_HOP_SECONDS = 0.01; // loudness is checked every 10 ms

const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** 0 until `lo`, rising smoothly to 1 at `hi`. */
const up = (x, lo, hi) => clamp01((x - lo) / (hi - lo));
/** 1 until `lo`, falling to 0 at `hi`. */
const down = (x, lo, hi) => 1 - up(x, lo, hi);
/** Blend several 0..1 clues: every clue matters, one bad clue drags the score down. */
function blend(terms) {
  let sum = 0;
  for (const t of terms) sum += Math.log(Math.max(t, 0.03));
  return Math.exp(sum / terms.length);
}

// In-place radix-2 FFT.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function noteName(freq) {
  if (!(freq > 0)) return null;
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Mix any number of channels down to one. */
export function toMono(channels) {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** Measure a clip. `samples` is mono audio between -1 and 1. */
export function measure(samples, sampleRate) {
  const x = samples.subarray(0, Math.min(samples.length, Math.floor(sampleRate * MAX_SECONDS)));

  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak < 1e-4) return { silent: true, seconds: x.length / sampleRate };

  // Loudness over time, in 10 ms steps.
  const hop = Math.max(1, Math.round(sampleRate * ENV_HOP_SECONDS));
  const frames = Math.max(1, Math.floor(x.length / hop));
  const env = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) s += x[i] * x[i];
    env[f] = Math.sqrt(s / hop);
  }
  let envPeak = 0;
  let peakIdx = 0;
  for (let f = 0; f < frames; f++) {
    if (env[f] > envPeak) {
      envPeak = env[f];
      peakIdx = f;
    }
  }
  const firstActive = env.findIndex((v) => v >= 0.1 * envPeak);
  let lastActive = firstActive;
  for (let f = frames - 1; f >= 0; f--) {
    if (env[f] >= 0.1 * envPeak) {
      lastActive = f;
      break;
    }
  }
  const startIdx = env.findIndex((v) => v >= 0.05 * envPeak);
  const at90 = env.findIndex((v) => v >= 0.9 * envPeak);
  const attack = (Math.max(0, at90 - startIdx) + 1) * ENV_HOP_SECONDS;
  const activeSeconds = (lastActive - firstActive + 1) * ENV_HOP_SECONDS;
  const peakPosition = lastActive > firstActive ? (peakIdx - firstActive) / (lastActive - firstActive) : 0;
  let decayIdx = -1;
  for (let f = peakIdx; f < frames; f++) {
    if (env[f] < 0.1 * envPeak) {
      decayIdx = f;
      break;
    }
  }
  const decay = decayIdx === -1 ? null : (decayIdx - peakIdx) * ENV_HOP_SECONDS;

  // Average spectrum over the part of the clip that is actually audible.
  const bins = FFT_SIZE / 2;
  const power = new Float64Array(bins + 1);
  const centroidOverTime = [];
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const startSample = firstActive * hop;
  const endSample = Math.min(x.length, (lastActive + 1) * hop);
  const stride = FFT_SIZE / 2;
  let used = 0;
  for (let s = startSample; s === startSample || s + FFT_SIZE <= endSample + stride; s += stride) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < FFT_SIZE; i++) {
      const v = s + i < x.length ? x[s + i] : 0;
      re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
    }
    fft(re, im);
    let num = 0;
    let den = 0;
    for (let k = 1; k <= bins; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      power[k] += p;
      num += k * (sampleRate / FFT_SIZE) * p;
      den += p;
    }
    if (den > 0) centroidOverTime.push(num / den);
    used++;
    if (s + FFT_SIZE > endSample) break;
  }
  for (let k = 1; k <= bins; k++) power[k] /= Math.max(1, used);

  const binHz = sampleRate / FFT_SIZE;
  let total = 0;
  let lowPower = 0;
  let highPower = 0;
  let weighted = 0;
  let strongest = 1;
  for (let k = 1; k <= bins; k++) {
    const f = k * binHz;
    total += power[k];
    weighted += f * power[k];
    if (f < 150) lowPower += power[k];
    if (f > 6000) highPower += power[k];
    if (power[k] > power[strongest]) strongest = k;
  }
  const centroid = total > 0 ? weighted / total : 0;

  // "Musical-ness": how much of the energy sits in a few sharp spectral peaks.
  const taken = new Uint8Array(bins + 1);
  let peakEnergy = 0;
  for (let round = 0; round < 6; round++) {
    let best = -1;
    for (let k = 1; k <= bins; k++) if (!taken[k] && (best === -1 || power[k] > power[best])) best = k;
    if (best === -1) break;
    for (let k = Math.max(1, best - 3); k <= Math.min(bins, best + 3); k++) {
      if (!taken[k]) peakEnergy += power[k];
      taken[k] = 1;
    }
  }
  const tonality = total > 0 ? peakEnergy / total : 0;

  // Does the sound get brighter over time? (late centroid / early centroid)
  let brighten = 1;
  if (centroidOverTime.length >= 3) {
    const third = Math.max(1, Math.floor(centroidOverTime.length / 3));
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const early = mean(centroidOverTime.slice(0, third));
    const late = mean(centroidOverTime.slice(-third));
    brighten = early > 0 ? late / early : 1;
  }

  // Refine the strongest peak a little so the pitch reads better.
  let dominantHz = strongest * binHz;
  if (strongest > 1 && strongest < bins) {
    const a = Math.log(power[strongest - 1] + 1e-12);
    const b = Math.log(power[strongest] + 1e-12);
    const c = Math.log(power[strongest + 1] + 1e-12);
    const denom = a - 2 * b + c;
    if (denom !== 0) dominantHz = (strongest + (0.5 * (a - c)) / denom) * binHz;
  }

  // A coarse picture of the spectrum for drawing: 64 bands from low to high
  // pitch, each as "dB below the loudest band" (0 = loudest, -60 = very quiet).
  const SPECTRUM_BANDS = 64;
  const specLo = 40;
  const specHi = Math.min(20000, sampleRate / 2 - binHz);
  let loudest = 0;
  for (let k = 1; k <= bins; k++) loudest = Math.max(loudest, power[k]);
  const spectrumDb = [];
  for (let b = 0; b < SPECTRUM_BANDS; b++) {
    const f0 = specLo * Math.pow(specHi / specLo, b / SPECTRUM_BANDS);
    const f1 = specLo * Math.pow(specHi / specLo, (b + 1) / SPECTRUM_BANDS);
    const k0 = Math.max(1, Math.floor(f0 / binHz));
    const k1 = Math.min(bins, Math.max(k0, Math.ceil(f1 / binHz)));
    let bandMax = 0;
    for (let k = k0; k <= k1; k++) bandMax = Math.max(bandMax, power[k]);
    spectrumDb.push(loudest > 0 && bandMax > 0 ? Math.max(-60, 10 * Math.log10(bandMax / loudest)) : -60);
  }

  return {
    silent: false,
    seconds: x.length / sampleRate,
    spectrum: { lowHz: specLo, highHz: specHi, db: spectrumDb },
    peak,
    attack,
    decay,
    activeSeconds,
    peakPosition,
    centroid,
    lowShare: total > 0 ? lowPower / total : 0,
    highShare: total > 0 ? highPower / total : 0,
    tonality,
    brighten,
    dominantHz,
  };
}

/** Turn measurements into a score (0..1) for each sound type. */
export function score(m) {
  const lowAndShort = [up(m.lowShare, 0.35, 0.7), down(m.centroid, 300, 1000)];
  return {
    kick: blend([...lowAndShort, down(m.activeSeconds, 0.5, 1.0), down(m.attack, 0.03, 0.12)]),
    bass: blend([...lowAndShort, up(m.activeSeconds, 0.3, 0.8), up(m.tonality, 0.2, 0.5)]),
    'snare / clap': blend([
      down(m.attack, 0.03, 0.1),
      up(m.activeSeconds, 0.05, 0.12),
      down(m.activeSeconds, 0.5, 0.9),
      up(m.centroid, 1000, 2500),
      down(m.centroid, 6500, 9000),
      down(m.tonality, 0.3, 0.65),
      down(m.lowShare, 0.3, 0.6),
    ]),
    'hi-hat': blend([
      up(m.highShare, 0.3, 0.6),
      up(m.centroid, 4500, 7000),
      down(m.activeSeconds, 0.3, 0.6),
      down(m.tonality, 0.3, 0.6),
    ]),
    'pluck / lead': blend([
      up(m.tonality, 0.35, 0.65),
      down(m.attack, 0.03, 0.1),
      up(m.activeSeconds, 0.15, 0.3),
      down(m.activeSeconds, 1.6, 3),
      up(m.centroid, 200, 500),
      down(m.centroid, 3500, 6000),
      down(m.lowShare, 0.5, 0.85),
    ]),
    'pad / sustained tone': blend([
      up(m.tonality, 0.3, 0.6),
      Math.max(up(m.attack, 0.08, 0.25), up(m.activeSeconds, 1.5, 2.5)),
      up(m.activeSeconds, 0.8, 1.5),
      up(m.centroid, 150, 400),
      down(m.centroid, 3500, 6000),
      down(m.lowShare, 0.6, 0.9),
    ]),
    'riser / sweep': blend([
      down(m.tonality, 0.2, 0.5),
      up(m.peakPosition, 0.5, 0.8),
      up(m.activeSeconds, 0.8, 1.5),
      up(m.brighten, 1.1, 1.6),
    ]),
  };
}

const SHOW_AT = 0.35; // below this a label is not worth showing
const LIKELY_AT = 0.55; // at or above this we say "likely"

/** Short plain-English reasons for a label, based on what was measured. */
export function explain(label, m) {
  const ms = (s) => `${Math.round(s * 1000)} ms`;
  const secs = (s) => `${s.toFixed(1)} s`;
  const lines = [];
  switch (label) {
    case 'kick':
      lines.push(`Most of the energy (${Math.round(m.lowShare * 100)}%) is deep bass, below 150 Hz.`);
      lines.push(`It hits instantly (about ${ms(m.attack)}) and is gone in ${secs(m.activeSeconds)}: a punch, not a held note.`);
      break;
    case 'bass':
      lines.push(`Most of the energy (${Math.round(m.lowShare * 100)}%) is deep bass, below 150 Hz.`);
      lines.push(`One clear pitch${noteName(m.dominantHz) ? ` (around ${noteName(m.dominantHz)})` : ''} that lasts ${secs(m.activeSeconds)}, longer than a drum hit.`);
      break;
    case 'snare / clap':
      lines.push(`It starts instantly (about ${ms(m.attack)}) and fades in ${secs(m.activeSeconds)}.`);
      lines.push(`The sound is mostly noisy, with its brightness in the middle-to-upper range (around ${Math.round(m.centroid)} Hz).`);
      break;
    case 'hi-hat':
      lines.push(`Most of the energy (${Math.round(m.highShare * 100)}%) is very high-pitched, above 6,000 Hz.`);
      lines.push(`It is tiny: just ${secs(m.activeSeconds)} long, and noisy rather than musical.`);
      break;
    case 'pluck / lead':
      lines.push(`It has a clear musical pitch${noteName(m.dominantHz) ? ` (around ${noteName(m.dominantHz)})` : ''}.`);
      lines.push(`It starts fast (about ${ms(m.attack)}) and dies away within ${secs(m.activeSeconds)}.`);
      break;
    case 'pad / sustained tone':
      lines.push(`It is musical, with a steady tone${noteName(m.dominantHz) ? ` (strongest near ${noteName(m.dominantHz)})` : ''}.`);
      lines.push(`It lasts ${secs(m.activeSeconds)} and fades in gently (about ${ms(m.attack)} to reach full volume).`);
      break;
    case 'riser / sweep':
      lines.push(`It is noisy rather than musical, and it gets louder toward the end.`);
      lines.push(`It also gets brighter as it goes (${m.brighten.toFixed(1)}x brighter late vs. early), like a build-up.`);
      break;
    default:
      break;
  }
  return lines;
}

/** One call that does everything the page needs. */
export function analyze(samples, sampleRate) {
  const m = measure(samples, sampleRate);
  if (m.silent) return { measurements: m, results: [], verdict: 'silent' };
  const scores = score(m);
  const results = LABELS.map((label) => ({ label, score: scores[label] })).sort((a, b) => b.score - a.score);
  const shown = results.filter((r) => r.score >= SHOW_AT).slice(0, 3);
  const verdict = shown.length === 0 ? 'unclear' : shown[0].score >= LIKELY_AT ? 'likely' : 'unsure';
  return {
    measurements: m,
    results: shown,
    allScores: results,
    verdict,
    why: shown.length > 0 ? explain(shown[0].label, m) : [],
  };
}
