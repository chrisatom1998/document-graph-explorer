import { describe, expect, it } from 'vitest';
import { useSettingsStore } from './settingsStore';

describe('settingsStore', () => {
  it('does not remember the Gemini key by default (no plaintext key at rest)', () => {
    // Fresh store in a clean environment (no localStorage in the test env):
    // the privacy-safe default is session-only key storage.
    expect(useSettingsStore.getState().rememberGeminiKey).toBe(false);
  });

  it('trims whitespace when storing the Gemini key', () => {
    // A key pasted with a trailing newline/space must work in every consumer
    // (enrichment, doc AI, chat) — normalize once at the store boundary.
    useSettingsStore.getState().setGeminiKey('  AIzaFakeKey123\n');
    expect(useSettingsStore.getState().geminiKey).toBe('AIzaFakeKey123');
  });
});

describe('offlineMode', () => {
  it('defaults to false', () => {
    expect(useSettingsStore.getState().offlineMode).toBe(false);
  });

  it('setOfflineMode updates state', () => {
    // No localStorage shim in this test env (see the rememberGeminiKey test
    // above), so persistence to the subscribe() writer is exercised by the
    // fetch-guard integration tests in offline.test.ts instead — here we
    // assert the store round-trip itself, mirroring the trim test above.
    useSettingsStore.getState().setOfflineMode(true);
    expect(useSettingsStore.getState().offlineMode).toBe(true);
    useSettingsStore.getState().setOfflineMode(false);
    expect(useSettingsStore.getState().offlineMode).toBe(false);
  });
});
