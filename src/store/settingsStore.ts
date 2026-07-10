/**
 * User settings, persisted to localStorage (key 'knowledge-nebula-settings').
 * The Gemini API key lives ONLY here — it is never written into GraphExport
 * JSON or the IndexedDB graph cache — and is persisted only while
 * rememberGeminiKey is on (OFF by default: localStorage is plaintext at
 * rest, so opting in is the user's call); with it off the key stays in
 * memory for this tab and localStorage holds an empty string.
 */

import { create } from 'zustand';
import { LEGACY_GEMINI_DEFAULT } from '../ai/geminiModels';

const STORAGE_KEY = 'knowledge-nebula-settings';

interface PersistedSettings {
  geminiKey: string;
  rememberGeminiKey: boolean;
  geminiModel: string;
  enrichEnabled: boolean;
  includeEmbeddingsInExport: boolean;
  offlineMode: boolean;
}

export interface SettingsState extends PersistedSettings {
  setGeminiKey: (key: string) => void;
  setRememberGeminiKey: (remember: boolean) => void;
  setGeminiModel: (model: string) => void;
  setEnrichEnabled: (enabled: boolean) => void;
  setIncludeEmbeddingsInExport: (include: boolean) => void;
  setOfflineMode: (offline: boolean) => void;
}

const DEFAULTS: PersistedSettings = {
  geminiKey: '',
  rememberGeminiKey: false,
  geminiModel: '',
  enrichEnabled: false,
  includeEmbeddingsInExport: false,
  offlineMode: false,
};

function loadPersisted(): PersistedSettings {
  try {
    if (typeof localStorage === 'undefined') return DEFAULTS;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Record<keyof PersistedSettings, unknown>>;
    const rememberGeminiKey =
      typeof parsed.rememberGeminiKey === 'boolean'
        ? parsed.rememberGeminiKey
        : DEFAULTS.rememberGeminiKey;
    const loaded: PersistedSettings = {
      geminiKey:
        rememberGeminiKey && typeof parsed.geminiKey === 'string'
          ? parsed.geminiKey.trim()
          : DEFAULTS.geminiKey,
      rememberGeminiKey,
      // Older releases persisted their built-in default as if it were a user
      // override. Clear that exact value so existing users receive automatic
      // task routing; every other non-empty custom model remains pinned.
      geminiModel:
        typeof parsed.geminiModel === 'string' &&
        parsed.geminiModel.trim() !== '' &&
        parsed.geminiModel.trim() !== LEGACY_GEMINI_DEFAULT
          ? parsed.geminiModel.trim()
          : DEFAULTS.geminiModel,
      enrichEnabled:
        typeof parsed.enrichEnabled === 'boolean'
          ? parsed.enrichEnabled
          : DEFAULTS.enrichEnabled,
      includeEmbeddingsInExport:
        typeof parsed.includeEmbeddingsInExport === 'boolean'
          ? parsed.includeEmbeddingsInExport
          : DEFAULTS.includeEmbeddingsInExport,
      offlineMode:
        typeof parsed.offlineMode === 'boolean' ? parsed.offlineMode : DEFAULTS.offlineMode,
    };
    // rememberGeminiKey default flipped to false after early builds stored keys
    // with the field missing (treated as "remember"). Without an eager rewrite,
    // a stale plaintext key would sit in localStorage until the next settings
    // change — scrub it on boot whenever remember is off.
    if (
      !rememberGeminiKey &&
      typeof parsed.geminiKey === 'string' &&
      parsed.geminiKey.length > 0
    ) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
      } catch {
        /* private mode / quota — in-memory state is already keyless */
      }
    }
    return loaded;
  } catch {
    return DEFAULTS;
  }
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...loadPersisted(),
  // Trimmed at the store boundary so every consumer (enrichment, doc AI,
  // chat) gets a header-safe key even when pasted with stray whitespace.
  setGeminiKey: (geminiKey) => set({ geminiKey: geminiKey.trim() }),
  setRememberGeminiKey: (rememberGeminiKey) => set({ rememberGeminiKey }),
  setGeminiModel: (geminiModel) => set({ geminiModel: geminiModel.trim() }),
  setEnrichEnabled: (enrichEnabled) => set({ enrichEnabled }),
  setIncludeEmbeddingsInExport: (includeEmbeddingsInExport) =>
    set({ includeEmbeddingsInExport }),
  setOfflineMode: (offlineMode) => set({ offlineMode }),
}));

// Persist on every change (tiny payload; no middleware needed). Turning
// rememberGeminiKey off scrubs any previously stored key on the next write.
useSettingsStore.subscribe((s) => {
  try {
    const persisted: PersistedSettings = {
      geminiKey: s.rememberGeminiKey ? s.geminiKey : '',
      rememberGeminiKey: s.rememberGeminiKey,
      geminiModel: s.geminiModel,
      enrichEnabled: s.enrichEnabled,
      includeEmbeddingsInExport: s.includeEmbeddingsInExport,
      offlineMode: s.offlineMode,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    /* private mode / quota exceeded — settings simply won't persist */
  }
});
