/**
 * User settings, persisted to localStorage (key 'knowledge-nebula-settings').
 * The Gemini API key lives ONLY here — it is never written into GraphExport
 * JSON or the IndexedDB graph cache — and is persisted only while
 * rememberGeminiKey is on; with it off the key stays in memory for this tab
 * and localStorage holds an empty string.
 */

import { create } from 'zustand';
import { GEMINI_MODEL } from '../config';

const STORAGE_KEY = 'knowledge-nebula-settings';

interface PersistedSettings {
  geminiKey: string;
  rememberGeminiKey: boolean;
  geminiModel: string;
  enrichEnabled: boolean;
  includeEmbeddingsInExport: boolean;
}

export interface SettingsState extends PersistedSettings {
  setGeminiKey: (key: string) => void;
  setRememberGeminiKey: (remember: boolean) => void;
  setGeminiModel: (model: string) => void;
  setEnrichEnabled: (enabled: boolean) => void;
  setIncludeEmbeddingsInExport: (include: boolean) => void;
}

const DEFAULTS: PersistedSettings = {
  geminiKey: '',
  rememberGeminiKey: true,
  geminiModel: GEMINI_MODEL,
  enrichEnabled: false,
  includeEmbeddingsInExport: false,
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
    return {
      geminiKey:
        rememberGeminiKey && typeof parsed.geminiKey === 'string'
          ? parsed.geminiKey
          : DEFAULTS.geminiKey,
      rememberGeminiKey,
      geminiModel:
        typeof parsed.geminiModel === 'string' && parsed.geminiModel.trim() !== ''
          ? parsed.geminiModel
          : DEFAULTS.geminiModel,
      enrichEnabled:
        typeof parsed.enrichEnabled === 'boolean'
          ? parsed.enrichEnabled
          : DEFAULTS.enrichEnabled,
      includeEmbeddingsInExport:
        typeof parsed.includeEmbeddingsInExport === 'boolean'
          ? parsed.includeEmbeddingsInExport
          : DEFAULTS.includeEmbeddingsInExport,
    };
  } catch {
    return DEFAULTS;
  }
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...loadPersisted(),
  setGeminiKey: (geminiKey) => set({ geminiKey }),
  setRememberGeminiKey: (rememberGeminiKey) => set({ rememberGeminiKey }),
  setGeminiModel: (geminiModel) => set({ geminiModel }),
  setEnrichEnabled: (enrichEnabled) => set({ enrichEnabled }),
  setIncludeEmbeddingsInExport: (includeEmbeddingsInExport) =>
    set({ includeEmbeddingsInExport }),
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
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    /* private mode / quota exceeded — settings simply won't persist */
  }
});
