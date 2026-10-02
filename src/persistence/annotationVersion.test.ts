import { afterEach, expect, it, vi } from 'vitest';
import { ANNOTATION_CLOCK_SKEW_MS, annotationVersion, validAnnotationVersion, validPeerAnnotationVersion } from './annotationVersion';

afterEach(() => vi.restoreAllMocks());

it('reserves local logical headroom beyond the peer skew boundary', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  const peerLimit = 1000 + ANNOTATION_CLOCK_SKEW_MS;
  expect(validPeerAnnotationVersion(peerLimit)).toBe(true);
  expect(validPeerAnnotationVersion(peerLimit + 1)).toBe(false);
  expect(validAnnotationVersion(peerLimit + 1)).toBe(true);
  expect(validAnnotationVersion(1000 + 2 * ANNOTATION_CLOCK_SKEW_MS)).toBe(true);
  expect(annotationVersion(1001 + 2 * ANNOTATION_CLOCK_SKEW_MS)).toBe(0);
});

it.each([Number.MAX_SAFE_INTEGER, Infinity, NaN, -1, 1.5, '1000', null])('removes ordering authority from malformed clock %s', value => {
  expect(validPeerAnnotationVersion(value)).toBe(false);
  expect(annotationVersion(value)).toBe(0);
});
