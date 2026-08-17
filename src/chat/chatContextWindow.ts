import type { ChatProvider } from '../store/settingsStore';

/** Conservative default for an unknown OpenRouter model. */
export const UNKNOWN_OPENROUTER_CONTEXT_TOKENS = 128_000;
/**
 * Local Ollama servers often keep a small num_ctx. Packing against 1M would
 * overflow llama3.2-class models even when the user enabled All documents.
 */
export const OLLAMA_CONTEXT_TOKENS = 32_000;

const CONTEXT_BY_ID: Readonly<Record<string, number>> = {
  'anthropic/claude-sonnet-5': 1_000_000,
  'anthropic/claude-haiku-4.5': 200_000,
  'openai/gpt-5.4': 1_000_000,
  'openai/gpt-5-mini': 400_000,
  'google/gemini-3.1-pro-preview': 1_000_000,
  'google/gemini-3.6-flash': 1_000_000,
  'google/gemini-3.1-flash-lite': 1_000_000,
  'google/gemini-3.5-flash-lite': 1_000_000,
  'mistralai/mistral-small-3.2-24b-instruct': 256_000,
  'qwen/qwen3.7-flash': 1_000_000,
  'z-ai/glm-4.7-flash': 200_000,
};

const CONTEXT_BY_PATTERN: ReadonlyArray<readonly [RegExp, number]> = [
  [/claude-haiku/i, 200_000],
  [/claude/i, 1_000_000],
  [/gpt-5-mini/i, 400_000],
  [/gpt-5/i, 1_000_000],
  [/gemini/i, 1_000_000],
  [/mistral-small/i, 256_000],
  [/qwen/i, 1_000_000],
  [/glm/i, 200_000],
];

/** Context window for the selected chat provider/model. */
export function chatContextWindowTokens(provider: ChatProvider, modelId: string): number {
  if (provider === 'local') return UNKNOWN_OPENROUTER_CONTEXT_TOKENS;
  if (provider === 'ollama') return OLLAMA_CONTEXT_TOKENS;
  const id = modelId.trim();
  if (CONTEXT_BY_ID[id]) return CONTEXT_BY_ID[id];
  for (const [pattern, tokens] of CONTEXT_BY_PATTERN) {
    if (pattern.test(id)) return tokens;
  }
  return UNKNOWN_OPENROUTER_CONTEXT_TOKENS;
}
