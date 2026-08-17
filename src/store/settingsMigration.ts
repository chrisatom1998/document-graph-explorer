/**
 * Settings persistence: types, defaults, and the localStorage load/migrate
 * path for the 'knowledge-nebula-settings' key. Kept separate from
 * settingsStore.ts so the store module only deals with reactive state, not
 * the shape of on-disk data or its migration history.
 */

export const STORAGE_KEY = 'knowledge-nebula-settings';

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

export type ChatProvider = 'local' | 'openrouter' | 'ollama';
/** Provider used for enrichment and per-document AI (no 'local' — both need a model). */
export type EnrichProvider = 'openrouter' | 'ollama';

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

export interface PersistedSettings {
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

// Chat and enrichment select models independently because their workloads pull
// in opposite directions: chat is one request per question, so quality is
// affordable, while enrichment issues one request per 15-document batch across
// the whole corpus, where a large reasoning model can turn minutes into hours.
// Models are stored per provider so switching back and forth keeps the prior
// choice for each provider. See ai/modelCatalog.ts for the curated shortlists.
export const DEFAULT_OPENROUTER_CHAT_MODEL = 'anthropic/claude-sonnet-5';
export const DEFAULT_OPENROUTER_ENRICH_MODEL = 'google/gemini-3.1-flash-lite';
export const DEFAULT_OLLAMA_MODEL = 'llama3.2';

export const DEFAULTS: PersistedSettings = {
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

/**
 * Loads persisted settings from localStorage, applying defaults for any
 * missing or invalid field and migrating fields from prior schema versions
 * (the removed Gemini provider, and the pre-split shared chat/enrichment
 * model). Never throws: any read or parse failure falls back to DEFAULTS.
 */
export function loadPersistedSettings(): PersistedSettings {
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
    // Rewrite storage eagerly when it still contains fields from removed
    // features (the Gemini-era key/model) or a session-only OpenRouter key.
    // This prevents stale plaintext data from lingering in localStorage until
    // the next settings change.
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
