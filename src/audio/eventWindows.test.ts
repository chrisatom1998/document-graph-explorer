import { describe, expect, it } from 'vitest';
import shortClip from '../../public/sound-model/short-clip.json';
import { EVENT_WINDOW_AFTER, EVENT_WINDOW_BEFORE, EVENT_WINDOW_LABELS, EventWindowEvidence, eventWindowBudget, onsetCandidates, pickEventStarts } from './eventWindows';
import type { DescriptionScore } from './profileDescriptions';

/** Quiet noise with loud 0.2 s bursts at the given times, at 16 kHz. */
function bursts(seconds: number, at: number[], level = .5) {
  const x = new Float32Array(Math.round(seconds * 16000));
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(i * 12.9898) * .002;
  for (const t of at) for (let i = Math.round(t * 16000); i < Math.min(x.length, Math.round((t + .2) * 16000)); i++) x[i] = Math.sin(i * .3) * level;
  return x;
}
const head = (label: string, score = .9, learnedGroup: DescriptionScore['learnedGroup'] = 'production'): DescriptionScore =>
  ({ group: 'dj-learned', label, score, learnedGroup, decision: 'include', basis: 'head' });

describe('onset candidates', () => {
  it('finds each burst start, offset by the chunk start', () => {
    const found = onsetCandidates(bursts(8, [1, 3, 5.5]), 30);
    for (const t of [31, 33, 35.5]) expect(found.some(c => Math.abs(c.time - t) < .03)).toBe(true);
  });
  it('finds nothing in steady audio or silence', () => {
    expect(onsetCandidates(new Float32Array(16000 * 4).fill(.1))).toEqual([]);
    expect(onsetCandidates(new Float32Array(16000 * 4))).toEqual([]);
  });
});

describe('picking window starts', () => {
  it('keeps the strongest starts, at least a second apart, that fit inside the recording, in time order', () => {
    const candidates = [{ time: 5, strength: 3 }, { time: 5.4, strength: 2.9 }, { time: 2, strength: 1 }, { time: .01, strength: 9 }, { time: 19.5, strength: 8 }, { time: 12, strength: 2 }];
    expect(pickEventStarts(candidates, 20, 3)).toEqual([2, 5, 12]);
  });
  it('allows one window per 15 seconds, at most 24', () => {
    expect([eventWindowBudget(10), eventWindowBudget(180), eventWindowBudget(3600), eventWindowBudget(0)]).toEqual([1, 12, 24, 0]);
  });
});

describe('event window evidence', () => {
  it('tags a measured label as maybe only once two windows agree, and ignores everything else', () => {
    const e = new EventWindowEvidence();
    e.add([head('vinyl scratch', .8), head('impact'), { group: 'source', label: 'piano', score: .9 }, { ...head('vinyl scratch'), basis: undefined }], 10, 12);
    expect(e.results()).toEqual([]);
    e.add([head('vinyl scratch', .95), head('synthesizer', .7, 'source')], 40, 42);
    expect(e.results()).toEqual([{ tag: { group: 'production', label: 'vinyl scratch', score: .95, model: 'Trained head (maybe)',
      windowEvidence: { windows: [{ start: 10, end: 12, score: .8 }, { start: 40, end: 42, score: .95 }], complete: true } },
      segments: [{ start: 10, end: 12 }, { start: 40, end: 42 }] }]);
  });
  it('only advertises labels the shipped one-shot model has a head for', () => {
    const shipped = new Set(shortClip.heads.map(h => h.label));
    expect([...EVENT_WINDOW_LABELS].filter(label => !shipped.has(label))).toEqual([]);
  });
  it('cuts a window that stays within the one-shot limit', () => {
    expect(EVENT_WINDOW_BEFORE + EVENT_WINDOW_AFTER).toBeLessThanOrEqual(2.25);
  });
});
