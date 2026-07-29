import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './settingsStore';

const STORAGE_KEY = 'knowledge-nebula-settings';

describe('settingsStore', () => {
  it('does not remember the OpenRouter key by default (no plaintext key at rest)', async () => {
    // Fresh store in a clean environment (no localStorage in the test env):
    // the privacy-safe default is session-only key storage.
    const { useSettingsStore } = await import('./settingsStore');
    expect(useSettingsStore.getState().rememberOpenRouterKey).toBe(false);
  });

  it('trims whitespace when storing the OpenRouter key', async () => {
    // A key pasted with a trailing newline/space must work in every consumer
    // (enrichment, doc AI, chat) — normalize once at the store boundary.
    const { useSettingsStore } = await import('./settingsStore');
    useSettingsStore.getState().setOpenRouterKey('  sk-or-fake-key-123\n');
    expect(useSettingsStore.getState().openRouterKey).toBe('sk-or-fake-key-123');
    useSettingsStore.getState().setOpenRouterKey('');
  });

  it('no longer exposes any Gemini settings', () => {
    expect(useSettingsStore.getState()).not.toHaveProperty('geminiKey');
    expect(useSettingsStore.getState()).not.toHaveProperty('setGeminiKey');
    expect(useSettingsStore.getState()).not.toHaveProperty('rememberGeminiKey');
    expect(useSettingsStore.getState()).not.toHaveProperty('geminiModel');
  });

  it('defaults chat to local and saves an explicit OpenRouter chat model', () => {
    expect(useSettingsStore.getState().chatProvider).toBe('local');
    useSettingsStore.getState().setChatProvider('openrouter');
    useSettingsStore.getState().setOpenRouterChatModel('  anthropic/claude-haiku-4.5  ');
    expect(useSettingsStore.getState().chatProvider).toBe('openrouter');
    expect(useSettingsStore.getState().openRouterChatModel).toBe('anthropic/claude-haiku-4.5');
    useSettingsStore.getState().setChatProvider('local');
    useSettingsStore.getState().setOpenRouterChatModel('anthropic/claude-sonnet-5');
  });

  it('picks chat and enrichment models independently, with purpose-fit defaults', () => {
    // Chat is one request per question, so it defaults to a flagship model.
    // Enrichment issues one request per 15 documents across the corpus, where
    // a big reasoning model is the difference between minutes and hours.
    expect(useSettingsStore.getState().openRouterChatModel).toBe('anthropic/claude-sonnet-5');
    expect(useSettingsStore.getState().openRouterEnrichModel).toBe(
      'google/gemini-3.1-flash-lite',
    );
    useSettingsStore.getState().setOpenRouterChatModel('openai/gpt-5.4');
    // Changing the chat model must not drag enrichment onto a slow model.
    expect(useSettingsStore.getState().openRouterEnrichModel).toBe(
      'google/gemini-3.1-flash-lite',
    );
    useSettingsStore.getState().setOpenRouterChatModel('anthropic/claude-sonnet-5');
  });

  it('defaults enrichment to OpenRouter and round-trips the provider setting', () => {
    expect(useSettingsStore.getState().enrichProvider).toBe('openrouter');
    useSettingsStore.getState().setEnrichProvider('ollama');
    expect(useSettingsStore.getState().enrichProvider).toBe('ollama');
    useSettingsStore.getState().setEnrichProvider('openrouter');
  });
});

describe('settingsStore — stale key scrub on boot', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
      key: () => null,
      get length() {
        return store.size;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('scrubs leftover Gemini fields (removed provider) from localStorage on boot', async () => {
    // Builds before the OpenRouter/Ollama switch stored a Gemini key; the
    // field no longer exists, so a leftover plaintext key must be removed
    // eagerly — not left until the next settings change.
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        geminiKey: 'AIzaStaleKeyFromOldBuild',
        rememberGeminiKey: true,
        geminiModel: 'gemini-2.0-flash',
        chatProvider: 'gemini',
        enrichEnabled: false,
        includeEmbeddingsInExport: false,
        offlineMode: false,
      }),
    );

    const { useSettingsStore } = await import('./settingsStore');
    // The removed 'gemini' chat provider falls back to the keyless default.
    expect(useSettingsStore.getState().chatProvider).toBe('local');
    expect(useSettingsStore.getState()).not.toHaveProperty('geminiKey');

    const rewritten = JSON.parse(store.get(STORAGE_KEY)!);
    expect(rewritten).not.toHaveProperty('geminiKey');
    expect(rewritten).not.toHaveProperty('rememberGeminiKey');
    expect(rewritten).not.toHaveProperty('geminiModel');
    expect(rewritten.chatProvider).toBe('local');
  });

  it('rewrites localStorage on boot when a session-only OpenRouter key was persisted', async () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        chatProvider: 'openrouter',
        openRouterKey: 'sk-or-session-only',
        rememberOpenRouterKey: false,
        openRouterModel: 'google/gemini-3.1-pro-preview',
        enrichEnabled: false,
        includeEmbeddingsInExport: false,
        offlineMode: false,
      }),
    );

    const { useSettingsStore } = await import('./settingsStore');
    expect(useSettingsStore.getState().chatProvider).toBe('openrouter');
    // Pre-split builds stored one model shared by chat and enrichment; it must
    // carry into both so an upgrade never silently changes which model runs.
    expect(useSettingsStore.getState().openRouterChatModel).toBe(
      'google/gemini-3.1-pro-preview',
    );
    expect(useSettingsStore.getState().openRouterEnrichModel).toBe(
      'google/gemini-3.1-pro-preview',
    );
    expect(useSettingsStore.getState().openRouterKey).toBe('');
    const rewritten = JSON.parse(store.get(STORAGE_KEY)!);
    expect(rewritten.openRouterKey).toBe('');
    expect(rewritten).not.toHaveProperty('openRouterModel'); // legacy field retired
  });

  it('migrates a legacy shared Ollama model into both chat and enrichment', async () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        chatProvider: 'ollama',
        enrichProvider: 'ollama',
        ollamaModel: 'qwen2.5:7b',
        enrichEnabled: false,
        includeEmbeddingsInExport: false,
        offlineMode: false,
      }),
    );

    const { useSettingsStore } = await import('./settingsStore');
    expect(useSettingsStore.getState().ollamaChatModel).toBe('qwen2.5:7b');
    expect(useSettingsStore.getState().ollamaEnrichModel).toBe('qwen2.5:7b');
    expect(JSON.parse(store.get(STORAGE_KEY)!)).not.toHaveProperty('ollamaModel');
  });

  it('leaves a remembered OpenRouter key intact on boot', async () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        chatProvider: 'openrouter',
        enrichProvider: 'ollama',
        openRouterKey: 'sk-or-remembered',
        rememberOpenRouterKey: true,
        enrichEnabled: false,
        includeEmbeddingsInExport: false,
        offlineMode: false,
      }),
    );

    const { useSettingsStore } = await import('./settingsStore');
    expect(useSettingsStore.getState().openRouterKey).toBe('sk-or-remembered');
    expect(useSettingsStore.getState().rememberOpenRouterKey).toBe(true);
    expect(useSettingsStore.getState().enrichProvider).toBe('ollama');
  });
});

describe('offlineMode', () => {
  it('defaults to false', async () => {
    const { useSettingsStore } = await import('./settingsStore');
    expect(useSettingsStore.getState().offlineMode).toBe(false);
  });

  it('setOfflineMode updates state', async () => {
    // No localStorage shim in this test env (see the key tests above), so
    // persistence via the subscribe() writer is exercised by the fetch-guard
    // integration tests in offline.test.ts instead — here we assert the
    // store round-trip itself, mirroring the trim test above.
    const { useSettingsStore } = await import('./settingsStore');
    useSettingsStore.getState().setOfflineMode(true);
    expect(useSettingsStore.getState().offlineMode).toBe(true);
    useSettingsStore.getState().setOfflineMode(false);
    expect(useSettingsStore.getState().offlineMode).toBe(false);
  });
});
