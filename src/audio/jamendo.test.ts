import { expect, it, vi } from 'vitest';
import { classifyJamendo, JamendoRecordingScores, jamendoSuggestions, jamendoLabels, jamendoInstrumentScores, nsynthLabels } from './jamendo';
import { jamendoPatches } from './jamendoFeatures';
import { sanitizeMusicAnalysis } from './musicTypes';
import type Essentia from 'essentia.js/dist/essentia.js-core.es.js';

it('retains supported multilabel evidence including specific instruments and separate roles', () => {
  expect(jamendoLabels({ oboe: .7, viola: .6, bongo: .5, piano: .4, pad: .8, bass: .9 }).map(c => [c.dimension, c.labelId])).toEqual([
    ['source','oboe'],['source','viola'],['source','bongo'],['source','piano'],['role','pad'],['role','bass'],
  ]);
});

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
it('reports unsupported clips shorter than a Jamendo patch', async () => {
  await expect(classifyJamendo({} as Essentia, new Float32Array(1000))).rejects.toThrow('Unsupported Jamendo input');
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

it('reports NSynth tone and space only when one side of the pair clearly wins', () => {
  expect(nsynthLabels({ 'nsynth:bright_dark:bright': .9, 'nsynth:bright_dark:dark': .1, 'nsynth:reverb:wet': .55, 'nsynth:reverb:dry': .45 }))
    .toEqual([{ dimension: 'character', labelId: 'bright', score: .9 }]);
  expect(nsynthLabels({ 'nsynth:reverb:dry': .95, 'nsynth:bright_dark:dark': .85 }).map(c => c.labelId)).toEqual(['dark', 'dry']);
  expect(nsynthLabels({ 'nsynth:reverb:wet': NaN, 'nsynth:bright_dark:bright': 2 })).toEqual([]);
});
it('keeps single-note NSynth instrument scores out of labels and NSynth keys out of the Jamendo family', () => {
  const scores = { piano: .7, 'nsynth:instrument:synth_lead': .99, 'nsynth:acoustic_electronic:electronic': .99 };
  expect(nsynthLabels(scores)).toEqual([]);
  expect(jamendoLabels(scores).map(c => c.labelId)).toEqual(['piano']);
  expect(jamendoSuggestions(scores).map(s => s.label)).toEqual(['piano']);
  expect(jamendoInstrumentScores(scores)).toEqual({ piano: .7 });
});
it('keeps the Jamendo weights version within the persisted ledger bound as heads are added', async () => {
  const { createRecognition } = await import('./recognition');
  const job = createRecognition(10, 'full').jobs.find(j => j.modelId === 'jamendo')!;
  expect(job.weightsVersion.split(':')).toHaveLength(12);
  expect(job.weightsVersion.length).toBeLessThanOrEqual(512);
});

it('scores a recording by its two strongest windows, so a part-time instrument is not averaged away', () => {
  const song = new JamendoRecordingScores();
  for (let i = 0; i < 40; i++) song.add(i === 20 || i === 21 ? { saxophone: .8, drums: .6 } : { drums: .6 });
  expect(song.scores()).toEqual({ saxophone: .8, drums: .6 });
  expect(jamendoSuggestions(song.scores()).map(s => s.label)).toContain('saxophone');
});

it('needs a second window before one strong window counts in full', () => {
  const song = new JamendoRecordingScores();
  for (let i = 0; i < 40; i++) song.add(i === 7 ? { saxophone: .5 } : {});
  expect(song.scores().saxophone).toBe(.25);
  expect(jamendoSuggestions(song.scores())).toEqual([]);
});

it('keeps the plain average for one- and two-window recordings and ignores invalid scores', () => {
  const one = new JamendoRecordingScores();
  one.add({ piano: .4, organ: Number.NaN, flute: 1.5 });
  expect(one.scores()).toEqual({ piano: .4 });
  const two = new JamendoRecordingScores();
  two.add({ piano: .4 }); two.add({ piano: .2, voice: .6 });
  expect(two.scores().piano).toBeCloseTo(.3);
  expect(two.scores().voice).toBeCloseTo(.3);
});
