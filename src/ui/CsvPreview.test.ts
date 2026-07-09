import { describe, expect, it } from 'vitest';
import { parseCsv } from './CsvPreview';

describe('parseCsv', () => {
  it('parses a simple header + rows', () => {
    expect(parseCsv('a,b,c\n1,2,3\n4,5,6')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('parses quoted fields, including embedded commas and newlines', () => {
    const input = 'name,note\n"Doe, John","multi\nline note"\n';
    expect(parseCsv(input)).toEqual([
      ['name', 'note'],
      ['Doe, John', 'multi\nline note'],
    ]);
  });

  it('unescapes doubled quotes ("" -> ") inside a quoted field', () => {
    expect(parseCsv('a\n"she said ""hi"""')).toEqual([['a'], ['she said "hi"']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops a single trailing blank row from a final newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles malformed input: unbalanced quotes and ragged row lengths without throwing', () => {
    const input = 'a,b,c\n1,"unterminated,2\n3,4';
    expect(() => parseCsv(input)).not.toThrow();
    const rows = parseCsv(input);
    expect(rows[0]).toEqual(['a', 'b', 'c']);
    // Everything after the unterminated quote is swallowed into that field
    // (including the following newline) since no closing quote was found.
    expect(rows.length).toBe(2);
    expect(rows[1][0]).toBe('1');
  });

  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('treats a single blank line as producing no rows (trailing-blank-row cleanup)', () => {
    expect(parseCsv('\n')).toEqual([]);
  });

  it('keeps a genuine blank row that is not the trailing one', () => {
    expect(parseCsv('a\n\nb')).toEqual([['a'], [''], ['b']]);
  });
});
