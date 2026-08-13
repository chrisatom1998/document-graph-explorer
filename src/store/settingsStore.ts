/**
 * User settings, persisted to localStorage (key 'knowledge-nebula-settings').
 * The OpenRouter API key lives ONLY here — it is never written into
 * GraphExport JSON or the IndexedDB graph cache — and is persisted only while
 * rememberOpenRouterKey is on (OFF by default: localStorage is plaintext at
 * rest, so opting in is the user's call); with it off the key stays in
 * memory for this tab and localStorage holds an empty string.
 */

import { create } from 'zustand';
const STORAGE_KEY = 'knowledge-nebula-settings';

export type EmbeddingQueryStyle = 'english' | 'neutral';
export type OcrLanguageId =
  | 'eng'
  | 'spa'
  | 'fra'
  | 'deu'
  | 'por'
  | 'ita'
  | 'nld'
  | 'rus'
  | 'chi_sim'
  | 'jpn';
export type OcrMaxPages = 10 | 20 | 40 | 80;

const OCR_LANGUAGE_IDS: ReadonlySet<string> = new Set([
  'eng',
  'spa',
  'fra',
  'deu',
  'por',
  'ita',
  'nld',
  'rus',
  'chi_sim',
  'jpn',
]);
const OCR_MAX_PAGES_VALUES: ReadonlySet<number> = new Set([10, 20, 40, 80]);

function isOcrLanguage(value: unknown): value is OcrLanguageId {
  return typeof value === 'string' && OCR_LANGUAGE_IDS.has(value);
}

function isOcrMaxPages(value: unknown): value is OcrMaxPages {
  return typeof value === 'number' && OCR_MAX_PAGES_VALUES.has(value);
}

interface PersistedSettings {
  chatProvider: ChatProvider;
  enrichProvider: EnrichProvider;
  openRouterKey: string;
  rememberOpenRouterKey: boolean;
  openRouterChatModel: string;
  openRouterEnrichModel: string;
  ollamaChatModel: string;
  ollamaEnrichModel: string;
  enrichEnabled: boolean;
  includeEmbeddingsInExport: boolean;
  offlineMode: boolean;
  /** Persist chunk/doc vectors in IndexedDB (off = smaller quota, re-embed on reload). */
  cacheEmbeddings: boolean;
  /** English instruction prefix vs raw query text for the bundled BGE model. */
  embeddingQueryStyle: EmbeddingQueryStyle;
  ocrLanguage: OcrLanguageId;
  ocrMaxPages: OcrMaxPages;
}

export type ChatProvider = 'local' | 'openrouter' | 'ollama';
/** Provider used for enrichment and per-document AI (no 'local' — both need a model). */
export type EnrichProvider = 'openrouter' | 'ollama';

// Chat and enrichment pick their model independently, because the workloads
// pull in opposite directions: chat is one request per question, so quality is
// affordable; enrichment issues one request per 15-document batch across the
// whole corpus, where a large reasoning model turns minutes into hours.
// Models are stored per provider so switching providers back and forth keeps
// each choice. See ai/modelCatalog.ts for the curated shortlists.
export const DEFAULT_OPENROUTER_CHAT_MODEL = 'anthropic/claude-sonnet-5';
export const DEFAULT_OPENROUTER_ENRICH_MODEL = 'google/gemini-3.1-flash-lite';
export const DEFAULT_OLLAMA_MODEL = 'llama3.2';

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

const DEFAULTS: PersistedSettings = {
  chatProvider: 'local',
  enrichProvider: 'openrouter',
  openRouterKey: '',
  rememberOpenRouterKey: false,
  openRouterChatModel: DEFAULT_OPENROUTER_CHAT_MODEL,
  openRouterEnrichModel: DEFAULT_OPENROUTER_ENRICH_MODEL,
  ollamaChatModel: DEFAULT_OLLAMA_MODEL,
  ollamaEnrichModel: DEFAULT_OLLAMA_MODEL,
  enrichEnabled: false,
  includeEmbeddingsInExport: false,
  offlineMode: false,
  cacheEmbeddings: true,
  embeddingQueryStyle: 'english',
  ocrLanguage: 'eng',
  ocrMaxPages: 20,
};

function loadPersisted(): PersistedSettings {
  try {
    if (typeof localStorage === 'undefined') return DEFAULTS;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Record<keyof PersistedSettings, unknown>> & {
      geminiKey?: unknown;
      geminiModel?: unknown;
      rememberGeminiKey?: unknown;
      // Pre-split: one model shared by chat and enrichment.
      openRouterModel?: unknown;
      ollamaModel?: unknown;
    };
    /** Read a model field, falling back to the pre-split shared value. */
    const model = (value: unknown, legacy: unknown, fallback: string): string => {
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof legacy === 'string' && legacy.trim()) return legacy.trim();
      return fallback;
    };
    const rememberOpenRouterKey =
      typeof parsed.rememberOpenRouterKey === 'boolean'
        ? parsed.rememberOpenRouterKey
        : DEFAULTS.rememberOpenRouterKey;
    // 'gemini' (removed provider) intentionally fails this check and falls
    // back to the safe default, which needs no key.
    const chatProvider: ChatProvider =
      parsed.chatProvider === 'openrouter' ||
      parsed.chatProvider === 'ollama' ||
      parsed.chatProvider === 'local'
        ? parsed.chatProvider
        : DEFAULTS.chatProvider;
    const enrichProvider: EnrichProvider =
      parsed.enrichProvider === 'openrouter' || parsed.enrichProvider === 'ollama'
        ? parsed.enrichProvider
        : DEFAULTS.enrichProvider;
    const loaded: PersistedSettings = {
      chatProvider,
      enrichProvider,
      openRouterKey:
        rememberOpenRouterKey && typeof parsed.openRouterKey === 'string'
          ? parsed.openRouterKey.trim()
          : DEFAULTS.openRouterKey,
      rememberOpenRouterKey,
      openRouterChatModel: model(
        parsed.openRouterChatModel,
        parsed.openRouterModel,
        DEFAULTS.openRouterChatModel,
      ),
      openRouterEnrichModel: model(
        parsed.openRouterEnrichModel,
        parsed.openRouterModel,
        DEFAULTS.openRouterEnrichModel,
      ),
      ollamaChatModel: model(
        parsed.ollamaChatModel,
        parsed.ollamaModel,
        DEFAULTS.ollamaChatModel,
      ),
      ollamaEnrichModel: model(
        parsed.ollamaEnrichModel,
        parsed.ollamaModel,
        DEFAULTS.ollamaEnrichModel,
      ),
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
      cacheEmbeddings:
        typeof parsed.cacheEmbeddings === 'boolean'
          ? parsed.cacheEmbeddings
          : DEFAULTS.cacheEmbeddings,
      embeddingQueryStyle:
        parsed.embeddingQueryStyle === 'neutral' || parsed.embeddingQueryStyle === 'english'
          ? parsed.embeddingQueryStyle
          : DEFAULTS.embeddingQueryStyle,
      ocrLanguage: isOcrLanguage(parsed.ocrLanguage) ? parsed.ocrLanguage : DEFAULTS.ocrLanguage,
      ocrMaxPages: isOcrMaxPages(parsed.ocrMaxPages) ? parsed.ocrMaxPages : DEFAULTS.ocrMaxPages,
    };
    // Eagerly rewrite storage when it still carries fields from removed
    // features (the Gemini key/model era) or a session-only OpenRouter key.
    // Without this, a stale plaintext key would sit in localStorage until the
    // next settings change — scrub it on boot.
    if (
      (!rememberOpenRouterKey &&
        typeof parsed.openRouterKey === 'string' &&
        parsed.openRouterKey.length > 0) ||
      Object.hasOwn(parsed, 'geminiKey') ||
      Object.hasOwn(parsed, 'rememberGeminiKey') ||
      Object.hasOwn(parsed, 'geminiModel') ||
      Object.hasOwn(parsed, 'openRouterModel') ||
      Object.hasOwn(parsed, 'ollamaModel')
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

// Persist on every change (tiny payload; no middleware needed). Turning
// rememberOpenRouterKey off scrubs any previously stored key on the next write.
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
