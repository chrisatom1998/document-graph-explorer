import { describe, expect, it } from 'vitest';
import { base64ToF32, f32ToBase64 } from './f32base64';

describe('f32 <-> base64 round-trip', () => {
  it('round-trips an exact-value vector bit-for-bit', () => {
    const v = new Float32Array([0, 1, -1, 3.5, -2.25, 1e10, -1e-10, Math.PI]);
    const back = base64ToF32(f32ToBase64(v));
    expect(Array.from(back)).toEqual(Array.from(v));
  });

  it('round-trips an empty vector', () => {
    const back = base64ToF32(f32ToBase64(new Float32Array(0)));
    expect(back.length).toBe(0);
  });

  it('preserves special float values (NaN, +/-Infinity, -0)', () => {
    const v = new Float32Array([NaN, Infinity, -Infinity, -0]);
    const back = base64ToF32(f32ToBase64(v));
    expect(Number.isNaN(back[0])).toBe(true);
    expect(back[1]).toBe(Infinity);
    expect(back[2]).toBe(-Infinity);
    expect(Object.is(back[3], -0)).toBe(true);
  });

  it('round-trips a large vector past the fromCharCode chunk boundary', () => {
    // > 0x8000 bytes forces multiple String.fromCharCode chunks in the encoder
    const v = new Float32Array(20_000);
    for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1000;
    const back = base64ToF32(f32ToBase64(v));
    expect(Array.from(back)).toEqual(Array.from(v));
  });

  it('f32ToBase64 respects a subarray byteOffset (does not read the whole buffer)', () => {
    const full = new Float32Array([9, 9, 1, 2, 3]);
    const view = full.subarray(2); // [1, 2, 3], non-zero byteOffset
    const back = base64ToF32(f32ToBase64(view));
    expect(Array.from(back)).toEqual([1, 2, 3]);
  });

  it('drops a trailing partial float instead of throwing on a non-multiple-of-4 payload', () => {
    // 6 raw bytes -> only one whole float (4 bytes) is decodable; 2 are dropped.
    const truncated = btoa('abcdef');
    const back = base64ToF32(truncated);
    expect(back.length).toBe(1);
  });
});
