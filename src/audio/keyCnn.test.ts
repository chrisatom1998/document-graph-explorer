import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { keyFilterbank, keySoftmax, profileWeight, keySpectrogram, loadKeyCnn, recordingKeyFromProbabilities, type KeyCnnEngine } from './keyCnn';

/** Stands in for Essentia's Spectrum: an exact DFT magnitude of the bins the key filters read (up to ~4.4 kHz). */
const fakeEngine: KeyCnnEngine = {
  arrayToVector: (array: Float32Array) => ({ array, delete() {} }),
  vectorToArray: (vector: { array: Float32Array }) => vector.array,
  Spectrum: (vector: { array: Float32Array }) => {
    const x = vector.array, n = x.length, out = new Float32Array(n / 2 + 1);
    for (let k = 0; k < 1700; k++) {
      let re = 0, im = 0;
      for (let i = 0; i < n; i++) { const a = 2 * Math.PI * k * i / n; re += x[i] * Math.cos(a); im -= x[i] * Math.sin(a); }
      out[k] = Math.hypot(re, im);
    }
    return { spectrum: { array: out, delete() {} } };
  },
} as unknown as KeyCnnEngine;

describe('key network input', () => {
  it('has 120 quarter-tone filters from MIDI 42 upward', () => {
    expect(keyFilterbank).toHaveLength(120);
    expect(keyFilterbank.every(f => f.weights.some(w => w > 0))).toBe(true);
    // Filter b is centred on MIDI 42 + b / 2.
    const peakHz = (b: number) => { const f = keyFilterbank[b]; return (f.start + f.weights.indexOf(Math.max(...f.weights))) * 44100 / 16384; };
    expect(peakHz(54)).toBeCloseTo(440, -1);
  });

  it('puts a 440 Hz tone in the A4 bin at 5 frames per second', () => {
    const samples = Float32Array.from({ length: 16384 + 8820 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / 44100));
    const { data, frames } = keySpectrogram(fakeEngine, samples);
    expect(frames).toBe(2);
    const first = Array.from(data.subarray(0, 120));
    expect(first.indexOf(Math.max(...first))).toBe(54);
  }, 60_000);
});

describe('recordingKeyFromProbabilities', () => {
  const one = (index: number, p = .7) => Array.from({ length: 24 }, (_, i) => i === index ? p : (1 - p) / 23);

  it('reads tonic C = 0 and minor from index + 12', () => {
    expect(recordingKeyFromProbabilities([one(21)], 1)).toMatchObject({ tonic: 9, mode: 'minor' });
    expect(recordingKeyFromProbabilities([one(7)], 1)).toMatchObject({ tonic: 7, mode: 'major' });
  });

  it('averages excerpts and keeps strength between 0.6 and 1', () => {
    const key = recordingKeyFromProbabilities([one(21, .9), one(21, .5), one(0, .6)], 3);
    expect(key).toMatchObject({ tonic: 9, mode: 'minor' });
    expect(key!.strength).toBeGreaterThanOrEqual(.6);
    expect(key!.strength).toBeLessThanOrEqual(1);
  });

  it('needs at least half of the excerpts to be tonal', () => {
    expect(recordingKeyFromProbabilities([one(21)], 3)).toBeUndefined();
    expect(recordingKeyFromProbabilities([], 1)).toBeUndefined();
  });

  it('lets the stock profile decide short files only', () => {
    const profile = { tonic: 2, mode: 'minor' as const, strength: .8 };
    expect(recordingKeyFromProbabilities([one(21)], 1, [profile], profileWeight(6))).toMatchObject({ tonic: 2, mode: 'minor' });
    expect(recordingKeyFromProbabilities([one(21)], 1, [profile], profileWeight(9.5))).toMatchObject({ tonic: 9, mode: 'minor' });
    expect(recordingKeyFromProbabilities([one(21)], 1, [undefined], profileWeight(6))).toMatchObject({ tonic: 9, mode: 'minor' });
  });

  it('turns logits into probabilities', () => {
    const p = keySoftmax(Array.from({ length: 24 }, (_, i) => i === 3 ? 5 : 0));
    expect(p.reduce((a, v) => a + v, 0)).toBeCloseTo(1);
    expect(p.indexOf(Math.max(...p))).toBe(3);
  });
});

describe('key network', () => {
  it('loads the committed model and returns 24 key scores for any length', async () => {
    const { ort, session } = await loadKeyCnn(readFileSync('public/key-model/key-cnn.onnx'));
    for (const frames of [3, 100]) {
      const input = new ort.Tensor('float32', new Float32Array(frames * 120).fill(4), [1, frames, 120]);
      const outputs = await session.run({ spec: input });
      expect(outputs.logits.dims).toEqual([1, 24]);
      expect(keySoftmax(outputs.logits.data as Float32Array).reduce((a, v) => a + v, 0)).toBeCloseTo(1);
    }
  });
});
