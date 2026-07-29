/**
 * `parseModelJson` parses a model's JSON output, tolerating the markdown code
 * fences some models wrap it in despite the JSON-only instruction. (The SSE
 * framing that carries the text is covered in chat/openRouterClient.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { parseModelJson } from './enrichment';

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
