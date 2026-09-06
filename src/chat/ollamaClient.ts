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
import { readSseErrorMessage, readSseStream } from './sseStream';

export const OLLAMA_CHAT_ENDPOINT = 'http://127.0.0.1:11434/v1/chat/completions';

interface StreamOptions {
  model: string;
  prompt: string;
  history: ChatMessage[];
  signal: AbortSignal;
  onText: (text: string) => void;
}

function describeOllamaFailure(err: unknown): Error {
  // A connection refusal surfaces as an opaque TypeError("Failed to fetch").
  // Name the most likely cause instead of echoing the browser's generic error.
  if (err instanceof TypeError) {
    return new Error(
      'Could not reach Ollama at 127.0.0.1:11434. Is Ollama installed and running? (ollama serve)',
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function readOllamaError(response: Response): Promise<string> {
  return (await readSseErrorMessage(response)) ?? (response.statusText || 'Request failed');
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

  const { text: accumulated, error: streamError, finishReason } = await readSseStream(
    reader,
    parseOpenRouterSseLine,
    options.onText,
  );

  if (streamError) throw new Error(`Ollama stream failed: ${streamError.slice(0, 200)}`);
  if (!accumulated.trim()) {
    throw new Error(
      finishReason && finishReason !== 'stop'
        ? `Ollama stopped the response (${finishReason}).`
        : 'Ollama returned an empty response. Please try again.',
    );
  }
  return accumulated.trim();
}
