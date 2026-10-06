import { describe, expect, it } from 'vitest';
import { compareVersionPrints, computeVersionPrint, decodeVersionPrint, sanitizeVersionPrint, VERSION_PRINT_SAMPLE_RATE } from './versionPrint';

const RATE = VERSION_PRINT_SAMPLE_RATE;
/** A melody of harmonic notes over a two-note bass, `seconds` long; notes are MIDI numbers. */
function melody(notes: number[], { noteSeconds = .5, seconds = 24, transpose = 0, gain = .3, bright = 0, seed = 1 } = {}): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let s = seed;
  const noise = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 - .5; };
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE, k = Math.floor(t / noteSeconds);
    const note = notes[k % notes.length] + transpose, bass = notes[Math.floor(k / 4) * 4 % notes.length] - 24 + transpose;
    const hz = 440 * 2 ** ((note - 69) / 12), low = 440 * 2 ** ((bass - 69) / 12);
    let v = 0;
    for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * hz * h * t) / (h + (bright ? 0 : h));
    v += .6 * Math.sin(2 * Math.PI * low * t);
    if (bright) v += bright * noise();
    out[i] = gain * v / 3;
  }
  return out;
}
const TUNE = [62, 65, 69, 67, 65, 64, 62, 60, 62, 69, 72, 70, 69, 67, 65, 64];
const OTHER = [60, 64, 67, 72, 71, 67, 64, 62, 60, 59, 55, 59, 62, 65, 64, 62];
async function print(samples: Float32Array) {
  const text = await computeVersionPrint(async (start, seconds) => samples.slice(Math.round(start * RATE), Math.round((start + seconds) * RATE)), samples.length / RATE);
  return decodeVersionPrint(text!)!;
}

describe('version print', () => {
  it('matches a quieter copy frame for frame', async () => {
    const a = await print(melody(TUNE)), b = await print(melody(TUNE, { gain: .12 }));
    const c = compareVersionPrints(a, b)!;
    expect(c.window).toBeGreaterThan(.95);
    expect(c.coverage).toBeGreaterThan(.9);
    expect(c.timbre).toBeGreaterThan(.9);
    expect(c).toMatchObject({ semitones: 0, tempoRatio: 1 });
  });

  it('finds a trimmed copy at its offset', async () => {
    const full = melody(TUNE), a = await print(full), b = await print(full.slice(4 * RATE, 20 * RATE));
    const c = compareVersionPrints(a, b)!;
    expect(c.coverage).toBeGreaterThan(.9);
    expect(c.offsetSeconds).toBeCloseTo(-4, 0);
  });

  it('reports a pitch shift in semitones and a speed change as a ratio', async () => {
    const a = await print(melody(TUNE));
    const up = compareVersionPrints(a, await print(melody(TUNE, { transpose: 2 })))!;
    expect(up.semitones).toBe(2);
    expect(up.window).toBeGreaterThan(.9);
    const faster = compareVersionPrints(a, await print(melody(TUNE, { noteSeconds: .5 / 1.06 })))!;
    expect(faster.tempoRatio).toBeGreaterThan(1.03);
    expect(faster.tempoRatio).toBeLessThan(1.09);
    expect(faster.window).toBeGreaterThan(.85);
  });

  it('keeps a different melody well below a copy', async () => {
    const a = await print(melody(TUNE)), b = await print(melody(OTHER));
    const c = compareVersionPrints(a, b)!;
    expect(c.window).toBeLessThan(.75);
  });

  it('tells a remixed mix from the same mix by band balance', async () => {
    const a = await print(melody(TUNE)), b = await print(melody(TUNE, { bright: 2 }));
    const c = compareVersionPrints(a, b)!;
    expect(c.window).toBeGreaterThan(.6);
    expect(c.timbre).toBeLessThan(.8);
  });

  it('accepts only well-formed current-format prints', async () => {
    const text = await computeVersionPrint(async (start, seconds) => melody(TUNE).slice(Math.round(start * RATE), Math.round((start + seconds) * RATE)), 24);
    expect(sanitizeVersionPrint(text)).toBe(text);
    expect(sanitizeVersionPrint('AAAA')).toBeUndefined();
    expect(sanitizeVersionPrint('not base64!')).toBeUndefined();
    expect(sanitizeVersionPrint(123)).toBeUndefined();
    expect(await computeVersionPrint(async () => new Float32Array(RATE), 2)).toBeUndefined();
  });
});
