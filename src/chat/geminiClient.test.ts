import { describe, expect, it } from 'vitest';
import {
  backoffDelayMs,
  isRetryableStatus,
  parseSseLine,
  readErrorMessage,
  splitSseLines,
} from './geminiClient';

describe('isRetryableStatus', () => {
  it('treats 429 (rate limit) and 503 (overload) as retryable', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it('treats other statuses as non-retryable', () => {
    expect(isRetryableStatus(200)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(500)).toBe(false);
  });
});

describe('backoffDelayMs', () => {
  it('doubles each attempt starting at 1000ms', () => {
    expect(backoffDelayMs(0)).toBe(1000);
    expect(backoffDelayMs(1)).toBe(2000);
    expect(backoffDelayMs(2)).toBe(4000);
    expect(backoffDelayMs(3)).toBe(8000);
  });
});

describe('readErrorMessage', () => {
  it('extracts a string error.message from a JSON body', async () => {
    const res = new Response(JSON.stringify({ error: { message: 'quota exceeded' } }));
    expect(await readErrorMessage(res)).toBe('quota exceeded');
  });

  it('truncates the message to maxLen', async () => {
    const res = new Response(JSON.stringify({ error: { message: 'x'.repeat(300) } }));
    expect(await readErrorMessage(res, 10)).toBe('x'.repeat(10));
  });

  it('returns null for a non-JSON body instead of throwing', async () => {
    const res = new Response('not json');
    expect(await readErrorMessage(res)).toBeNull();
  });

  it('returns null when error.message is missing or not a string', async () => {
    expect(await readErrorMessage(new Response(JSON.stringify({})))).toBeNull();
    expect(await readErrorMessage(new Response(JSON.stringify({ error: {} })))).toBeNull();
    expect(
      await readErrorMessage(new Response(JSON.stringify({ error: { message: 42 } }))),
    ).toBeNull();
  });
});

describe('splitSseLines', () => {
  it('splits a chunk with complete lines, carrying no remainder', () => {
    const { lines, remainder } = splitSseLines('', 'data: a\ndata: b\n');
    expect(lines).toEqual(['data: a', 'data: b']);
    expect(remainder).toBe('');
  });

  it('holds back a trailing partial line as the remainder', () => {
    const { lines, remainder } = splitSseLines('', 'data: a\ndata: par');
    expect(lines).toEqual(['data: a']);
    expect(remainder).toBe('data: par');
  });

  it('prepends the previous remainder to the next chunk', () => {
    const { lines, remainder } = splitSseLines('data: par', 'tial\ndata: next\n');
    expect(lines).toEqual(['data: partial', 'data: next']);
    expect(remainder).toBe('');
  });

  it('handles a chunk with no newlines at all as pure remainder', () => {
    const { lines, remainder } = splitSseLines('', 'no newline here');
    expect(lines).toEqual([]);
    expect(remainder).toBe('no newline here');
  });
});

describe('parseSseLine', () => {
  it('returns null for blank lines and non-"data:" framing', () => {
    expect(parseSseLine('')).toBeNull();
    expect(parseSseLine('   ')).toBeNull();
    expect(parseSseLine('event: message')).toBeNull();
  });

  it('returns null for "[DONE]" sentinel', () => {
    expect(parseSseLine('data: [DONE]')).toBeNull();
    expect(parseSseLine('data:[DONE]')).toBeNull();
  });

  it('returns null for malformed/partial JSON instead of throwing', () => {
    expect(parseSseLine('data: {not valid json')).toBeNull();
  });

  it('concatenates text across ALL parts, not just the first', () => {
    const line = `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Hello, ' }, { text: 'world!' }] } }],
    })}`;
    expect(parseSseLine(line)).toEqual({ text: 'Hello, world!' });
  });

  it('ignores parts with a non-string or missing text', () => {
    const line = `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'ok' }, { text: 42 }, {}] } }],
    })}`;
    expect(parseSseLine(line)).toEqual({ text: 'ok' });
  });

  it('accepts "data:" without a following space', () => {
    const line = `data:${JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'no space' }] } }],
    })}`;
    expect(parseSseLine(line)?.text).toBe('no space');
  });

  it('surfaces an inline error message from the stream body', () => {
    const line = `data: ${JSON.stringify({ error: { message: 'stream failed' } })}`;
    expect(parseSseLine(line)).toEqual({ text: '', error: 'stream failed' });
  });

  it('surfaces promptFeedback.blockReason (a safety block)', () => {
    const line = `data: ${JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })}`;
    expect(parseSseLine(line)).toEqual({ text: '', blockReason: 'SAFETY' });
  });

  it('treats a non-STOP/MAX_TOKENS finishReason as a block reason', () => {
    const line = `data: ${JSON.stringify({
      candidates: [{ content: { parts: [] }, finishReason: 'RECITATION' }],
    })}`;
    expect(parseSseLine(line)).toEqual({ text: '', blockReason: 'RECITATION' });
  });

  it('does not treat STOP or MAX_TOKENS as a block reason', () => {
    const stop = `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }],
    })}`;
    expect(parseSseLine(stop)).toEqual({ text: 'done' });

    const maxTokens = `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'truncated' }] }, finishReason: 'MAX_TOKENS' }],
    })}`;
    expect(parseSseLine(maxTokens)).toEqual({ text: 'truncated' });
  });
});
