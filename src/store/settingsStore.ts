/**
 * User settings, persisted to localStorage (key 'knowledge-nebula-settings').
 * The Gemini API key lives ONLY here — it is never written into GraphExport
 * JSON or the IndexedDB graph cache.
 */

import { create } from 'zustand';
import { GEMINI_MODEL } from '../config';

const STORAGE_KEY = 'knowledge-nebula-settings';

interface PersistedSettings {
  geminiKey: string;
  geminiModel: string;
  enrichEnabled: boolean;
  includeEmbeddingsInExport: boolean;
}

export interface SettingsState extends PersistedSettings {
  setGeminiKey: (key: string) => void;
  setGeminiModel: (model: string) => void;
  setEnrichEnabled: (enabled: boolean) => void;
  setIncludeEmbeddingsInExport: (include: boolean) => void;
}

const DEFAULTS: PersistedSettings = {
  geminiKey: '',
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
    return {
      geminiKey:
        typeof parsed.geminiKey === 'string' ? parsed.geminiKey : DEFAULTS.geminiKey,
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
  setGeminiModel: (geminiModel) => set({ geminiModel }),
  setEnrichEnabled: (enrichEnabled) => set({ enrichEnabled }),
  setIncludeEmbeddingsInExport: (includeEmbeddingsInExport) =>
    set({ includeEmbeddingsInExport }),
}));

// Persist on every change (tiny payload; no middleware needed).
useSettingsStore.subscribe((s) => {
  try {
    const persisted: PersistedSettings = {
      geminiKey: s.geminiKey,
      geminiModel: s.geminiModel,
      enrichEnabled: s.enrichEnabled,
      includeEmbeddingsInExport: s.includeEmbeddingsInExport,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    /* private mode / quota exceeded — settings simply won't persist */
  }
});
