import { describe, expect, it } from 'vitest';
import { cnnTempo, combineTempo, tempoMel, tempoWindows } from './tempoCnn';

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
  it('cuts 10 s windows every 5 s and pads a short recording', () => {
    const frames = (n: number) => Array.from({ length: n }, () => new Float32Array(40).fill(1));
    expect(tempoWindows(frames(429))).toHaveLength(3);
    const short = tempoWindows(frames(100));
    expect(short).toHaveLength(1);
    expect(short[0][99 * 40]).toBe(1);
    expect(short[0][100 * 40]).toBe(0);
  });
  it('averages the windows and counts only top classes within 4% as confidence', () => {
    const one = cnnTempo(logitsFor([[128, 129]]), 1);
    expect(one.bpm).toBe(128);
    expect(one.confidence).toBeGreaterThan(0.9);
    // Two windows disagree by a third: neither reading is confident.
    const split = cnnTempo(logitsFor([[93], [140]]), 2);
    expect(split.confidence).toBeLessThan(0.5);
  });
  it('keeps the beat tracker unless the model confidently reads another tempo', () => {
    expect(combineTempo(93.3, { bpm: 140, confidence: 0.8 })).toBe(140);
    expect(combineTempo(93.3, { bpm: 140, confidence: 0.3 })).toBe(93.3);
    expect(combineTempo(139.2, { bpm: 140, confidence: 0.9 })).toBe(139.2);
  });
});
