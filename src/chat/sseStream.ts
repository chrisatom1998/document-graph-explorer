/**
 * Shared SSE (server-sent events) plumbing for the OpenAI-compatible
 * streaming chat endpoints (OpenRouter and Ollama). Both providers use the
 * same wire format, so the line-buffered read loop and error-body parsing
 * live here once instead of being duplicated per client.
 */

/** One decoded SSE data line, as produced by a provider-specific line parser. */
export interface SseParsedEvent {
  text: string;
  error?: string;
  finishReason?: string;
}

export interface SseStreamResult {
  /** Accumulated text across the whole stream, not yet trimmed. */
  text: string;
  error?: string;
  finishReason?: string;
}

/**
 * Reads a streaming response body to completion, buffering partial lines
 * across chunk boundaries. Calls `onText` with the cumulative decoded text
 * whenever a completed line changes it, matching the incremental rendering
 * both chat clients need.
 */
export async function readSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  parseLine: (line: string) => SseParsedEvent | null,
  onText: (accumulated: string) => void,
): Promise<SseStreamResult> {
  const decoder = new TextDecoder();
  let pending = '';
  let accumulated = '';
  let error: string | undefined;
  let finishReason: string | undefined;

  const consume = (line: string) => {
    const event = parseLine(line);
    if (!event) return;
    if (event.error) error = event.error;
    if (event.finishReason) finishReason = event.finishReason;
    if (event.text) accumulated += event.text;
  };

  for (;;) {
    const { done, value } = await reader.read();
    const before = accumulated;
    if (value) {
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      lines.forEach(consume);
    }
    if (done) {
      pending += decoder.decode(); // flush any trailing partial byte sequence
      if (pending) consume(pending);
    }
    if (accumulated !== before) onText(accumulated);
    if (done) break;
  }

  return { text: accumulated, error, finishReason };
}

/**
 * Extracts a provider error message from a JSON error body shaped either
 * `{"error":"..."}` or `{"error":{"message":"..."}}`. Returns null if the
 * body isn't JSON or doesn't match either shape, so callers can fall back to
 * the HTTP status text.
 */
export async function readSseErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } | string };
    if (typeof body.error === 'string') return body.error.slice(0, 200);
    if (typeof body.error?.message === 'string') return body.error.message.slice(0, 200);
  } catch {
    // Not a JSON body — caller falls back to the HTTP status text.
  }
  return null;
}
