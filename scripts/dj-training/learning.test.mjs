import { describe, it, expect } from 'vitest';
import { evaluateByFamily, normalize, predict, trainBinary } from './learning.mjs';
import { groupDuplicates, sampleFamily, shadowLabels } from './dataset.mjs';

describe('DJ classifier training', () => {
  it('learns separable sound features and ignores unreviewed targets', () => {
    const rows = [
      { vector: [1, 0], targets: { breath: 1 } },
      { vector: [0.9, 0.1], targets: { breath: 1 } },
      { vector: [0, 1], targets: { breath: 0 } },
      { vector: [0.1, 0.9], targets: { breath: 0 } },
      { vector: [1, 0], targets: {} },
    ];
    const head = trainBinary(rows, 'breath');
    expect(head.positives).toBe(2);
    expect(head.negatives).toBe(2);
    expect(predict(head, [1, 0])).toBeGreaterThan(0.85);
    expect(predict(head, [0, 1])).toBeLessThan(0.15);
    expect(() => predict(head, [1, 2, 3])).toThrow();
    expect(() => normalize([0, 0])).toThrow();
    expect(() => normalize([NaN, 1])).toThrow();
  });

  it('does not report successful chop validation when all positives are one family', () => {
    const rows = [
      { path: 'chop1', family: 'chop', vector: [1, 0], targets: { chop: 1 } },
      { path: 'chop2', family: 'chop', vector: [1, 0.1], targets: { chop: 1 } },
      { path: 'synth1', family: 'synth1', vector: [0, 1], targets: { chop: 0 } },
      { path: 'synth2', family: 'synth2', vector: [0.1, 1], targets: { chop: 0 } },
    ];
    const result = evaluateByFamily(rows, ['chop']).chop;
    expect(result.complete).toBe(false);
    expect(result.recall).toBeNull();
    expect(result.skipped).toEqual(['chop1', 'chop2']);
  });

  it('keeps variants and duplicated audio together, regardless of file name', () => {
    expect(sampleFamily('Vocal/SHADOW_UK1_CHOP 1.wav')).toBe(sampleFamily('Vocal/SHADOW_UK1_CHOP 5.wav'));
    const grouped = groupDuplicates([
      { family: 'a', sha256: 'a', vector: [1, 0] },
      { family: 'b', sha256: 'b', vector: normalize([1, 0.01]) },
      { family: 'c', sha256: 'c', vector: [0, 1] },
    ]);
    expect(grouped[0].family).toBe(grouped[1].family);
    expect(grouped[0].family).not.toBe(grouped[2].family);
  });

  it('uses confirmed pack labels without inventing a production type for every vocal', () => {
    expect(shadowLabels('Melodic/test.wav').targets['source:synthesizer']).toBe(1);
    expect(shadowLabels('Vocal/SHADOW_UK1_Vocal_BreathFemale2.wav').targets['production:vocal breath']).toBe(1);
    expect(shadowLabels('Vocal/SHADOW_UK1_CHOP 2.wav').targets).toEqual({});
    expect(shadowLabels('Vocal/SHADOW_UK1_.wav').targets).toEqual({});
    expect(shadowLabels('Vocal/ambiguous.wav').targets['production:vocal chops']).toBeUndefined();
    expect(shadowLabels('Vocal/ambiguous.wav').targets['source:synthesizer']).toBeUndefined();
    expect(shadowLabels('Bass Shots/ambiguous.wav').targets).toEqual({});
  });
});
