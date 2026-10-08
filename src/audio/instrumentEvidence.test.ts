import { describe, expect, it } from 'vitest';
import { InstrumentEvidence, instrumentWindowStarts } from './instrumentEvidence';
import { instrumentScores, musicScore } from './instrumentLabels';
import { instrumentWindows, type MusicDecoder } from './decodeMusic';
import { sanitizeMusicAnalysis } from './musicTypes';

describe('full track instrument detection', () => {
  it('covers short clips, boundaries and the end without tiny padded windows', () => {
    expect(instrumentWindowStarts(0)).toEqual([]);
    expect(instrumentWindowStarts(3)).toEqual([0]);
    expect(instrumentWindowStarts(10)).toEqual([0]);
    expect(instrumentWindowStarts(22)).toEqual([0, 5, 10, 12]);
  });
  it('covers long tracks in bounded decoding batches', async () => {
    const calls: number[] = [];
    const decoder: MusicDecoder = { durationSeconds: 153, close() {}, async read(start, seconds, rate) { calls.push(seconds); return new Float32Array(Math.max(0, Math.min(seconds, 153 - start)) * rate); } };
    let covered = 0;
    for await (const window of instrumentWindows(decoder)) {
      expect(window.start).toBeLessThanOrEqual(covered);
      expect(window.samples.length).toBeLessThanOrEqual(160000);
      covered = Math.max(covered, window.end);
    }
    expect(covered).toBe(153);
    expect(Math.max(...calls)).toBe(65);
  });
  it('discovers the end even when a container has no duration metadata', async () => {
    const decoder: MusicDecoder = { durationSeconds: 0, close() {}, async read(start, seconds, rate) { return new Float32Array(Math.max(0, Math.min(seconds, 73 - start)) * rate); } };
    const windows = [];
    for await (const window of instrumentWindows(decoder)) windows.push(window);
    expect(windows.at(-1)?.end).toBe(73);
  });
  it('retains a strong instrument in one passage instead of averaging it away', () => {
    const evidence = new InstrumentEvidence();
    evidence.add({ trumpet: 0.94 }, 0, 10);
    for (let start = 10; start < 180; start += 5) evidence.add({ trumpet: 0.02 }, start, start + 10);
    expect(evidence.results()).toMatchObject([{ label: 'trumpet', status: 'likely', segments: [{ start: 0, end: 10 }] }]);
  });
  it('retains scored provenance beyond the five strongest listenable examples through save and reload', () => {
    const evidence = new InstrumentEvidence();
    for (let start = 75; start <= 95; start += 5) evidence.add({ piano: .9 }, start, start + 10);
    evidence.add({ piano: .4 }, 170, 180);
    const instruments = evidence.results();
    expect(instruments[0].segments).toHaveLength(5);
    expect(instruments[0].segments!.every(s => s.start < 170)).toBe(true);
    const saved = sanitizeMusicAnalysis({ version: 2, durationSeconds: 180, analyzedSeconds: 60, instruments, notes: [] })!;
    expect(saved.instruments[0].windowEvidence).toMatchObject({ complete: true, windows: expect.arrayContaining([{ start: 170, end: 180, score: .4 }]) });
    expect(saved.instruments[0].windowEvidence!.windows).toHaveLength(6);
  });
  it('separates weaker guesses and does not count a nearly identical tail twice', () => {
    const evidence = new InstrumentEvidence();
    evidence.add({ cello: 0.65, trumpet: 0.4, piano: 0.1 }, 0, 10);
    evidence.add({ cello: 0.65, trumpet: 0.4 }, 0.1, 10.1);
    expect(evidence.results()).toMatchObject([{ label: 'cello', status: 'possible', windows: 1 }]);
    evidence.add({ cello: 0.65, trumpet: 0.4 }, 5, 15);
    expect(evidence.results()).toMatchObject([{ label: 'cello', status: 'likely', windows: 2 }, { label: 'trumpet', status: 'possible' }]);
  });
  it('preserves all qualifying instruments and prefers specific names over parent families', () => {
    const evidence = new InstrumentEvidence();
    evidence.add(Object.fromEntries(['trumpet', 'brass instrument', 'cello', 'sitar', 'tabla', 'flute', 'piano', 'organ', 'harp', 'banjo', 'ukulele', 'synthesizer'].map(s => [s, 0.95])), 0, 10);
    expect(evidence.results()).toHaveLength(11);
    expect(evidence.results().some(i => i.label === 'brass instrument')).toBe(false);
  });
  it('keeps instrument distinctions and excludes performance techniques', () => {
    expect(instrumentScores([3, 3, 3, 3, 3], { 0: 'Cello', 1: 'Violin, fiddle', 2: 'Tabla', 3: 'Strum', 4: 'Music' }))
      .toEqual({ cello: expect.any(Number), 'violin / fiddle': expect.any(Number), tabla: expect.any(Number) });
  });
  it('safely persists scan coverage, more than eight instruments, and timestamp evidence', () => {
    const instruments = Array.from({ length: 16 }, (_, i) => ({ label: `instrument ${i}`, score: 0.9, status: 'likely', windows: 2, segments: [{ start: 70, end: 80, score: 0.9 }, { start: -1, end: 400, score: 9 }] }));
    const result = sanitizeMusicAnalysis({ version: 2, durationSeconds: 180, analyzedSeconds: 60, instruments, notes: [], instrumentScan: { complete: true, analyzedSeconds: 180, windows: 35 } });
    expect(result?.instruments).toHaveLength(16);
    expect(result?.instruments[0].segments).toEqual([{ start: 70, end: 80, score: 0.9 }]);
    expect(result?.instrumentScan?.analyzedSeconds).toBe(180);
    expect(sanitizeMusicAnalysis({ version: 1, durationSeconds: 180, analyzedSeconds: 60, instruments: [], notes: [] })?.version).toBe(1);
  });
});


describe('weak instrument suggestions', () => {
  it('shows a dominant synth candidate in music without treating it as likely', () => {
    const evidence = new InstrumentEvidence();
    evidence.add({ synthesizer: 0.1152, sampler: 0.0207, piano: 0.0064 }, 0, 6.85, 0.9);
    expect(evidence.results()).toMatchObject([{ label: 'synthesizer', score: 0.1152, status: 'possible', segments: [{ start: 0, end: 6.85 }] }]);
  });
  it('does not turn noise, ambiguous rankings, tiny scores, or broad families into suggestions', () => {
    for (const [scores, context] of [
      [{ synthesizer: 0.2, sampler: 0.02 }, 0.1],
      [{ synthesizer: 0.2, piano: 0.15 }, 0.9],
      [{ synthesizer: 0.03, piano: 0.001 }, 0.9],
      [{ 'keyboard (musical)': 0.2, piano: 0.02 }, 0.9],
    ] as [Record<string, number>, number][]) {
      const evidence = new InstrumentEvidence();
      evidence.add(scores, 0, 5, context);
      expect(evidence.results()).toEqual([]);
    }
  });
  it('keeps repeated weak guesses possible and prefers supported detections', () => {
    const evidence = new InstrumentEvidence();
    for (let start = 0; start < 30; start += 5) evidence.add({ synthesizer: 0.12, sampler: 0.02 }, start, start + 10, 0.9);
    expect(evidence.results()[0].status).toBe('possible');
    evidence.add({ piano: 0.92 }, 30, 40, 0.9);
    expect(evidence.results()).toMatchObject([{ label: 'piano', status: 'likely' }]);
  });
  it('reads music context separately and preserves analysis revisions on reload', () => {
    expect(musicScore([0, 2], { 0: 'Piano', 1: 'Music' })).toBeGreaterThan(0.8);
    expect(musicScore([2], { 0: 'Piano' })).toBe(0);
    const restored = sanitizeMusicAnalysis({ version: 2, durationSeconds: 7, analyzedSeconds: 7, notes: [], instruments: [{ label: 'synthesizer', score: 0.12, status: 'possible' }], instrumentScan: { revision: 2, complete: true, analyzedSeconds: 7, windows: 1 } });
    expect(restored?.instrumentScan?.revision).toBe(2);
    expect(restored?.instruments[0].status).toBe('possible');
  });
});
