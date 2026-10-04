import { describe, expect, it } from 'vitest';
import {
  OLLAMA_CONTEXT_TOKENS,
  UNKNOWN_OPENROUTER_CONTEXT_TOKENS,
  chatContextWindowTokens,
} from './chatContextWindow';

describe('chatContextWindowTokens', () => {
  it('uses curated windows for known OpenRouter chat models', () => {
    expect(chatContextWindowTokens('openrouter', 'anthropic/claude-sonnet-5')).toBe(1_000_000);
    expect(chatContextWindowTokens('openrouter', 'anthropic/claude-haiku-4.5')).toBe(200_000);
    expect(chatContextWindowTokens('openrouter', 'openai/gpt-5-mini')).toBe(400_000);
  });

  it('guesses from the model id when the exact catalog entry is missing', () => {
    expect(chatContextWindowTokens('openrouter', 'anthropic/claude-haiku-4.6')).toBe(200_000);
    expect(chatContextWindowTokens('openrouter', 'google/gemini-4-pro')).toBe(1_000_000);
  });

  it('stays conservative for Ollama and unknown cloud models', () => {
    expect(chatContextWindowTokens('ollama', 'llama3.2')).toBe(OLLAMA_CONTEXT_TOKENS);
    expect(chatContextWindowTokens('openrouter', 'some/obscure-model')).toBe(
      UNKNOWN_OPENROUTER_CONTEXT_TOKENS,
    );
  });
});
