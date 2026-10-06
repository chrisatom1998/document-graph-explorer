import { describe, expect, it } from 'vitest';
import { EVENT_FEATURE_NAMES, EVENT_FEATURE_VERSION, eventFeatures } from './eventFeatures';
import { sanitizeShortClipModel, shortClipScores } from './shortClipModel';

const width = 512 + EVENT_FEATURE_NAMES.length;
const model = (over: Record<string, unknown> = {}) => ({
  version: 1, kind: 'short-clip-heads', revision: 'test', clapEncoder: 'clap', eventFeatures: EVENT_FEATURE_VERSION, blocks: ['clapZero', 'event'], maxSeconds: 2.25,
  mean: new Array(width).fill(0), std: new Array(width).fill(1),
  heads: [{ group: 'production', label: 'kick', weights: [5, ...new Array(width - 1).fill(0)], bias: 0, threshold: .7 }], ...over,
});

describe('short-clip heads', () => {
  it('rejects malformed or mismatched models', () => {
    expect(sanitizeShortClipModel(model())).toBeDefined();
    expect(sanitizeShortClipModel(model({ eventFeatures: 'other' }))).toBeUndefined();
    expect(sanitizeShortClipModel(model({ blocks: ['clapZero', 'ast'] }))).toBeUndefined();
    expect(sanitizeShortClipModel(model({ heads: [{ group: 'production', label: 'kick', weights: [1], bias: 0, threshold: .7 }] }))).toBeUndefined();
    expect(sanitizeShortClipModel(model({ heads: [{ group: 'production', label: 'kick', weights: new Array(width).fill(0), bias: 0, threshold: .4 }] }))).toBeUndefined();
    expect(sanitizeShortClipModel(model({ std: new Array(width).fill(0) }))).toBeUndefined();
  });
  it('tags only heads that clear their own threshold and abstains on missing inputs', () => {
    const m = sanitizeShortClipModel(model())!;
    const clap = [1, ...new Array(511).fill(0)], event = new Array(EVENT_FEATURE_NAMES.length).fill(0);
    expect(shortClipScores(m, { clapZero: clap, event }).scores).toMatchObject([{ label: 'kick', learnedGroup: 'production', basis: 'head', decision: 'include' }]);
    expect(shortClipScores(m, { clapZero: clap.map(v => -v), event }).scores).toEqual([]);
    expect(shortClipScores(m, { clapZero: clap }).scores).toEqual([]);
  });
  it('reads the app\'s own looped CLAP fingerprint when trained on it', () => {
    const m = sanitizeShortClipModel(model({ blocks: ['clapRepeat'], mean: new Array(512).fill(0), std: new Array(512).fill(1),
      heads: [{ group: 'production', label: 'hi-hat', weights: [4, ...new Array(511).fill(0)], bias: 0, threshold: .9, maybe: false }] }))!;
    expect(shortClipScores(m, { clapRepeat: [3, ...new Array(511).fill(0)] }).scores).toMatchObject([{ label: 'hi-hat' }]);
    expect(shortClipScores(m, { clapZero: [3, ...new Array(511).fill(0)] }).scores).toEqual([]);
  });
  it('tags a one-shot voice as a vocal one-shot too, with the voice head\'s own score', () => {
    const voice = (label = 'voice', group = 'source') => ({ group, label, weights: [4, ...new Array(511).fill(0)], bias: 0, threshold: .9 });
    const m = sanitizeShortClipModel(model({ blocks: ['clapRepeat'], mean: new Array(512).fill(0), std: new Array(512).fill(1), heads: [voice()] }))!;
    const loud = shortClipScores(m, { clapRepeat: [3, ...new Array(511).fill(0)] }).scores;
    expect(loud.map(s => `${s.learnedGroup}:${s.label}`)).toEqual(['source:voice', 'production:vocal one-shot']);
    expect(loud[1]).toMatchObject({ score: loud[0].score, basis: 'head', decision: 'include' });
    expect(shortClipScores(m, { clapRepeat: [-3, ...new Array(511).fill(0)] }).scores).toEqual([]);
    // A head trained for the role itself wins over the derived tag.
    const own = sanitizeShortClipModel(model({ blocks: ['clapRepeat'], mean: new Array(512).fill(0), std: new Array(512).fill(1),
      heads: [voice(), { ...voice('vocal one-shot', 'production'), weights: [-4, ...new Array(511).fill(0)] }] }))!;
    expect(shortClipScores(own, { clapRepeat: [3, ...new Array(511).fill(0)] }).scores.map(s => s.label)).toEqual(['voice']);
  });
});

describe('event features', () => {
  it('describes a decaying hit without looping it and ignores silence', () => {
    const hit = Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i * 2 * Math.PI * 60 / 16000) * Math.exp(-i / 1600));
    const f = eventFeatures(hit)!;
    expect(f).toHaveLength(EVENT_FEATURE_NAMES.length);
    expect(f[EVENT_FEATURE_NAMES.indexOf('onset_count')]).toBe(1);
    expect(f.every(Number.isFinite)).toBe(true);
    const twoHits = new Float32Array(16000); twoHits.set(hit.subarray(0, 6000)); twoHits.set(hit.subarray(0, 6000), 8000);
    expect(eventFeatures(twoHits)![EVENT_FEATURE_NAMES.indexOf('onset_count')]).toBe(2);
    expect(eventFeatures(new Float32Array(16000))).toBeUndefined();
  });
});
