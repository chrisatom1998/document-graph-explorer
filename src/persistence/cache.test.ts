import { describe, expect, it } from 'vitest';
import { EMBED_DIMS } from '../config';
import { validChunkVectors, validDocVector } from './cache';

describe('cached embedding validation', () => {
  it('accepts only document vectors with the configured dimensions', () => {
    expect(validDocVector(new Float32Array(EMBED_DIMS))).toBe(true);
    expect(validDocVector(new Float32Array(EMBED_DIMS - 1))).toBe(false);
    expect(validDocVector(new Float32Array(0))).toBe(false);
    expect(validDocVector(undefined)).toBe(false);
  });

  it('requires exactly one configured-width vector per chunk', () => {
    expect(validChunkVectors(new Float32Array(2 * EMBED_DIMS), 2)).toBe(true);
    expect(validChunkVectors(new Float32Array(2 * EMBED_DIMS - 1), 2)).toBe(false);
    expect(validChunkVectors(new Float32Array(EMBED_DIMS), 0)).toBe(false);
    expect(validChunkVectors(undefined, 2)).toBe(false);
  });
});
