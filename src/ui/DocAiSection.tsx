/**
 * "Ask AI" section of the side panel: summarize the selected document,
 * outline every topic in it, or ask a free-form question about it — all via
 * the user's own Gemini key behind the enrichment opt-in gate. Mount with
 * key={docId} so state resets when the selection changes.
 */

import { useState } from 'react';
import { askDocAi, docAiBlockedReason, type DocAiAction } from '../enrich/gemini';
import { useSettingsStore } from '../store/settingsStore';
import { useUiStore } from '../store/uiStore';

const HEADINGS: Record<DocAiAction, string> = {
  summarize: 'AI summary',
  outline: 'Outline',
  ask: 'Answer',
};

interface Props {
  docId: string;
  title: string;
}

export default function DocAiSection({ docId, title }: Props) {
  // Subscribe so the section unlocks live when the key/toggle change.
  const enrichEnabled = useSettingsStore((s) => s.enrichEnabled);
  const hasKey = useSettingsStore((s) => s.geminiKey.trim() !== '');
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<DocAiAction | null>(null);
  const [result, setResult] = useState<{
    ok: boolean;
    text: string;
    heading: string;
  } | null>(null);

  const ready = enrichEnabled && hasKey;

  const run = (action: DocAiAction, q?: string): void => {
    if (busy) return;
    setBusy(action);
    setResult(null);
    askDocAi(docId, title, action, q)
      .then((r) => setResult({ ...r, heading: HEADINGS[action] }))
      .catch((err: unknown) =>
        setResult({ ok: false, text: String(err), heading: HEADINGS[action] }),
      )
      .finally(() => setBusy(null));
  };

  const submitQuestion = (): void => {
    if (question.trim() === '') return;
    run('ask', question);
  };

  return (
    <div className="side-panel__section">
      <p className="side-panel__section-label">Ask AI</p>
      {!ready ? (
        <p className="side-panel__summary is-fallback">
          {docAiBlockedReason()} to summarize, outline, or ask questions about this
          document.{' '}
          <button
            type="button"
            className="doc-ai__link"
            onClick={() => setSettingsOpen(true)}
          >
            Open Settings
          </button>
        </p>
      ) : (
        <>
          <div className="doc-ai__actions">
            <button
              type="button"
              className="btn-pill secondary doc-ai__btn"
              disabled={busy !== null}
              onClick={() => run('summarize')}
            >
              {busy === 'summarize' ? 'Summarizing…' : 'Summarize'}
            </button>
            <button
              type="button"
              className="btn-pill secondary doc-ai__btn"
              disabled={busy !== null}
              onClick={() => run('outline')}
            >
              {busy === 'outline' ? 'Outlining…' : 'Outline topics'}
            </button>
          </div>
          <div className="doc-ai__ask-row">
            <input
              type="text"
              className="doc-ai__input"
              value={question}
              placeholder="Ask about this document…"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitQuestion();
              }}
            />
            <button
              type="button"
              className="btn-pill secondary doc-ai__btn"
              disabled={busy !== null || question.trim() === ''}
              onClick={submitQuestion}
            >
              {busy === 'ask' ? 'Asking…' : 'Ask'}
            </button>
          </div>
          {result && (
            <div className={`doc-ai__result${result.ok ? '' : ' is-error'}`}>
              <p className="doc-ai__result-heading">
                {result.ok ? result.heading : 'Something went wrong'}
              </p>
              <div className="doc-ai__result-text">{result.text}</div>
            </div>
          )}
          <p className="doc-ai__disclosure">
            Sends up to the first ~12,000 characters of this document to Gemini.
          </p>
        </>
      )}
    </div>
  );
}
