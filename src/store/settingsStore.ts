/**
 * User settings persisted in localStorage under the
 * 'knowledge-nebula-settings' key.
 *
 * The OpenRouter API key is kept only here: it is never written into exported
 * graph JSON or the IndexedDB graph cache. It is stored only when
 * rememberOpenRouterKey is enabled. When disabled, the key stays in-memory for
 * the current tab and localStorage is scrubbed to an empty string.
 *
 * Field types, defaults, and the localStorage load/migration path live in
 * settingsMigration.ts; this module owns only the reactive store.
 */

import { create } from 'zustand';
import {
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OPENROUTER_CHAT_MODEL,
  DEFAULT_OPENROUTER_ENRICH_MODEL,
  loadPersistedSettings,
  STORAGE_KEY,
  type ChatProvider,
  type EmbeddingQueryStyle,
  type EnrichProvider,
  type OcrLanguageId,
  type OcrMaxPages,
  type PersistedSettings,
} from './settingsMigration';

export {
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OPENROUTER_CHAT_MODEL,
  DEFAULT_OPENROUTER_ENRICH_MODEL,
  type ChatProvider,
  type EmbeddingQueryStyle,
  type EnrichProvider,
  type OcrLanguageId,
  type OcrMaxPages,
};

export interface SettingsState extends PersistedSettings {
  setChatProvider: (provider: ChatProvider) => void;
  setEnrichProvider: (provider: EnrichProvider) => void;
  setOpenRouterKey: (key: string) => void;
  setRememberOpenRouterKey: (remember: boolean) => void;
  setOpenRouterChatModel: (model: string) => void;
  setOpenRouterEnrichModel: (model: string) => void;
  setOllamaChatModel: (model: string) => void;
  setOllamaEnrichModel: (model: string) => void;
  setEnrichEnabled: (enabled: boolean) => void;
  setIncludeEmbeddingsInExport: (include: boolean) => void;
  setOfflineMode: (offline: boolean) => void;
  setCacheEmbeddings: (cache: boolean) => void;
  setEmbeddingQueryStyle: (style: EmbeddingQueryStyle) => void;
  setOcrLanguage: (lang: OcrLanguageId) => void;
  setOcrMaxPages: (pages: OcrMaxPages) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...loadPersistedSettings(),
  setChatProvider: (chatProvider) => set({ chatProvider }),
  setEnrichProvider: (enrichProvider) => set({ enrichProvider }),
  // Trimmed at the store boundary so every consumer (enrichment, doc AI,
  // chat) gets a header-safe key even when pasted with stray whitespace.
  setOpenRouterKey: (openRouterKey) => set({ openRouterKey: openRouterKey.trim() }),
  setRememberOpenRouterKey: (rememberOpenRouterKey) => set({ rememberOpenRouterKey }),
  setOpenRouterChatModel: (openRouterChatModel) =>
    set({ openRouterChatModel: openRouterChatModel.trim() }),
  setOpenRouterEnrichModel: (openRouterEnrichModel) =>
    set({ openRouterEnrichModel: openRouterEnrichModel.trim() }),
  setOllamaChatModel: (ollamaChatModel) => set({ ollamaChatModel: ollamaChatModel.trim() }),
  setOllamaEnrichModel: (ollamaEnrichModel) =>
    set({ ollamaEnrichModel: ollamaEnrichModel.trim() }),
  setEnrichEnabled: (enrichEnabled) => set({ enrichEnabled }),
  setIncludeEmbeddingsInExport: (includeEmbeddingsInExport) =>
    set({ includeEmbeddingsInExport }),
  setOfflineMode: (offlineMode) => set({ offlineMode }),
  setCacheEmbeddings: (cacheEmbeddings) => set({ cacheEmbeddings }),
  setEmbeddingQueryStyle: (embeddingQueryStyle) => set({ embeddingQueryStyle }),
  setOcrLanguage: (ocrLanguage) => set({ ocrLanguage }),
  setOcrMaxPages: (ocrMaxPages) => set({ ocrMaxPages }),
}));

// Persist on every change; the payload is small enough for a direct write.
// Turning rememberOpenRouterKey off clears any previously stored key on the
// next write.
useSettingsStore.subscribe((s) => {
  try {
    const persisted: PersistedSettings = {
      chatProvider: s.chatProvider,
      enrichProvider: s.enrichProvider,
      openRouterKey: s.rememberOpenRouterKey ? s.openRouterKey : '',
      rememberOpenRouterKey: s.rememberOpenRouterKey,
      openRouterChatModel: s.openRouterChatModel || DEFAULT_OPENROUTER_CHAT_MODEL,
      openRouterEnrichModel: s.openRouterEnrichModel || DEFAULT_OPENROUTER_ENRICH_MODEL,
      ollamaChatModel: s.ollamaChatModel || DEFAULT_OLLAMA_MODEL,
      ollamaEnrichModel: s.ollamaEnrichModel || DEFAULT_OLLAMA_MODEL,
      enrichEnabled: s.enrichEnabled,
      includeEmbeddingsInExport: s.includeEmbeddingsInExport,
      offlineMode: s.offlineMode,
      cacheEmbeddings: s.cacheEmbeddings,
      embeddingQueryStyle: s.embeddingQueryStyle,
      ocrLanguage: s.ocrLanguage,
      ocrMaxPages: s.ocrMaxPages,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    /* private mode / quota exceeded — settings simply won't persist */
  }
});
