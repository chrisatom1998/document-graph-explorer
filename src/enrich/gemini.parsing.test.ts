/**
 * Pure parsing helpers from gemini.ts: `extractText` (pulls the first
 * candidate's first part's text out of a `generateContent` JSON response) and
 * `parseModelJson` (parses a model's JSON output, tolerating markdown code
 * fences some models wrap it in despite the strict `responseMimeType`).
 */
import { describe, expect, it } from 'vitest';
import { extractText, parseModelJson } from './gemini';

describe('extractText', () => {
  it('extracts the first candidate/part text', () => {
    const data = { candidates: [{ content: { parts: [{ text: 'hello' }] } }] };
    expect(extractText(data)).toBe('hello');
  });

  it('returns null for null/undefined input', () => {
    expect(extractText(null)).toBeNull();
    expect(extractText(undefined)).toBeNull();
  });

  it('returns null when candidates is missing or empty', () => {
    expect(extractText({})).toBeNull();
    expect(extractText({ candidates: [] })).toBeNull();
  });

  it('returns null when the text field is missing or not a string', () => {
    expect(extractText({ candidates: [{ content: { parts: [{}] } }] })).toBeNull();
    expect(
      extractText({ candidates: [{ content: { parts: [{ text: 42 }] } }] }),
    ).toBeNull();
  });

  it('returns null for a malformed/unexpected shape instead of throwing', () => {
    expect(extractText('not an object')).toBeNull();
    expect(extractText(42)).toBeNull();
    expect(extractText({ candidates: 'not an array' })).toBeNull();
  });
});

describe('parseModelJson', () => {
  it('parses plain JSON', () => {
    expect(parseModelJson<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it('parses JSON wrapped in a ```json code fence', () => {
    const wrapped = '```json\n{"a": 1}\n```';
    expect(parseModelJson<{ a: number }>(wrapped)).toEqual({ a: 1 });
  });

  it('parses JSON wrapped in a plain ``` code fence (no language tag)', () => {
    const wrapped = '```\n{"a": 1}\n```';
    expect(parseModelJson<{ a: number }>(wrapped)).toEqual({ a: 1 });
  });

  it('tolerates leading/trailing whitespace around a fenced block', () => {
    const wrapped = '  ```json\n{"a": 1}\n```  ';
    expect(parseModelJson<{ a: number }>(wrapped)).toEqual({ a: 1 });
  });

  it('returns null for malformed JSON instead of throwing', () => {
    expect(parseModelJson('{not valid json')).toBeNull();
  });

  it('returns null for a fenced block that still is not valid JSON', () => {
    expect(parseModelJson('```json\nnot json\n```')).toBeNull();
  });

  it('parses arrays, not just objects', () => {
    expect(parseModelJson<number[]>('[1, 2, 3]')).toEqual([1, 2, 3]);
  });
});
