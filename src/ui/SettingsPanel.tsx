/**
 * Settings modal: Gemini enrichment config, export options, cache management.
 * Visibility is owned by uiStore.settingsOpen; Esc handling lives in App.tsx
 * (no window key listeners here). Generic .panel-overlay/.glass styling comes
 * from the shared stylesheet — only panel-specific bits are inlined.
 */

import { useState, type CSSProperties } from 'react';
import { GEMINI_MODEL } from '../config';
import { runEnrichment } from '../enrich/gemini';
import { clearAllCaches } from '../persistence/cache';
import { resetCorpus } from '../pipeline/coordinator';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import { useUiStore } from '../store/uiStore';

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

export default function SettingsPanel() {
  const open = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const autoQuality = useUiStore((s) => s.autoQuality);
  const setAutoQuality = useUiStore((s) => s.setAutoQuality);
  const phase = useGraphStore((s) => s.phase);

  const geminiKey = useSettingsStore((s) => s.geminiKey);
  const rememberKey = useSettingsStore((s) => s.rememberGeminiKey);
  const geminiModel = useSettingsStore((s) => s.geminiModel);
  const enrichEnabled = useSettingsStore((s) => s.enrichEnabled);
  const includeEmbeddings = useSettingsStore((s) => s.includeEmbeddingsInExport);
  const setGeminiKey = useSettingsStore((s) => s.setGeminiKey);
  const setRememberKey = useSettingsStore((s) => s.setRememberGeminiKey);
  const setGeminiModel = useSettingsStore((s) => s.setGeminiModel);
  const setEnrichEnabled = useSettingsStore((s) => s.setEnrichEnabled);
  const setIncludeEmbeddings = useSettingsStore((s) => s.setIncludeEmbeddingsInExport);

  const [enrichResult, setEnrichResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [clearNote, setClearNote] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  if (!open) return null;

  const enriching = phase === 'enriching' || enrichBusy;
  const enrichBlocked = !enrichEnabled || geminiKey.trim() === '';
  const enrichHint = !enrichEnabled
    ? 'Turn on "Enable enrichment" first'
    : geminiKey.trim() === ''
      ? 'Paste your Gemini API key first'
      : 'Run Gemini summaries, topics and cluster names';

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
    clearAllCaches()
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

  return (
    <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}>
      <div
        className="settings-panel glass-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={headerRowStyle}>
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

        <section style={sectionStyle}>
          <h3 style={headingStyle}>AI Enrichment (optional)</h3>
          <label style={labelStyle}>
            Gemini API key
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder="Paste your key"
              autoComplete="off"
              title="Your Google Gemini API key. Stored only in this browser; used for enrichment, per-document AI, and chat."
              style={inputStyle}
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
            />
            Remember key on this device
          </label>
          {!rememberKey && (
            <p style={helpStyle}>
              The key is kept in memory for this tab only and cleared from browser storage —
              you&apos;ll need to paste it again next visit.
            </p>
          )}
          <label style={labelStyle}>
            Model
            <input
              type="text"
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
              placeholder={GEMINI_MODEL}
              title="Gemini model id used for all AI calls (e.g. gemini-2.5-flash). Leave blank for the default."
              style={inputStyle}
            />
            <span style={helpStyle}>Gemini model used for summaries &amp; topic naming</span>
          </label>
          <label
            style={checkboxRowStyle}
            title="Master switch for all Gemini features — enrichment, per-document AI, and chat. Off = fully local, no network."
          >
            <input
              type="checkbox"
              checked={enrichEnabled}
              onChange={(e) => setEnrichEnabled(e.target.checked)}
            />
            Enable enrichment
          </label>
          <button
            type="button"
            onClick={onEnrichNow}
            disabled={enriching || enrichBlocked}
            title={enrichHint}
            style={{
              ...buttonStyle,
              opacity: enriching || enrichBlocked ? 0.55 : 1,
              cursor: enriching || enrichBlocked ? 'default' : 'pointer',
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
            chars per doc) are sent to Google&apos;s Gemini API; using &quot;Ask AI&quot; on a
            selected document, or chatting, sends the full text of the relevant document(s).
            The key is stored only in this browser.
          </p>
        </section>

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
            Wipes the current graph and all locally cached data. Your Gemini API key and
            settings are kept.
          </p>
          {clearNote && <p style={noteStyle}>{clearNote}</p>}
        </section>
      </div>
    </div>
  );
}
