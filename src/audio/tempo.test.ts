import { describe, expect, it, vi } from 'vitest';
import { estimateTempo, type TempoEngine } from './tempo';
import { sanitizeMusicAnalysis } from './musicTypes';
const vector = (size = 8) => ({ size: () => size, delete: vi.fn(), get: () => 0 });
function setup(onsets = 8, loopBpm = 70, trackerBpm = 120, odf = new Float32Array(860)) {
  const audio = vector(); const attacks = vector(onsets); const detections = vector();
  const ticks = vector(); const estimates = vector(); const intervals = vector();
  const engine: TempoEngine = {
    arrayToVector: vi.fn(() => audio),
    vectorToArray: vi.fn(() => odf),
    OnsetDetectionGlobal: vi.fn(() => ({ onsetDetections: detections })),
    OnsetRate: vi.fn(() => ({ onsets: attacks, onsetRate: 2 })),
    LoopBpmEstimator: vi.fn(() => ({ bpm: loopBpm })),
    RhythmExtractor2013: vi.fn(() => ({ bpm: trackerBpm, confidence: 3, ticks, estimates, bpmIntervals: intervals })),
  } as unknown as TempoEngine;
  return { engine, audio, attacks, detections, ticks, estimates, intervals };
}
const sound = (seconds = 6.85) => new Float32Array(Math.round(seconds * 44100)).fill(0.1);
describe('short-clip tempo', () => {
  it('accepts a rhythmic short loop and preserves double-time ambiguity', () => {
    const { engine, audio, attacks } = setup();
    expect(estimateTempo(engine, sound())).toEqual({ bpm: 70, confidence: 0.75, alternatives: [140] });
    expect(engine.RhythmExtractor2013).not.toHaveBeenCalled();
    expect(audio.delete).toHaveBeenCalledOnce(); expect(attacks.delete).toHaveBeenCalledOnce();
  });
  it('rejects too few attacks even if a beat tracker would report a strong tempo', () => {
    for (const count of [0, 1, 2]) {
      const { engine, audio, attacks } = setup(count);
      expect(estimateTempo(engine, sound())).toBeUndefined();
      expect(engine.LoopBpmEstimator).not.toHaveBeenCalled();
      expect(audio.delete).toHaveBeenCalledOnce(); expect(attacks.delete).toHaveBeenCalledOnce();
    }
  });
  it('rejects silence and clips too short to establish a pulse', () => {
    const { engine } = setup();
    expect(estimateTempo(engine, new Float32Array(44100 * 6))).toBeUndefined();
    expect(estimateTempo(engine, sound(1))).toBeUndefined();
    expect(engine.arrayToVector).not.toHaveBeenCalled();
  });
  it('can fall back to beat tracking for a fragment without a clean loop boundary', () => {
    const { engine, ticks, estimates, intervals } = setup(8, 0);
    expect(estimateTempo(engine, sound())).toMatchObject({ bpm: 120, alternatives: [60, 240] });
    expect(ticks.delete).toHaveBeenCalledOnce(); expect(estimates.delete).toHaveBeenCalledOnce(); expect(intervals.delete).toHaveBeenCalledOnce();
  });
  it('keeps the established beat-tracking path for longer recordings', () => {
    const { engine } = setup();
    expect(estimateTempo(engine, sound(20))).toEqual({ bpm: 120, confidence: 1 });
    expect(engine.LoopBpmEstimator).not.toHaveBeenCalled();
  });
  it('checks a longer recording\'s tempo against its onset periodicity', () => {
    // Kicks every 43 frames (120 BPM) while the tracker reports half time.
    const odf = Float32Array.from({ length: 860 }, (_, i) => i % 43 === 0 ? 1 : 0);
    const { engine, detections } = setup(8, 70, 60.1, odf);
    expect(estimateTempo(engine, sound(10))?.bpm).toBeCloseTo(120.2, 1);
    expect(detections.delete).toHaveBeenCalledOnce();
    expect(engine.OnsetDetectionGlobal).toHaveBeenCalledOnce();
  });
  it('never re-picks the tempo of a short clip', () => {
    const { engine } = setup(8, 0);
    estimateTempo(engine, sound());
    expect(engine.OnsetDetectionGlobal).not.toHaveBeenCalled();
  });
  it('persists the revision and safe alternate tempos', () => {
    const result = sanitizeMusicAnalysis({ version: 2, tempoRevision: 1, durationSeconds: 7, analyzedSeconds: 7, instruments: [], notes: [], tempo: { bpm: 70, confidence: 0.75, alternatives: [140, 140, NaN, Infinity, -1, 900] } });
    expect(result?.tempoRevision).toBe(1);
    expect(result?.tempo?.alternatives).toEqual([140]);
  });
});
