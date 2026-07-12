/**
 * Settings modal: Gemini enrichment config, export options, cache management.
 * Visibility is owned by uiStore.settingsOpen; Esc handling lives in App.tsx
 * (no window key listeners here). Generic .panel-overlay/.glass styling comes
 * from the shared stylesheet — only panel-specific bits are inlined.
 */

import { useRef, useState, type CSSProperties } from 'react';
import { AIRGAP } from '../airgap';
import { useFocusTrap } from './useFocusTrap';
import { runEnrichment } from '../enrich/gemini';
import { clearAllCaches } from '../persistence/cache';
import { resetCorpus } from '../pipeline/coordinator';
import { useGraphStore } from '../store/graphStore';
import { DEFAULT_OPENROUTER_MODEL, useSettingsStore } from '../store/settingsStore';
import { useUiStore } from '../store/uiStore';
import { buildDiagnosticsText, getAppVersion } from './diagnostics';

const panelStyle: CSSProperties = {
  width: 'min(460px, 92vw)',
  maxHeight: '82vh',
  overflowY: 'auto',
  padding: '20px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
};
const headerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const titleStyle: CSSProperties = { margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: 0.3 };
const closeBtnStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  padding: 4,
  opacity: 0.7,
};
const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };
const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 1.2,
  opacity: 0.65,
};
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 };
const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 9px',
  borderRadius: 7,
  border: '1px solid rgba(255,255,255,0.16)',
  background: 'rgba(255,255,255,0.06)',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13,
};
const checkboxRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  cursor: 'pointer',
};
const buttonStyle: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '7px 14px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(120,140,255,0.15)',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
};
const dangerButtonStyle: CSSProperties = {
  ...buttonStyle,
  border: '1px solid rgba(255, 128, 128, 0.35)',
  background: 'rgba(255, 128, 128, 0.12)',
  color: '#ff9a9a',
};
const confirmRowStyle: CSSProperties = { display: 'flex', gap: 8, alignSelf: 'flex-start' };
const helpStyle: CSSProperties = { fontSize: 11.5, opacity: 0.6, margin: 0 };
const noteStyle: CSSProperties = { fontSize: 12.5, margin: 0 };
const detailGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: '5px 10px',
  fontSize: 12.5,
};
const detailLabelStyle: CSSProperties = { opacity: 0.6 };
const detailValueStyle: CSSProperties = {
  minWidth: 0,
  overflowWrap: 'anywhere',
};

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

  const geminiKey = useSettingsStore((s) => s.geminiKey);
  const rememberKey = useSettingsStore((s) => s.rememberGeminiKey);
  const chatProvider = useSettingsStore((s) => s.chatProvider);
  const openRouterKey = useSettingsStore((s) => s.openRouterKey);
  const rememberOpenRouterKey = useSettingsStore((s) => s.rememberOpenRouterKey);
  const openRouterModel = useSettingsStore((s) => s.openRouterModel);
  const enrichEnabled = useSettingsStore((s) => s.enrichEnabled);
  const includeEmbeddings = useSettingsStore((s) => s.includeEmbeddingsInExport);
  const offlineMode = useSettingsStore((s) => s.offlineMode);
  const setGeminiKey = useSettingsStore((s) => s.setGeminiKey);
  const setRememberKey = useSettingsStore((s) => s.setRememberGeminiKey);
  const setChatProvider = useSettingsStore((s) => s.setChatProvider);
  const setOpenRouterKey = useSettingsStore((s) => s.setOpenRouterKey);
  const setRememberOpenRouterKey = useSettingsStore((s) => s.setRememberOpenRouterKey);
  const setOpenRouterModel = useSettingsStore((s) => s.setOpenRouterModel);
  const setEnrichEnabled = useSettingsStore((s) => s.setEnrichEnabled);
  const setIncludeEmbeddings = useSettingsStore((s) => s.setIncludeEmbeddingsInExport);
  const setOfflineMode = useSettingsStore((s) => s.setOfflineMode);

  const [enrichResult, setEnrichResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [clearNote, setClearNote] = useState<string | null>(null);
  const [diagnosticsNote, setDiagnosticsNote] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  if (!open) return null;

  const enriching = phase === 'enriching' || enrichBusy;
  const enrichBlocked = !enrichEnabled || geminiKey.trim() === '';
  const enrichHint = !enrichEnabled
    ? 'Turn on "Enable enrichment" first'
    : geminiKey.trim() === ''
      ? 'Paste your Gemini API key first'
      : 'Run Gemini summaries, topics and cluster names';
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
  // every locally cached document, embedding, graph, and snapshot. The Gemini
  // key and other settings live in localStorage and are intentionally kept.
  const onClearAll = () => {
    setClearNote(null);
    setClearing(true);
    resetCorpus();
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
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-panel__header" style={headerRowStyle}>
          <h2 style={titleStyle}>Settings</h2>
          <button
            type="button"
            style={closeBtnStyle}
            onClick={() => setSettingsOpen(false)}
            aria-label="Close settings"
            title="Close settings"
          >
            ✕
          </button>
        </div>

        {AIRGAP && (
          <section style={sectionStyle}>
            <h3 style={headingStyle}>AI</h3>
            <p style={noteStyle}>
              🔒 Air-gapped build — no external network. AI features are removed
              from this build.
            </p>
          </section>
        )}
        {!AIRGAP && (
        <section style={sectionStyle}>
          <h3 style={headingStyle}>AI (optional)</h3>
          <label
            style={checkboxRowStyle}
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
            <p style={helpStyle}>
              AI features below are disabled while offline. (Behavioral setting — the
              air-gapped build remains the enforced guarantee.)
            </p>
          )}
          <label style={labelStyle}>
            Chat provider
            <select
              value={chatProvider}
              onChange={(e) => setChatProvider(e.target.value as 'local' | 'gemini' | 'openrouter')}
              style={inputStyle}
              disabled={offlineMode}
              title="Choose how document chat answers are generated"
            >
              <option value="local">Local passages</option>
              <option value="gemini">Google Gemini</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </label>
          {chatProvider === 'openrouter' && (
            <>
              <label style={labelStyle}>
                OpenRouter API key
                <input
                  type="password"
                  value={openRouterKey}
                  onChange={(e) => setOpenRouterKey(e.target.value)}
                  placeholder="Paste your key"
                  autoComplete="off"
                  style={inputStyle}
                  disabled={offlineMode}
                />
              </label>
              <label style={checkboxRowStyle}>
                <input
                  type="checkbox"
                  checked={rememberOpenRouterKey}
                  onChange={(e) => setRememberOpenRouterKey(e.target.checked)}
                  disabled={offlineMode}
                />
                Remember OpenRouter key on this device
              </label>
              {!rememberOpenRouterKey && (
                <p style={helpStyle}>The OpenRouter key is held in memory for this tab only.</p>
              )}
              <label style={labelStyle}>
                OpenRouter model ID
                <input
                  type="text"
                  value={openRouterModel}
                  onChange={(e) => setOpenRouterModel(e.target.value)}
                  onBlur={() => {
                    if (!openRouterModel) setOpenRouterModel(DEFAULT_OPENROUTER_MODEL);
                  }}
                  placeholder="provider/model"
                  spellCheck={false}
                  style={inputStyle}
                  disabled={offlineMode}
                />
              </label>
              <p style={helpStyle}>
                Chat sends retrieved passages and recent chat history to OpenRouter. Usage may incur model charges.
              </p>
            </>
          )}
          <label style={labelStyle}>
            Gemini API key
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder="Paste your key"
              autoComplete="off"
              title="Your Google Gemini API key. Used for enrichment, per-document AI, and Gemini chat."
              style={inputStyle}
              disabled={offlineMode}
            />
          </label>
          <label
            style={checkboxRowStyle}
            title="Keep the key in this browser's local storage. Uncheck to hold it only in memory for this tab — you'll re-paste it next visit."
          >
            <input
              type="checkbox"
              checked={rememberKey}
              onChange={(e) => setRememberKey(e.target.checked)}
              disabled={offlineMode}
            />
            Remember key on this device
          </label>
          {!rememberKey && (
            <p style={helpStyle}>
              The key is kept in memory for this tab only and cleared from browser storage —
              you&apos;ll need to paste it again next visit.
            </p>
          )}
          <label
            style={checkboxRowStyle}
            title="Enable Gemini enrichment and per-document AI. Document chat uses the provider selected above."
          >
            <input
              type="checkbox"
              checked={enrichEnabled}
              onChange={(e) => setEnrichEnabled(e.target.checked)}
              disabled={offlineMode}
            />
            Enable Gemini enrichment and document AI
          </label>
          <button
            type="button"
            onClick={onEnrichNow}
            disabled={enriching || enrichBlocked || offlineMode}
            title={enrichHint}
            style={{
              ...buttonStyle,
              opacity: enriching || enrichBlocked || offlineMode ? 0.55 : 1,
              cursor: enriching || enrichBlocked || offlineMode ? 'default' : 'pointer',
            }}
          >
            {enriching ? 'Enriching…' : 'Enrich now'}
          </button>
          {enrichResult && (
            <p style={{ ...noteStyle, color: enrichResult.ok ? '#69db7c' : '#ffc078' }}>
              {enrichResult.message}
            </p>
          )}
          <p style={helpStyle}>
            Your documents are processed locally. With enrichment ON, excerpts (first ~1,200
            chars per doc) are sent to Google&apos;s Gemini API. &quot;Ask AI&quot; sends the selected
            document to Gemini. Chat sends only retrieved passages and recent chat history to
            the provider selected above.
          </p>
        </section>
        )}

        <section style={sectionStyle}>
          <h3 style={headingStyle}>Export</h3>
          <label
            style={checkboxRowStyle}
            title="Embed document vectors in the exported JSON so semantic search/chat work after re-import. Makes the file much larger."
          >
            <input
              type="checkbox"
              checked={includeEmbeddings}
              onChange={(e) => setIncludeEmbeddings(e.target.checked)}
            />
            Include embeddings in JSON export (larger file)
          </label>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>Performance</h3>
          <label
            style={checkboxRowStyle}
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

        <section style={sectionStyle}>
          <h3 style={headingStyle}>Data</h3>
          {!confirmClear ? (
            <button
              type="button"
              onClick={() => {
                setClearNote(null);
                setConfirmClear(true);
              }}
              title="Remove every loaded document and all locally cached data (documents, embeddings, graphs, snapshots). Cannot be undone."
              style={dangerButtonStyle}
            >
              Clear all data
            </button>
          ) : (
            <>
              <p style={noteStyle}>
                Remove all loaded documents and clear every cached document, embedding,
                graph, and snapshot from this browser? This cannot be undone.
              </p>
              <div style={confirmRowStyle}>
                <button
                  type="button"
                  onClick={onClearAll}
                  disabled={clearing}
                  title="Permanently clear everything"
                  style={{ ...dangerButtonStyle, opacity: clearing ? 0.6 : 1 }}
                >
                  {clearing ? 'Clearing…' : 'Yes, clear everything'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  disabled={clearing}
                  title="Keep my data"
                  style={buttonStyle}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
          <p style={helpStyle}>
            Wipes the current graph and all locally cached data. Your API keys and settings
            are kept.
          </p>
          {clearNote && <p style={noteStyle}>{clearNote}</p>}
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>About</h3>
          <div style={detailGridStyle}>
            <span style={detailLabelStyle}>Version</span>
            <span style={detailValueStyle}>{appVersion}</span>
            <span style={detailLabelStyle}>Build</span>
            <span style={detailValueStyle}>{buildFlavor}</span>
            <span style={detailLabelStyle}>Browser</span>
            <span style={detailValueStyle}>{userAgent}</span>
            <span style={detailLabelStyle}>Corpus</span>
            <span style={detailValueStyle}>
              {documentCount} document{documentCount === 1 ? '' : 's'}
              {topicCount > 0 && ` / ${topicCount} topic node${topicCount === 1 ? '' : 's'}`}
              {' / '}{edgeCount} connection{edgeCount === 1 ? '' : 's'}
            </span>
            <span style={detailLabelStyle}>Last error</span>
            <span style={detailValueStyle}>
              {lastError ? lastError.message : 'None recorded'}
            </span>
          </div>
          <button
            type="button"
            onClick={onCopyDiagnostics}
            title="Copy local diagnostic details to the clipboard"
            style={buttonStyle}
          >
            Copy diagnostics
          </button>
          {diagnosticsNote && <p style={noteStyle}>{diagnosticsNote}</p>}
        </section>
      </div>
    </div>
  );
}
