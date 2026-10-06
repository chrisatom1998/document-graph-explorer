import { describe, expect, it, vi } from 'vitest';
import { beatTempogram, correctTempo } from './tempoCorrection';
import type { TempoEngine } from './tempo';
import cases from './tempoCorrection.fixture.json';

/** Onset function with a sharp attack every `period` frames (512-sample hops at 44.1 kHz). */
function pulses(period: number, frames = 860) {
  return Float32Array.from({ length: frames }, (_, i) => i % period === 0 ? 1 : 0);
}
function engineFor(odf: Float32Array) {
  const detections = { size: () => odf.length, delete: vi.fn(), get: () => 0 };
  const engine = {
    OnsetDetectionGlobal: vi.fn(() => ({ onsetDetections: detections })),
    vectorToArray: vi.fn(() => odf),
  } as unknown as TempoEngine;
  return { engine, detections };
}

describe('tempo correction', () => {
  it('matches the offline tuning script on recorded tempograms', () => {
    expect(cases.length).toBeGreaterThan(10);
    for (const c of cases) expect(correctTempo(c.tempogram, c.bpm), c.id).toBeCloseTo(c.expected, 6);
    expect(cases.some(c => Math.abs(c.expected - c.bpm) > 1)).toBe(true);
  });
  it('builds a tempogram that peaks at the pulse tempo and releases the onset vector', () => {
    // 43 frames at 86.13 frames per second is 120.2 BPM.
    const { engine, detections } = engineFor(pulses(43));
    const tg = beatTempogram(engine, {} as never);
    expect(tg).toHaveLength(211);
    expect(tg[120 - 40]).toBeGreaterThan(0.5);
    expect(tg[100 - 40]).toBeLessThan(0.1);
    expect(detections.delete).toHaveBeenCalledOnce();
  });
  it('leaves the tempo alone when the onset function has no periodicity', () => {
    const { engine } = engineFor(new Float32Array(860));
    expect(correctTempo(beatTempogram(engine, {} as never), 93)).toBe(93);
  });
});
