import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sustainedHeadMissing } from './nativeWindowEvidence';
import { DescriptionAccumulator, type DescriptionScore } from './profileDescriptions';
import { sanitizeLearnedDjModel } from './learnedDjModel';

const strings = (score: number): DescriptionScore => ({ group: 'dj-learned', label: 'strings', score, learnedGroup: 'source', decision: 'include', basis: 'head', minWindows: 2 });

describe('sustained-sound window vote (minWindows)', () => {
  it('needs the head in that many windows only when the recording has that many windows', () => {
    expect(sustainedHeadMissing(undefined, 5, undefined)).toBe(false);
    expect(sustainedHeadMissing(2, 1, { windows: [{ start: 0, end: 10 }] } as never)).toBe(false);
    expect(sustainedHeadMissing(2, 3, { windows: [{ start: 0, end: 10 }] } as never)).toBe(true);
    expect(sustainedHeadMissing(2, 3, { windows: [{ start: 0, end: 10 }, { start: 5, end: 15 }] } as never)).toBe(false);
    // Longer than the measured 30 s: unchanged.
    expect(sustainedHeadMissing(2, 6, { windows: [{ start: 0, end: 10 }] } as never)).toBe(false);
  });

  it('a strings head firing in one of three windows does not tag the recording; in two it does', () => {
    const once = new DescriptionAccumulator();
    once.add([strings(.9)], { start: 0, end: 10 }); once.add([], { start: 5, end: 15 }); once.add([], { start: 10, end: 20 });
    expect(once.average().some(s => s.label === 'strings')).toBe(false);
    const twice = new DescriptionAccumulator();
    twice.add([strings(.9)], { start: 0, end: 10 }); twice.add([strings(.9)], { start: 5, end: 15 }); twice.add([], { start: 10, end: 20 });
    expect(twice.average().some(s => s.label === 'strings')).toBe(true);
  });

  it('a single-window clip is never held back', () => {
    const one = new DescriptionAccumulator();
    one.add([strings(.9)], { start: 0, end: 5 });
    expect(one.average().some(s => s.label === 'strings')).toBe(true);
  });

  it('only sustained heads carry the vote, never single-event sounds', () => {
    const m = sanitizeLearnedDjModel(JSON.parse(readFileSync('public/sound-model/learned.json', 'utf8')))!;
    const voted = (m.heads ?? []).filter(h => h.minWindows).map(h => h.label).sort();
    expect(voted).toEqual(['gong', 'harmonica', 'organ', 'rain ambience', 'strings', 'viola', 'voice', 'water ambience']);
  });
});
