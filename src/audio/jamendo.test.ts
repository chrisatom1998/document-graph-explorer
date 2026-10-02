import { expect, it, vi } from 'vitest';
import { jamendoSuggestions } from './jamendo';
import { jamendoPatches } from './jamendoFeatures';
import { sanitizeMusicAnalysis } from './musicTypes';

it('keeps the instrument separate from role tags such as bass and computer', () => {
  const suggestions = jamendoSuggestions({ bass: .9, computer: .8, synthesizer: .6, electricpiano: .2 });
  expect(suggestions[0].label).toBe('synthesizer');
  expect(suggestions).toHaveLength(1);
  expect(jamendoSuggestions({ bass: .9, pad: .8, voice: .7 })).toEqual([{ label: 'voice', score: .7, margin: .7 }]);
  expect(jamendoSuggestions({ voice: .49 })).toEqual([]);
});
it('retains multiple instrument candidates without forcing weak or invalid scores', () => {
  expect(jamendoSuggestions({ piano: .8, synthesizer: .5 }).map(i => i.label)).toEqual(['piano', 'synthesizer']);
  expect(jamendoSuggestions({ synthesizer: .2, piano: NaN, flute: Infinity, harp: 2 })).toEqual([]);
  expect(jamendoSuggestions({ electricpiano: .7, rhodes: .8 })).toHaveLength(1);
});
it('extracts centered frames and only complete patches, without repeating short clips', () => {
  const frames: Float32Array[] = [];
  const dispose = vi.fn();
  const vector = (data: Float32Array) => ({ data, delete: dispose, size: () => data.length, get: (i: number) => data[i] });
  const engine = {
    arrayToVector: (data: Float32Array) => { frames.push(data); return vector(data); },
    vectorToArray: () => new Float32Array(96).fill(2),
    TensorflowInputMusiCNN: () => ({ bands: vector(new Float32Array(96)) }),
  };
  expect(jamendoPatches(engine, new Float32Array(1000))).toEqual([]);
  const patches = jamendoPatches(engine, new Float32Array(32768).fill(1));
  expect(patches).toHaveLength(1); expect(patches[0]).toHaveLength(128 * 96);
  expect(frames[0].slice(0, 256).every(v => v === 0)).toBe(true);
  expect(frames[0].slice(256).every(v => v === 1)).toBe(true);
  expect(dispose).toHaveBeenCalledTimes(frames.length * 2);
});
it('preserves model attribution through saved analysis', () => {
  const base = { version: 2, analyzedSeconds: 4, durationSeconds: 4, instruments: [], notes: [], instrumentPrediction: { label: 'synthesizer', score: .6, margin: .2, model: 'MTG-Jamendo' } };
  expect(sanitizeMusicAnalysis(base)?.instrumentPrediction?.model).toBe('MTG-Jamendo');
  expect(sanitizeMusicAnalysis({ ...base, instrumentPrediction: { ...base.instrumentPrediction, model: '<script>' } })?.instrumentPrediction?.model).toBeUndefined();
});
