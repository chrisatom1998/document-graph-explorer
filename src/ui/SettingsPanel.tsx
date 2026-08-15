/**
 * Settings modal: AI provider config (OpenRouter / Ollama), export options,
 * cache management. Visibility is owned by uiStore.settingsOpen; Esc handling
 * lives in App.tsx (no window key listeners here). Generic
 * .panel-overlay/.glass styling comes from the shared stylesheet — only
 * panel-specific bits are inlined.
 */

import { useEffect, useRef, useState } from 'react';
import { AIRGAP } from '../airgap';
import { DOCUMENT_AI_MAX_CONTEXT_CHARS } from '../config';
import { useFocusTrap } from './useFocusTrap';
import CloseButton from './CloseButton';
import {
  fetchModelCatalog,
  openRouterModelOptions,
  SUGGESTED_OLLAMA_MODELS,
} from '../ai/modelCatalog';
import { runEnrichment } from '../enrich/enrichment';
import { clearAllCaches, clearEmbeddingsCache, clearOriginalsCache } from '../persistence/cache';
import {
  estimateStorage,
  formatStorageSummary,
  storagePressure,
  type StoragePressure,
} from '../persistence/quota';
import { OCR_LANGUAGE_OPTIONS, OCR_PAGE_OPTIONS } from '../pipeline/ocrOptions';
import { resetCorpus } from '../pipeline/coordinator';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';
import {
  DEFAULT_OLLAMA_MODEL,
  useSettingsStore,
  type ChatProvider,
  type EmbeddingQueryStyle,
  type EnrichProvider,
  type OcrLanguageId,
  type OcrMaxPages,
} from '../store/settingsStore';
import { useUiStore } from '../store/uiStore';
import { buildDiagnosticsText, getAppVersion } from './diagnostics';

/** Clear the two live stores that otherwise survive the IndexedDB wipe. */
export function resetClearedDataState(): void {
  resetCorpus();
  useCorpusStore.getState().reset();
}

export default function SettingsPanel() {
  const open = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const autoQuality = useUiStore((s) => s.autoQuality);
  const setAutoQuality = useUiStore((s) => s.setAutoQuality);
  const lastError = useUiStore((s) => s.lastError);
  const phase = useGraphStore((s) => s.phase);
  const nodeCount = useGraphStore((s) => s.nodes.length);
  const documentCount = useGraphStore((s) =>
    s.nodes.reduce((count, node) => count + (node.kind === 'document' ? 1 : 0), 0),
  );
  const topicCount = nodeCount - documentCount;
  const edgeCount = useGraphStore((s) => s.edges.length);

  const chatProvider = useSettingsStore((s) => s.chatProvider);
  const enrichProvider = useSettingsStore((s) => s.enrichProvider);
  const openRouterKey = useSettingsStore((s) => s.openRouterKey);
  const rememberOpenRouterKey = useSettingsStore((s) => s.rememberOpenRouterKey);
  const openRouterChatModel = useSettingsStore((s) => s.openRouterChatModel);
  const openRouterEnrichModel = useSettingsStore((s) => s.openRouterEnrichModel);
  const ollamaChatModel = useSettingsStore((s) => s.ollamaChatModel);
  const ollamaEnrichModel = useSettingsStore((s) => s.ollamaEnrichModel);
  const enrichEnabled = useSettingsStore((s) => s.enrichEnabled);
  const includeEmbeddings = useSettingsStore((s) => s.includeEmbeddingsInExport);
  const offlineMode = useSettingsStore((s) => s.offlineMode);
  const cacheEmbeddings = useSettingsStore((s) => s.cacheEmbeddings);
  const embeddingQueryStyle = useSettingsStore((s) => s.embeddingQueryStyle);
  const ocrLanguage = useSettingsStore((s) => s.ocrLanguage);
  const ocrMaxPages = useSettingsStore((s) => s.ocrMaxPages);
  const setChatProvider = useSettingsStore((s) => s.setChatProvider);
  const setEnrichProvider = useSettingsStore((s) => s.setEnrichProvider);
  const setOpenRouterKey = useSettingsStore((s) => s.setOpenRouterKey);
  const setRememberOpenRouterKey = useSettingsStore((s) => s.setRememberOpenRouterKey);
  const setOpenRouterChatModel = useSettingsStore((s) => s.setOpenRouterChatModel);
  const setOpenRouterEnrichModel = useSettingsStore((s) => s.setOpenRouterEnrichModel);
  const setOllamaChatModel = useSettingsStore((s) => s.setOllamaChatModel);
  const setOllamaEnrichModel = useSettingsStore((s) => s.setOllamaEnrichModel);
  const setEnrichEnabled = useSettingsStore((s) => s.setEnrichEnabled);
  const setIncludeEmbeddings = useSettingsStore((s) => s.setIncludeEmbeddingsInExport);
  const setOfflineMode = useSettingsStore((s) => s.setOfflineMode);
  const setCacheEmbeddings = useSettingsStore((s) => s.setCacheEmbeddings);
  const setEmbeddingQueryStyle = useSettingsStore((s) => s.setEmbeddingQueryStyle);
  const setOcrLanguage = useSettingsStore((s) => s.setOcrLanguage);
  const setOcrMaxPages = useSettingsStore((s) => s.setOcrMaxPages);

  const [enrichResult, setEnrichResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [clearNote, setClearNote] = useState<string | null>(null);
  const [diagnosticsNote, setDiagnosticsNote] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [storageLabel, setStorageLabel] = useState<string | null>(null);
  const [storageLevel, setStorageLevel] = useState<StoragePressure | null>(null);
  const [cacheNote, setCacheNote] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  // Which providers the current selections actually use — the OpenRouter and
  // Ollama config blocks are shared between chat and enrichment.
  const needsOpenRouter = chatProvider === 'openrouter' || enrichProvider === 'openrouter';
  const needsOllama = chatProvider === 'ollama' || enrichProvider === 'ollama';
  const hasOpenRouterKey = openRouterKey.trim() !== '';

  // Live catalogs behind the two model pickers. `null` means "catalog
  // unknown" (not yet loaded, or unreachable) — distinct from an empty list,
  // which for Ollama genuinely means no models are installed. Both pickers
  // soft-fail to their built-in shortlist so configuration never blocks on
  // network state. The OpenRouter catalog is fetched only once a key is
  // entered: it validates the curated IDs and surfaces a bad key as a 401.
  const [openRouterAvailable, setOpenRouterAvailable] = useState<string[] | null>(null);
  const [openRouterModelsNote, setOpenRouterModelsNote] = useState<string | null>(null);
  const [ollamaInstalled, setOllamaInstalled] = useState<string[] | null>(null);
  const [ollamaModelsNote, setOllamaModelsNote] = useState<string | null>(null);
  const [ollamaReloads, setOllamaReloads] = useState(0);

  useEffect(() => {
    if (!open || AIRGAP || offlineMode || !needsOpenRouter || !hasOpenRouterKey) {
      setOpenRouterModelsNote(null);
      return;
    }
    let cancelled = false;
    setOpenRouterModelsNote('Checking your key against the model catalog…');
    // Debounced: the key arrives one keystroke at a time.
    const timer = setTimeout(() => {
      void fetchModelCatalog('openrouter', openRouterKey).then((catalog) => {
        if (cancelled) return;
        setOpenRouterAvailable(catalog.ok ? catalog.models : null);
        setOpenRouterModelsNote(
          catalog.ok
            ? null
            : `Couldn't reach the OpenRouter catalog (${catalog.error}) — the list below may include a model your key can't use.`,
        );
      });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, offlineMode, needsOpenRouter, hasOpenRouterKey, openRouterKey]);

  useEffect(() => {
    if (!open || AIRGAP || offlineMode || !needsOllama) return;
    let cancelled = false;
    setOllamaModelsNote('Checking installed models…');
    void fetchModelCatalog('ollama', '').then((catalog) => {
      if (cancelled) return;
      setOllamaInstalled(catalog.ok ? catalog.models : null);
      setOllamaModelsNote(
        catalog.ok
          ? `${catalog.models.length} installed model${catalog.models.length === 1 ? '' : 's'} found`
          : `${catalog.error}. Showing common models — pull one, then Recheck.`,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, offlineMode, needsOllama, ollamaReloads]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void estimateStorage().then((est) => {
      if (cancelled) return;
      if (!est) {
        setStorageLabel('Unavailable in this browser');
        setStorageLevel(null);
        return;
      }
      setStorageLabel(formatStorageSummary(est));
      setStorageLevel(storagePressure(est));
    });
    return () => {
      cancelled = true;
    };
  }, [open, cacheNote, clearNote]);

  if (!open) return null;

  // Chat and enrichment pick independently from purpose-specific shortlists —
  // chat can afford quality (one request per question), enrichment cannot
  // (one request per 15 documents, corpus-wide).
  const openRouterChatOptions = openRouterModelOptions(
    'chat',
    openRouterAvailable,
    openRouterChatModel,
  );
  const openRouterEnrichOptions = openRouterModelOptions(
    'enrichment',
    openRouterAvailable,
    openRouterEnrichModel,
  );
  // Installed models when we could read the server; otherwise common names so
  // the picker still offers something to select (and pull).
  const ollamaOptionsFor = (current: string): string[] => [
    ...new Set([...(ollamaInstalled ?? SUGGESTED_OLLAMA_MODELS), current].filter(Boolean)),
  ];

  const renderModelSelect = (
    label: string,
    hint: string,
    value: string,
    onChange: (next: string) => void,
    options: { id: string; label: string; note?: string }[],
  ) => (
    <label className="settings-field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} title={hint} className="settings-input">
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.note ? `${option.label} — ${option.note}` : option.label}
          </option>
        ))}
      </select>
    </label>
  );

  const enriching = phase === 'enriching' || enrichBusy;
  const enrichKeyMissing = enrichProvider === 'openrouter' && !hasOpenRouterKey;
  const enrichBlocked = !enrichEnabled || enrichKeyMissing;
  const enrichHint = !enrichEnabled
    ? 'Turn on "Enable AI enrichment" first'
    : enrichKeyMissing
      ? 'Paste your OpenRouter API key first'
      : 'Generate AI summaries, topics and cluster names';
  const appVersion = getAppVersion();
  const buildFlavor = AIRGAP ? 'airgap' : 'standard';
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  const diagnosticsText = buildDiagnosticsText({
    version: appVersion,
    buildFlavor,
    userAgent,
    nodeCount,
    edgeCount,
    lastError,
    storage: storageLabel ?? undefined,
  });

  const onEnrichNow = () => {
    setEnrichResult(null);
    setEnrichBusy(true);
    runEnrichment()
      .then(setEnrichResult, (err: unknown) =>
        setEnrichResult({ ok: false, message: String(err) }),
      )
      .finally(() => setEnrichBusy(false));
  };

  // Full "start over": empties the live graph/UI/chat immediately, then wipes
  // every locally cached document, embedding, graph, and snapshot. The API
  // key and other settings live in localStorage and are intentionally kept.
  const onClearAll = () => {
    setClearNote(null);
    setClearing(true);
    resetClearedDataState();
    // clearAllCaches() catches internally and always resolves (never rejects)
    // — fire-and-forget from this synchronous handler.
    void clearAllCaches()
      .then((ok) =>
        setClearNote(
          ok
            ? 'All data cleared.'
            : 'Graph cleared, but cached data could not be removed (storage unavailable).',
        ),
      )
      .finally(() => {
        setClearing(false);
        setConfirmClear(false);
      });
  };

  const onCopyDiagnostics = () => {
    setDiagnosticsNote(null);
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard?.writeText) {
      setDiagnosticsNote('Clipboard unavailable.');
      return;
    }
    void clipboard.writeText(diagnosticsText).then(
      () => setDiagnosticsNote('Diagnostics copied.'),
      () => setDiagnosticsNote("Couldn't copy diagnostics."),
    );
  };

  return (
    <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}>
      <div
        ref={dialogRef}
        className="settings-panel glass-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
       
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-panel__header">
          <h2 className="settings-panel__title">Settings</h2>
          <CloseButton
           
            title="Close settings"
            aria-label="Close settings"
            onClick={() => setSettingsOpen(false)}
          />
        </div>

        {AIRGAP && (
          <section className="settings-section">
            <h3 className="settings-section__heading">AI</h3>
            <p className="settings-note">
              🔒 Air-gapped build — no external network. AI features are removed
              from this build.
            </p>
          </section>
        )}
        {!AIRGAP && (
        <section className="settings-section">
          <h3 className="settings-section__heading">AI (optional)</h3>
          <label
            className="settings-check"
            title="Blocks all external network in the app and answers chat from your documents locally. Behavioral setting — for the sealed, CSP-enforced guarantee, ship the air-gapped build."
          >
            <input
              type="checkbox"
              checked={offlineMode}
              onChange={(e) => setOfflineMode(e.target.checked)}
            />
            Offline mode — no external network; local answers only
          </label>
          {offlineMode && (
            <p className="settings-help">
              AI features below are disabled while offline. (Behavioral setting — the
              air-gapped build remains the enforced guarantee.)
            </p>
          )}
          <label className="settings-field">
            Chat provider
            <select
              value={chatProvider}
              onChange={(e) => setChatProvider(e.target.value as ChatProvider)}
              className="settings-input"
              disabled={offlineMode}
              title="Choose how document chat answers are generated"
            >
              <option value="local">Local passages</option>
              <option value="openrouter">OpenRouter</option>
              <option value="ollama">Ollama (local)</option>
            </select>
          </label>
          <label className="settings-field">
            Enrichment &amp; document AI provider
            <select
              value={enrichProvider}
              onChange={(e) => setEnrichProvider(e.target.value as EnrichProvider)}
              className="settings-input"
              disabled={offlineMode}
              title="Provider used for corpus enrichment (summaries, topics, cluster names) and the per-document Ask AI panel"
            >
              <option value="openrouter">OpenRouter</option>
              <option value="ollama">Ollama (local)</option>
            </select>
          </label>
          {!offlineMode && needsOpenRouter && (
            <>
              <label className="settings-field">
                OpenRouter API key
                <input
                  type="password"
                  value={openRouterKey}
                  onChange={(e) => setOpenRouterKey(e.target.value)}
                  placeholder="Paste your key"
                  autoComplete="off"
                  title="Your OpenRouter API key (openrouter.ai/keys). Required for every OpenRouter feature."
                  className="settings-input"
                />
              </label>
              <label
                className="settings-check"
                title="Keep the key in this browser's local storage. Uncheck to hold it only in memory for this tab — you'll re-paste it next visit."
              >
                <input
                  type="checkbox"
                  checked={rememberOpenRouterKey}
                  onChange={(e) => setRememberOpenRouterKey(e.target.checked)}
                />
                Remember OpenRouter key on this device
              </label>
              {!rememberOpenRouterKey && (
                <p className="settings-help">The OpenRouter key is held in memory for this tab only.</p>
              )}
              {hasOpenRouterKey ? (
                <>
                  {chatProvider === 'openrouter' &&
                    renderModelSelect(
                      'Chat model',
                      'Model that answers document chat questions',
                      openRouterChatModel,
                      setOpenRouterChatModel,
                      openRouterChatOptions,
                    )}
                  {enrichProvider === 'openrouter' && (
                    <>
                      {renderModelSelect(
                        'Enrichment & document AI model',
                        'Model used for corpus enrichment and the per-document Ask AI panel',
                        openRouterEnrichModel,
                        setOpenRouterEnrichModel,
                        openRouterEnrichOptions,
                      )}
                      <p className="settings-help">
                        Enrichment options are all fast-tier models: it sends one request per
                        15 documents across the whole corpus, where a large reasoning model
                        turns minutes into hours. Chat is one request per question, so it can
                        afford a stronger model.
                      </p>
                    </>
                  )}
                  {openRouterModelsNote && <p className="settings-help">{openRouterModelsNote}</p>}
                </>
              ) : (
                <p className="settings-help">Paste your OpenRouter API key to choose a model.</p>
              )}
            </>
          )}
          {!offlineMode && needsOllama && (
            <>
              {chatProvider === 'ollama' &&
                renderModelSelect(
                  'Chat model (Ollama)',
                  'Installed model that answers document chat questions',
                  ollamaChatModel,
                  setOllamaChatModel,
                  ollamaOptionsFor(ollamaChatModel).map((m) => ({ id: m, label: m })),
                )}
              {enrichProvider === 'ollama' &&
                renderModelSelect(
                  'Enrichment & document AI model (Ollama)',
                  'Installed model used for corpus enrichment and the per-document Ask AI panel',
                  ollamaEnrichModel,
                  setOllamaEnrichModel,
                  ollamaOptionsFor(ollamaEnrichModel).map((m) => ({ id: m, label: m })),
                )}
              <div className="settings-confirm">
                <button
                  type="button"
                  onClick={() => setOllamaReloads((n) => n + 1)}
                  title="Re-read the models installed on your Ollama server"
                  className="settings-btn"
                >
                  Recheck installed models
                </button>
              </div>
              {ollamaModelsNote && <p className="settings-help">{ollamaModelsNote}</p>}
              <p className="settings-help">
                Ollama runs on your own machine at 127.0.0.1:11434 — no API key, nothing
                leaves this machine. Install from ollama.com, then pull the model (e.g. `ollama
                pull{' '}
                {(chatProvider === 'ollama' ? ollamaChatModel : ollamaEnrichModel) ||
                  DEFAULT_OLLAMA_MODEL}
                `).
              </p>
            </>
          )}
          <label
            className="settings-check"
            title="Enable AI enrichment and per-document AI using the enrichment provider selected above."
          >
            <input
              type="checkbox"
              checked={enrichEnabled}
              onChange={(e) => setEnrichEnabled(e.target.checked)}
              disabled={offlineMode}
            />
            Enable AI enrichment and document AI
          </label>
          <button
            type="button"
            onClick={onEnrichNow}
            disabled={enriching || enrichBlocked || offlineMode}
            title={enrichHint}
            className="settings-btn"
            style={{
              opacity: enriching || enrichBlocked || offlineMode ? 0.55 : 1,
              cursor: enriching || enrichBlocked || offlineMode ? 'default' : 'pointer',
            }}
          >
            {enriching ? 'Enriching…' : 'Enrich now'}
          </button>
          {enrichResult && (
            <p className="settings-note" style={{ color: enrichResult.ok ? '#69db7c' : '#ffc078' }}>
              {enrichResult.message}
            </p>
          )}
          <p className="settings-help">
            Your documents are processed locally. With enrichment ON, each document&apos;s full
            stored text is sent to the enrichment provider selected above — OpenRouter
            (cloud, may incur model charges) or your local Ollama server. Enormous files are
            capped at {DOCUMENT_AI_MAX_CONTEXT_CHARS.toLocaleString('en-US')} characters so they fit the model. &quot;Ask AI&quot; sends the
            selected document to that provider. Chat sends only retrieved document passages and
            recent chat history to the chat provider; your notes and tags are excluded.
          </p>
        </section>
        )}

        <details className="settings-advanced">
          <summary className="settings-section__heading" style={{ cursor: 'pointer', listStyle: 'revert' }}>
            Advanced
          </summary>
          <div className="settings-section" style={{ marginTop: 12 }}>
          <h3 className="settings-section__heading">Recognition</h3>
          <label className="settings-field">
            Semantic search language
            <select
              value={embeddingQueryStyle}
              onChange={(e) => setEmbeddingQueryStyle(e.target.value as EmbeddingQueryStyle)}
              title="English uses BGE's retrieval instruction prefix. Language-neutral skips it for mixed-language corpora."
              className="settings-input"
            >
              <option value="english">English (best for English corpora)</option>
              <option value="neutral">Language-neutral (mixed / non-English queries)</option>
            </select>
          </label>
          <p className="settings-help">
            Vectors still come from the bundled English BGE-small model. Language-neutral mode
            only drops the English search instruction so non-English queries are not prefixed
            with English text. Keyword, import, and title links are language-agnostic.
          </p>
          <label className="settings-field">
            OCR language (scanned PDFs)
            <select
              value={ocrLanguage}
              onChange={(e) => setOcrLanguage(e.target.value as OcrLanguageId)}
              title="English is bundled. Other languages need a matching traineddata.gz under /ocr/lang/."
              className="settings-input"
            >
              {OCR_LANGUAGE_OPTIONS.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.label}
                  {lang.bundled ? ' (bundled)' : ' (needs language pack)'}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            OCR page limit
            <select
              value={ocrMaxPages}
              onChange={(e) => setOcrMaxPages(Number(e.target.value) as OcrMaxPages)}
              title="More pages take longer and use more memory. Applies to the next scanned PDF."
              className="settings-input"
            >
              {OCR_PAGE_OPTIONS.map((pages) => (
                <option key={pages} value={pages}>
                  First {pages} pages
                </option>
              ))}
            </select>
          </label>
          <p className="settings-help">
            Extra Tesseract packs are files like <code>spa.traineddata.gz</code> in{' '}
            <code>public/ocr/lang/</code>. Without the pack, recognition falls back to whatever
            English can read.
          </p>
          <label
            className="settings-check"
            title="Embed document vectors in the exported JSON so semantic search/chat work after re-import. Makes the file much larger."
          >
            <input
              type="checkbox"
              checked={includeEmbeddings}
              onChange={(e) => setIncludeEmbeddings(e.target.checked)}
            />
            Include embeddings in JSON export (larger file)
          </label>
          </div>
        </details>

        <section className="settings-section">
          <h3 className="settings-section__heading">Performance</h3>
          <label
            className="settings-check"
            title="Automatically lower visual quality (bloom, labels, depth of field) when the frame rate drops, and restore it when there's headroom. Turn off to keep maximum quality even if a large graph stutters."
          >
            <input
              type="checkbox"
              checked={autoQuality}
              onChange={(e) => setAutoQuality(e.target.checked)}
            />
            Auto-adjust quality for smooth performance
          </label>
        </section>

        <section className="settings-section">
          <h3 className="settings-section__heading">Data</h3>
          <label
            className="settings-check"
            title="Store document vectors in IndexedDB so the next visit skips re-embedding. Turn off to free space; the next reload re-embeds from cached text."
          >
            <input
              type="checkbox"
              checked={cacheEmbeddings}
              onChange={(e) => {
                const on = e.target.checked;
                setCacheEmbeddings(on);
                if (on) {
                  setCacheNote('Embeddings will be stored on the next save.');
                  return;
                }
                setCacheNote(null);
                void clearEmbeddingsCache().then((ok) =>
                  setCacheNote(
                    ok
                      ? 'Cached embeddings removed. The next reload will re-embed from saved text.'
                      : 'Could not clear cached embeddings (storage unavailable).',
                  ),
                );
              }}
            />
            Cache embeddings for instant reload (uses more storage)
          </label>
          <div className="settings-confirm">
            <button
              type="button"
              onClick={() => {
                setCacheNote(null);
                void clearEmbeddingsCache().then((ok) =>
                  setCacheNote(
                    ok ? 'Cached embeddings removed.' : 'Could not clear embeddings.',
                  ),
                );
              }}
              title="Delete stored vectors only. Document text stays; the next reload re-embeds."
              className="settings-btn"
            >
              Clear embeddings
            </button>
            <button
              type="button"
              onClick={() => {
                setCacheNote(null);
                void clearOriginalsCache().then((ok) =>
                  setCacheNote(
                    ok
                      ? 'Original files removed. Open falls back to the text viewer.'
                      : 'Could not clear original files.',
                  ),
                );
              }}
              title="Delete retained original file bytes. Extracted text and the graph stay."
              className="settings-btn"
            >
              Clear original files
            </button>
          </div>
          {cacheNote && <p className="settings-note">{cacheNote}</p>}
          {!confirmClear ? (
            <button
              type="button"
              onClick={() => {
                setClearNote(null);
                setConfirmClear(true);
              }}
              title="Remove every loaded document and all locally cached data (documents, embeddings, graphs, snapshots, chat history, notes and tags). Cannot be undone."
              className="settings-btn settings-btn--danger"
            >
              Clear all data
            </button>
          ) : (
            <>
              <p className="settings-note">
                Remove all loaded documents and clear every cached document, embedding,
                graph, and snapshot from this browser? This cannot be undone.
              </p>
              <div className="settings-confirm">
                <button
                  type="button"
                  onClick={onClearAll}
                  disabled={clearing}
                  title="Permanently clear everything"
                  className="settings-btn settings-btn--danger" style={{ opacity: clearing ? 0.6 : 1 }}
                >
                  {clearing ? 'Clearing…' : 'Yes, clear everything'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  disabled={clearing}
                  title="Keep my data"
                  className="settings-btn"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
          <p className="settings-help">
            Wipes the current graph and all locally cached data. Your API keys and settings
            are kept.
          </p>
          {clearNote && <p className="settings-note">{clearNote}</p>}
        </section>

        <section className="settings-section">
          <h3 className="settings-section__heading">About</h3>
          <div className="settings-details">
            <span className="settings-details__label">Version</span>
            <span className="settings-details__value">{appVersion}</span>
            <span className="settings-details__label">Build</span>
            <span className="settings-details__value">{buildFlavor}</span>
            <span className="settings-details__label">Browser</span>
            <span className="settings-details__value">{userAgent}</span>
            <span className="settings-details__label">Corpus</span>
            <span className="settings-details__value">
              {documentCount} document{documentCount === 1 ? '' : 's'}
              {topicCount > 0 && ` / ${topicCount} topic node${topicCount === 1 ? '' : 's'}`}
              {' / '}{edgeCount} connection{edgeCount === 1 ? '' : 's'}
            </span>
            <span className="settings-details__label">Storage</span>
            <span className="settings-details__value">
              {storageLabel ?? 'Measuring…'}
              {storageLevel === 'warn' && ' — getting full'}
              {storageLevel === 'critical' && ' — nearly full'}
            </span>
            <span className="settings-details__label">Last error</span>
            <span className="settings-details__value">
              {lastError ? lastError.message : 'None recorded'}
            </span>
          </div>
          <button
            type="button"
            onClick={onCopyDiagnostics}
            title="Copy local diagnostic details to the clipboard"
            className="settings-btn"
          >
            Copy diagnostics
          </button>
          {diagnosticsNote && <p className="settings-note">{diagnosticsNote}</p>}
        </section>
      </div>
    </div>
  );
}
