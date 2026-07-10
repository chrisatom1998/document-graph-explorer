import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './settingsStore';

const STORAGE_KEY = 'knowledge-nebula-settings';

describe('settingsStore', () => {
  it('does not remember the Gemini key by default (no plaintext key at rest)', async () => {
    // Fresh store in a clean environment (no localStorage in the test env):
    // the privacy-safe default is session-only key storage.
    const { useSettingsStore } = await import('./settingsStore');
    expect(useSettingsStore.getState().rememberGeminiKey).toBe(false);
  });

  it('trims whitespace when storing the Gemini key', async () => {
    // A key pasted with a trailing newline/space must work in every consumer
    // (enrichment, doc AI, chat) — normalize once at the store boundary.
    const { useSettingsStore } = await import('./settingsStore');
    useSettingsStore.getState().setGeminiKey('  AIzaFakeKey123\n');
    expect(useSettingsStore.getState().geminiKey).toBe('AIzaFakeKey123');
  });

  it('does not expose a Gemini model override', () => {
    expect(useSettingsStore.getState()).not.toHaveProperty('geminiModel');
    expect(useSettingsStore.getState()).not.toHaveProperty('setGeminiModel');
  });

  it('defaults chat to local and saves an explicit OpenRouter model selection', () => {
    expect(useSettingsStore.getState().chatProvider).toBe('local');
    expect(useSettingsStore.getState().openRouterModel).toBe('anthropic/claude-sonnet-5');
    useSettingsStore.getState().setChatProvider('openrouter');
    useSettingsStore.getState().setOpenRouterModel('  google/gemini-3.1-pro-preview  ');
    expect(useSettingsStore.getState().chatProvider).toBe('openrouter');
    expect(useSettingsStore.getState().openRouterModel).toBe('google/gemini-3.1-pro-preview');
    useSettingsStore.getState().setChatProvider('local');
    useSettingsStore.getState().setOpenRouterModel('anthropic/claude-sonnet-5');
  });

  it('does not remember the OpenRouter key by default', () => {
    expect(useSettingsStore.getState().rememberOpenRouterKey).toBe(false);
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

  it('rewrites localStorage on boot when a stale key is present and remember is off', async () => {
    // Early builds defaulted rememberGeminiKey to true and omitted the field;
    // after the default flipped to false, a leftover plaintext key must be
    // scrubbed eagerly — not left until the next settings change.
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        geminiKey: 'AIzaStaleKeyFromOldDefault',
        geminiModel: 'gemini-2.0-flash',
        enrichEnabled: false,
        includeEmbeddingsInExport: false,
        offlineMode: false,
      }),
    );

    const { useSettingsStore } = await import('./settingsStore');
    expect(useSettingsStore.getState().geminiKey).toBe('');
    expect(useSettingsStore.getState().rememberGeminiKey).toBe(false);

    const rewritten = JSON.parse(store.get(STORAGE_KEY)!);
    expect(rewritten.geminiKey).toBe('');
    expect(rewritten.rememberGeminiKey).toBe(false);
    expect(rewritten).not.toHaveProperty('geminiModel');
  });

  it('leaves a remembered key intact on boot', async () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        geminiKey: 'AIzaRememberedKey',
        rememberGeminiKey: true,
        geminiModel: 'gemini-2.0-flash',
        enrichEnabled: false,
        includeEmbeddingsInExport: false,
        offlineMode: false,
      }),
    );

    const { useSettingsStore } = await import('./settingsStore');
    expect(useSettingsStore.getState().geminiKey).toBe('AIzaRememberedKey');
    expect(useSettingsStore.getState().rememberGeminiKey).toBe(true);
    expect(JSON.parse(store.get(STORAGE_KEY)!).geminiKey).toBe('AIzaRememberedKey');
    expect(JSON.parse(store.get(STORAGE_KEY)!)).not.toHaveProperty('geminiModel');
  });
});

describe('offlineMode', () => {
  it('defaults to false', async () => {
    const { useSettingsStore } = await import('./settingsStore');
    expect(useSettingsStore.getState().offlineMode).toBe(false);
  });

  it('setOfflineMode updates state', async () => {
    // No localStorage shim in this test env (see the rememberGeminiKey test
    // above), so persistence to the subscribe() writer is exercised by the
    // fetch-guard integration tests in offline.test.ts instead — here we
    // assert the store round-trip itself, mirroring the trim test above.
    const { useSettingsStore } = await import('./settingsStore');
    useSettingsStore.getState().setOfflineMode(true);
    expect(useSettingsStore.getState().offlineMode).toBe(true);
    useSettingsStore.getState().setOfflineMode(false);
    expect(useSettingsStore.getState().offlineMode).toBe(false);
  });
});
