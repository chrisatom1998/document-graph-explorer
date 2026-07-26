/**
 * Ollama chat client. Talks to a locally running Ollama server through its
 * OpenAI-compatible endpoint, so the SSE framing and message shapes are the
 * same as OpenRouter's — the parsing helpers are shared. Unlike the cloud
 * providers there is no API key: the only requirement is that Ollama is
 * running on this machine. The endpoint is fixed (not user-configurable)
 * because the production CSP must whitelist it statically.
 */

import type { ChatMessage } from '../store/chatStore';
import { buildOpenRouterMessages, parseOpenRouterSseLine } from './openRouterClient';

export const OLLAMA_CHAT_ENDPOINT = 'http://127.0.0.1:11434/v1/chat/completions';

interface StreamOptions {
  model: string;
  prompt: string;
  history: ChatMessage[];
  signal: AbortSignal;
  onText: (text: string) => void;
}

function describeOllamaFailure(err: unknown): Error {
  // A connection refused surfaces as an opaque TypeError("Failed to fetch").
  // Name the by-far-likeliest cause instead of echoing that.
  if (err instanceof TypeError) {
    return new Error(
      'Could not reach Ollama at 127.0.0.1:11434. Is Ollama installed and running? (ollama serve)',
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function readOllamaError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } | string };
    if (typeof body.error === 'string') return body.error.slice(0, 200);
    if (typeof body.error?.message === 'string') return body.error.message.slice(0, 200);
  } catch {
    // Fall through to the status-only error.
  }
  return response.statusText || 'Request failed';
}

export async function streamOllamaChat(options: StreamOptions): Promise<string> {
  let response: Response;
  try {
    response = await fetch(OLLAMA_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages: buildOpenRouterMessages(options.history, options.prompt),
        stream: true,
      }),
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw err; // preserve cancellation/timeout semantics for the caller
    }
    throw describeOllamaFailure(err);
  }

  if (!response.ok) {
    const detail = await readOllamaError(response);
    if (response.status === 404 && /model/i.test(detail)) {
      throw new Error(
        `Ollama does not have the model "${options.model}". Pull it first: ollama pull ${options.model}`,
      );
    }
    throw new Error(`Ollama HTTP ${response.status}: ${detail}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Ollama's streaming response had no body. Please try again.");

  const decoder = new TextDecoder();
  let pending = '';
  let accumulated = '';
  let streamError: string | undefined;
  let finishReason: string | undefined;

  const consume = (line: string) => {
    const event = parseOpenRouterSseLine(line);
    if (!event) return;
    if (event.error) streamError = event.error;
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
      pending += decoder.decode();
      if (pending) consume(pending);
    }
    if (accumulated !== before) options.onText(accumulated);
    if (done) break;
  }

  if (!accumulated.trim()) {
    if (streamError) throw new Error(`Ollama stream failed: ${streamError.slice(0, 200)}`);
    throw new Error(
      finishReason && finishReason !== 'stop'
        ? `Ollama stopped the response (${finishReason}).`
        : 'Ollama returned an empty response. Please try again.',
    );
  }
  return accumulated.trim();
}
