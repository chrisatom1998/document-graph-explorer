/**
 * Shared low-level Gemini REST plumbing: retry/backoff policy, SSE
 * (Server-Sent Events) stream-line parsing, and error-response-body
 * extraction. Used by both the RAG chat engine (ragChat.ts) and the
 * enrichment/doc-AI client (enrich/gemini.ts) so neither duplicates it.
 *
 * Deliberately low-level: each caller keeps its own retry LOOP (they differ —
 * e.g. ragChat never retries once a stream has started emitting content,
 * while enrichment retries network failures too) but shares the primitives
 * that loop calls.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff delay (ms) for a given zero-based retry attempt. */
export function backoffDelayMs(attempt: number): number {
  return 1000 * 2 ** attempt;
}

/** HTTP statuses worth retrying: rate limit + transient overload. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503;
}

/**
 * Best-effort extraction of the Gemini API's `{"error":{"message":...}}`
 * error-response body. Never throws — returns `null` if the body isn't JSON
 * or doesn't have the expected shape. Consumes `res`'s body.
 */
export async function readErrorMessage(res: Response, maxLen = 200): Promise<string | null> {
  try {
    const data = (await res.json()) as { error?: { message?: unknown } };
    if (typeof data.error?.message === 'string') {
      return data.error.message.slice(0, maxLen);
    }
  } catch {
    // body wasn't JSON (or already consumed) — ignore
  }
  return null;
}

// ---------------------------------------------------------------------------
// SSE stream parsing
// ---------------------------------------------------------------------------

export interface GeminiStreamEvent {
  /** Text from every part of the first candidate, concatenated in order. */
  text: string;
  /** Error message reported inline in the stream body (not an HTTP error). */
  error?: string;
  /** Why generation stopped short — a safety block, recitation flag, etc. */
  blockReason?: string;
}

/**
 * Parse one SSE `"data: {...}"` line into a `GeminiStreamEvent`, or `null`
 * for lines that carry nothing (blank lines, `"event:"` framing, `[DONE]`,
 * or malformed/partial JSON mid-stream). Never throws.
 */
export function parseSseLine(rawLine: string): GeminiStreamEvent | null {
  const line = rawLine.trim();
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;

  let evt: {
    candidates?: { content?: { parts?: { text?: unknown }[] }; finishReason?: unknown }[];
    promptFeedback?: { blockReason?: unknown };
    error?: { message?: unknown };
  };
  try {
    evt = JSON.parse(payload);
  } catch {
    return null; // partial/keepalive line — ignore
  }

  const result: GeminiStreamEvent = { text: '' };
  if (typeof evt.error?.message === 'string') result.error = evt.error.message;
  if (typeof evt.promptFeedback?.blockReason === 'string') {
    result.blockReason = evt.promptFeedback.blockReason;
  }
  const candidate = evt.candidates?.[0];
  const finish = candidate?.finishReason;
  if (typeof finish === 'string' && finish !== 'STOP' && finish !== 'MAX_TOKENS') {
    result.blockReason = finish; // SAFETY / RECITATION / OTHER
  }
  for (const part of candidate?.content?.parts ?? []) {
    if (typeof part.text === 'string' && part.text) result.text += part.text;
  }
  return result;
}

/**
 * Feed one more raw chunk of decoded SSE text into a line buffer, returning
 * the complete lines it now contains and the new (possibly-partial)
 * remainder to carry forward. Network reads can split a line mid-way, so the
 * remainder must be prepended to the next chunk — callers do that by passing
 * it back in as `pending` on the next call.
 */
export function splitSseLines(pending: string, chunk: string): { lines: string[]; remainder: string } {
  const combined = pending + chunk;
  const lines = combined.split('\n');
  const remainder = lines.pop() ?? '';
  return { lines, remainder };
}
