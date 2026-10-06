import { describe, expect, it } from 'vitest';
import { detectStructure, StructureFeatures } from './structure';
import { arrangement } from './structureArrangement.testutil';

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
