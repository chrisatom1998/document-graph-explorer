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
const helpStyle: CSSProperties = { fontSize: 11.5, opacity: 0.6, margin: 0 };
const noteStyle: CSSProperties = { fontSize: 12.5, margin: 0 };

export default function SettingsPanel() {
  const open = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const phase = useGraphStore((s) => s.phase);

  const geminiKey = useSettingsStore((s) => s.geminiKey);
  const geminiModel = useSettingsStore((s) => s.geminiModel);
  const enrichEnabled = useSettingsStore((s) => s.enrichEnabled);
  const includeEmbeddings = useSettingsStore((s) => s.includeEmbeddingsInExport);
  const setGeminiKey = useSettingsStore((s) => s.setGeminiKey);
  const setGeminiModel = useSettingsStore((s) => s.setGeminiModel);
  const setEnrichEnabled = useSettingsStore((s) => s.setEnrichEnabled);
  const setIncludeEmbeddings = useSettingsStore((s) => s.setIncludeEmbeddingsInExport);

  const [enrichResult, setEnrichResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [clearNote, setClearNote] = useState<string | null>(null);

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

  const onClearCache = () => {
    setClearNote(null);
    clearAllCaches().then((ok) =>
      setClearNote(
        ok
          ? 'Cached session cleared — reload to start fresh.'
          : 'Could not clear the cache (storage unavailable).',
      ),
    );
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
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Model
            <input
              type="text"
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
              placeholder={GEMINI_MODEL}
              style={inputStyle}
            />
            <span style={helpStyle}>Gemini model used for summaries &amp; topic naming</span>
          </label>
          <label style={checkboxRowStyle}>
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
            selected document sends up to its first ~12,000 chars. The key is stored only in
            this browser.
          </p>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>Export</h3>
          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={includeEmbeddings}
              onChange={(e) => setIncludeEmbeddings(e.target.checked)}
            />
            Include embeddings in JSON export (larger file)
          </label>
        </section>

        <section style={sectionStyle}>
          <h3 style={headingStyle}>Data</h3>
          <button type="button" onClick={onClearCache} style={buttonStyle}>
            Clear cached session
          </button>
          <p style={helpStyle}>
            Removes all locally cached documents, embeddings and graphs — reload to start fresh.
          </p>
          {clearNote && <p style={noteStyle}>{clearNote}</p>}
        </section>
      </div>
    </div>
  );
}
