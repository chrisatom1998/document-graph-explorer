import { describe, expect, it, vi } from 'vitest';
import { detectRepeatedPitch, pitchClassAt, type PitchEngine } from './detectedPitch';
import { sanitizeMusicAnalysis } from './musicTypes';
function setup(reading: () => { pitch: number; pitchConfidence: number }) {
  const dispose = vi.fn();
  const engine: PitchEngine = { arrayToVector: () => ({ delete: dispose, size: () => 4096, get: () => 0 }), PitchYin: vi.fn(reading) };
  return { engine, dispose };
}
const signal = new Float32Array(44100 * 3).fill(0.2);
describe('audio-only pitch fallback', () => {
  it('finds the same pitch across octaves without assigning a mode', () => {
    let n = 0;
    const { engine, dispose } = setup(() => ({ pitch: n++ % 2 ? 293.6648 : 146.8324, pitchConfidence: 0.94 }));
    expect(detectRepeatedPitch(engine, signal)).toMatchObject({ pitchClass: 2, confidence: expect.closeTo(0.94) });
    expect(dispose.mock.calls.length).toBeGreaterThan(8);
  });
  it('rejects noisy, inconsistent, silent, and too-short evidence', () => {
    const weak = setup(() => ({ pitch: 293.6648, pitchConfidence: 0.4 }));
    expect(detectRepeatedPitch(weak.engine, signal)).toBeUndefined();
    let n = 0;
    const mixed = setup(() => ({ pitch: n++ % 2 ? 293.6648 : 440, pitchConfidence: 0.94 }));
    expect(detectRepeatedPitch(mixed.engine, signal)).toBeUndefined();
    expect(detectRepeatedPitch(mixed.engine, new Float32Array(signal.length))).toBeUndefined();
    expect(detectRepeatedPitch(mixed.engine, signal.slice(0, 1000))).toBeUndefined();
  });
  it('rejects unpitched and off-note values', () => {
    for (const pitch of [NaN, Infinity, 0, 30, 2000, 440 * 2 ** (0.5 / 12)]) expect(pitchClassAt(pitch)).toBeUndefined();
    expect(pitchClassAt(440)).toBe(9);
    expect(pitchClassAt(261.6256)).toBe(0);
  });
  it('preserves pitch evidence and discards legacy filename keys on reload', () => {
    const restored = sanitizeMusicAnalysis({ version: 2, keyRevision: 2, analyzedSeconds: 3, durationSeconds: 3, instruments: [], notes: [], detectedPitch: { pitchClass: 2, confidence: 0.9 }, key: { tonic: 2, mode: 'minor', strength: 0, source: 'filename' } });
    expect(restored?.detectedPitch).toEqual({ pitchClass: 2, confidence: 0.9 });
    expect(restored?.keyRevision).toBe(2);
    expect(restored?.key).toBeUndefined();
  });
});
