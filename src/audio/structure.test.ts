import { describe, expect, it } from 'vitest';
import { detectStructure, StructureFeatures, STRUCTURE_RATE } from './structure';

/** A synthetic 128 BPM arrangement: each part switches kick, bass and a pad on or off. */
function arrangement(parts: { seconds: number; kick: boolean; bass: boolean; pad: boolean }[]) {
  const total = parts.reduce((n, p) => n + p.seconds, 0), out = new Float32Array(Math.round(total * STRUCTURE_RATE));
  const beat = 60 / 128;
  let t0 = 0, seed = 1;
  const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  for (const p of parts) {
    const from = Math.round(t0 * STRUCTURE_RATE), to = Math.round((t0 + p.seconds) * STRUCTURE_RATE);
    for (let i = from; i < to; i++) {
      const t = i / STRUCTURE_RATE, sinceBeat = t % beat;
      let v = 0;
      if (p.kick) v += 0.6 * Math.exp(-sinceBeat * 18) * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-sinceBeat * 30)) * sinceBeat);
      if (p.bass) v += 0.35 * Math.sin(2 * Math.PI * 55 * t) * (sinceBeat > 0.1 ? 1 : 0.3);
      if (p.pad) v += 0.08 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 554 * t)) + 0.01 * noise();
      out[i] = v;
    }
    t0 += p.seconds;
  }
  return out;
}

function features(samples: Float32Array) {
  const f = new StructureFeatures();
  // Uneven chunks, as the decoder hands them over.
  for (let i = 0; i < samples.length; i += 70001) f.add(samples.subarray(i, i + 70001));
  return f.blocks;
}

describe('track structure', () => {
  it('finds the drops of an intro / drop / breakdown / drop / outro arrangement', () => {
    const blocks = features(arrangement([
      { seconds: 30, kick: true, bass: false, pad: false },
      { seconds: 45, kick: true, bass: true, pad: true },
      { seconds: 30, kick: false, bass: false, pad: true },
      { seconds: 45, kick: true, bass: true, pad: true },
      { seconds: 20, kick: true, bass: false, pad: false },
    ]));
    const s = detectStructure(blocks);
    expect(s.drops).toHaveLength(2);
    expect(Math.abs(s.drops[0] - 30)).toBeLessThan(1);
    expect(Math.abs(s.drops[1] - 105)).toBeLessThan(1);
    expect(s.sections.map(x => x.label)).toEqual(['intro', 'drop', 'breakdown', 'drop', 'outro']);
  });

  it('reports nothing for a steady loop', () => {
    const blocks = features(arrangement([{ seconds: 90, kick: true, bass: true, pad: true }]));
    expect(detectStructure(blocks).drops).toEqual([]);
  });

  it('reports nothing for a short clip', () => {
    const blocks = features(arrangement([{ seconds: 20, kick: true, bass: false, pad: false }, { seconds: 30, kick: true, bass: true, pad: true }]));
    expect(detectStructure(blocks).sections).toEqual([]);
  });
});
