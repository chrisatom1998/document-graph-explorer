import { describe, expect, it } from 'vitest';
import { isSeamlessLoop, wrapDropPercentile } from './loopWrap';

// Plucked notes, one per beat, that die away before the next; beats fall on whole analysis hops.
const BEAT = 256 * 86, NOTES = [440, 554, 659, 554];
function plucks(beats: number) {
  return Float32Array.from({ length: Math.round(beats * BEAT) }, (_, i) => {
    const t = (i % BEAT) / 44100;
    return 0.5 * Math.min(1, t * 200) * Math.exp(-t * 20) * Math.sin(2 * Math.PI * NOTES[Math.floor(i / BEAT) % 4] * t);
  });
}

describe('seamless loop check', () => {
  it('treats a recording cut on the beat grid as a loop', () => {
    const loop = plucks(8);   // two bars: the wrap is just the next pluck
    expect(wrapDropPercentile(loop)).toBeLessThan(0.95);
    expect(isSeamlessLoop(loop)).toBe(true);
  });
  it('treats a recording that ends mid-note as an excerpt', () => {
    const cut = plucks(8.1);   // ends 50 ms into a loud pluck, which the wrap silences at once
    expect(wrapDropPercentile(cut)).toBeGreaterThanOrEqual(0.95);
    expect(isSeamlessLoop(cut)).toBe(false);
  });
  it('gives no answer for a recording too short to judge', () => {
    expect(wrapDropPercentile(new Float32Array(2048))).toBeUndefined();
    expect(isSeamlessLoop(new Float32Array(2048))).toBe(false);
  });
});
