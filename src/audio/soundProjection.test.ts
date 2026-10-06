import { describe, expect, it } from 'vitest';
import { soundVector, type SoundProjection } from './soundProjection';

const int8 = (values: number[]) => btoa(String.fromCharCode(...values.map(v => v & 255)));
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
// 3-d input, 2-d output: keeps the first two coordinates.
const projection = (mix: number): SoundProjection => ({ inputDim: 3, outputDim: 2, activation: null, mix, neighbors: 3, floor: .5,
  layers: [{ rows: 2, cols: 3, weights: int8([127, 0, 0, 0, 127, 0]), scale: [1 / 127, 1 / 127], bias: [0, 0] }] });

describe('sound-alike projection', () => {
  it('blends raw and projected cosine by mix, and stays unit length', () => {
    const a = [1, 0, 0], b = [Math.SQRT1_2, 0, Math.SQRT1_2];
    const [pa, pb] = [soundVector(a, projection(.5)), soundVector(b, projection(.5))];
    expect(dot(pa, pa)).toBeCloseTo(1, 6);
    // raw cosine .707, projected cosine 1 (the third coordinate is dropped)
    expect(dot(pa, pb)).toBeCloseTo(.5 * Math.SQRT1_2 + .5, 6);
  });
  it('leaves fingerprints alone when mix is 0 or the size does not match', () => {
    expect(soundVector([1, 0, 0], projection(0))).toEqual([1, 0, 0]);
    expect(soundVector([1, 0], projection(.5))).toEqual([1, 0]);
  });
});
