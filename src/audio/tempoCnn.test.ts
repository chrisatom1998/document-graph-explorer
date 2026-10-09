import { describe, expect, it } from 'vitest';
import { cnnTempo, combineLoopTempo, combineTempo, LOOP_CNN_OVERRIDE_CONFIDENCE, tempoMel, tempoWindows } from './tempoCnn';

function logitsFor(rows: number[][]) {
  return Float32Array.from(rows.flatMap(peaks => Array.from({ length: 256 }, (_, k) => peaks.includes(30 + k) ? 10 : 0)));
}

describe('tempo CNN input and output', () => {
  it('makes 21.5 frames per second of 40 log mel bands, loudest where the tone is', () => {
    const tone = Float32Array.from({ length: 10 * 44100 }, (_, i) => Math.sin(2 * Math.PI * 1000 * i / 44100) * 0.5);
    const frames = tempoMel(tone);
    expect(frames).toHaveLength(Math.floor((10 * 11025 - 1024) / 512) + 1);
    expect(frames[50]).toHaveLength(40);
    const loudest = frames[50].indexOf(Math.max(...frames[50]));
    // Band 16 is centred at 998 Hz.
    expect(loudest).toBe(16);
  });
  it('cuts 10 s windows every 5 s and repeats a short recording to fill one', () => {
    const frames = (n: number) => Array.from({ length: n }, (_, t) => new Float32Array(40).fill(t + 1));
    expect(tempoWindows(frames(429))).toHaveLength(3);
    const short = tempoWindows(frames(100));
    expect(short).toHaveLength(1);
    expect(short[0][99 * 40]).toBe(100);
    expect(short[0][100 * 40]).toBe(1);
    expect(short[0][214 * 40]).toBe(15);
    expect(tempoWindows([])).toEqual([]);
  });
  it('averages the windows and counts only top classes within 4% as confidence', () => {
    const one = cnnTempo(logitsFor([[128, 129]]), 1);
    expect(one.bpm).toBe(128);
    expect(one.confidence).toBeGreaterThan(0.9);
    // Two windows disagree by a third: neither reading is confident.
    const split = cnnTempo(logitsFor([[93], [140]]), 2);
    expect(split.confidence).toBeLessThan(0.5);
  });
  it('keeps the beat tracker unless the model confidently reads another tempo in range', () => {
    const app = { bpm: 93.3, confidence: 1 };
    expect(combineTempo(app, { bpm: 140, confidence: 0.8 })).toEqual({ bpm: 140, confidence: 0.8 });
    expect(combineTempo(app, { bpm: 140, confidence: 0.3 })).toBe(app);
    expect(combineTempo({ bpm: 139.2, confidence: 1 }, { bpm: 140, confidence: 0.9 })).toEqual({ bpm: 139.2, confidence: 1 });
    expect(combineTempo(app, { bpm: 270, confidence: 0.9 })).toBe(app);
    expect(combineTempo(app, { bpm: 35, confidence: 0.9 })).toBe(app);
  });
  it('fills in a short loop the estimator could not time, and keeps half and double time as alternatives', () => {
    expect(combineLoopTempo(undefined, { bpm: 120, confidence: 0.8 })).toEqual({ bpm: 120, confidence: 0.8, alternatives: [60, 240] });
    expect(combineLoopTempo(undefined, { bpm: 120, confidence: 0.3 })).toBeUndefined();
    const loop = { bpm: 80, confidence: 0.6, alternatives: [40, 160] };
    expect(combineLoopTempo(loop, { bpm: 120, confidence: 0.9 })).toEqual({ bpm: 120, confidence: 0.9, alternatives: [60, 240] });
    expect(combineLoopTempo(loop, { bpm: 120, confidence: 0.2 })).toBe(loop);
    expect(combineLoopTempo(loop, { bpm: 81, confidence: 0.9 })).toBe(loop);
  });
  it('trusts the loop-trained model on a seamless loop down to a lower confidence', () => {
    const loop = { bpm: 80, confidence: 0.6, alternatives: [40, 160] };
    expect(combineLoopTempo(loop, { bpm: 120, confidence: 0.2 }, LOOP_CNN_OVERRIDE_CONFIDENCE)).toEqual({ bpm: 120, confidence: 0.2, alternatives: [60, 240] });
    expect(combineLoopTempo(undefined, { bpm: 120, confidence: 0.2 }, LOOP_CNN_OVERRIDE_CONFIDENCE)).toEqual({ bpm: 120, confidence: 0.2, alternatives: [60, 240] });
    expect(combineLoopTempo(undefined, { bpm: 120, confidence: 0.05 }, LOOP_CNN_OVERRIDE_CONFIDENCE)).toBeUndefined();
  });
});
