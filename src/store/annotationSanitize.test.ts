import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ANNOTATION_KEY_CHARS,
  MAX_ANNOTATION_NOTE_CHARS,
  MAX_ANNOTATION_RECORDS,
  MAX_ANNOTATION_TAGS,
  MAX_ANNOTATION_TAG_CHARS,
  MAX_CLOCK_SKEW_MS,
  isValidAnnotationKey,
  sanitizeAnnotationMap,
  sanitizeAnnotationRecord,
} from './annotationSanitize';

afterEach(() => {
  vi.useRealTimers();
});

describe('sanitizeAnnotationRecord', () => {
  it('keeps a well-formed record intact', () => {
    const record = sanitizeAnnotationRecord({
      note: 'a note',
      tags: ['one', 'two'],
      pinned: true,
      updatedAt: 1234,
    });
    expect(record).toEqual({ note: 'a note', tags: ['one', 'two'], pinned: true, updatedAt: 1234 });
  });

  it('clamps an oversized note', () => {
    const record = sanitizeAnnotationRecord({ note: 'x'.repeat(MAX_ANNOTATION_NOTE_CHARS + 500) });
    expect(record?.note).toHaveLength(MAX_ANNOTATION_NOTE_CHARS);
  });

  it('caps the tag count and each tag length', () => {
    const record = sanitizeAnnotationRecord({
      tags: Array.from({ length: MAX_ANNOTATION_TAGS + 20 }, () =>
        'y'.repeat(MAX_ANNOTATION_TAG_CHARS + 50),
      ),
    });
    expect(record?.tags).toHaveLength(MAX_ANNOTATION_TAGS);
    expect(record?.tags.every((tag) => tag.length === MAX_ANNOTATION_TAG_CHARS)).toBe(true);
  });

  it('drops non-string tags without dropping the record', () => {
    const record = sanitizeAnnotationRecord({ tags: ['keep', 42, null, { a: 1 }, 'also'] });
    expect(record?.tags).toEqual(['keep', 'also']);
  });

  it('rejects values that are not records', () => {
    expect(sanitizeAnnotationRecord(null)).toBeNull();
    expect(sanitizeAnnotationRecord('note')).toBeNull();
    expect(sanitizeAnnotationRecord([1, 2])).toBeNull();
  });

  it('clamps a far-future timestamp so a peer cannot win last-write-wins forever', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const ceiling = Date.now() + MAX_CLOCK_SKEW_MS;

    expect(sanitizeAnnotationRecord({ updatedAt: Number.MAX_SAFE_INTEGER })?.updatedAt).toBe(
      ceiling,
    );
    expect(sanitizeAnnotationRecord({ updatedAt: Infinity })?.updatedAt).toBe(0);
    expect(sanitizeAnnotationRecord({ updatedAt: -5 })?.updatedAt).toBe(0);
  });

  it('falls back to the caller-supplied timestamp when one is missing', () => {
    expect(sanitizeAnnotationRecord({ note: 'n' }, 99)?.updatedAt).toBe(99);
    expect(sanitizeAnnotationRecord({ note: 'n' })?.updatedAt).toBe(0);
  });
});

describe('isValidAnnotationKey', () => {
  it('accepts ordinary keys and rejects empty or oversized ones', () => {
    expect(isValidAnnotationKey('docs/readme.md')).toBe(true);
    expect(isValidAnnotationKey('')).toBe(false);
    expect(isValidAnnotationKey('k'.repeat(MAX_ANNOTATION_KEY_CHARS + 1))).toBe(false);
  });
});

describe('sanitizeAnnotationMap', () => {
  it('rejects records under an oversized key rather than truncating it', () => {
    const out = sanitizeAnnotationMap({
      good: { note: 'kept' },
      ['k'.repeat(MAX_ANNOTATION_KEY_CHARS + 1)]: { note: 'dropped' },
    });
    expect(Object.keys(out)).toEqual(['good']);
  });

  it('caps the number of records kept', () => {
    const raw: Record<string, unknown> = {};
    for (let i = 0; i < MAX_ANNOTATION_RECORDS + 100; i++) raw[`key-${i}`] = { note: 'n' };
    expect(Object.keys(sanitizeAnnotationMap(raw))).toHaveLength(MAX_ANNOTATION_RECORDS);
  });

  it('terminates on a large map of entries that are all invalid', () => {
    const raw: Record<string, unknown> = {};
    for (let i = 0; i < 5000; i++) raw[`bad-${i}`] = null;
    expect(sanitizeAnnotationMap(raw)).toEqual({});
  });

  it('returns an empty map for non-object input', () => {
    expect(sanitizeAnnotationMap(undefined)).toEqual({});
    expect(sanitizeAnnotationMap([] as unknown as Record<string, unknown>)).toEqual({});
  });
});
