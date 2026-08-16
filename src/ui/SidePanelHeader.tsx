import type { RefObject } from 'react';
import type { DocNode } from '../model/types';
import type { CodeLanguage } from '../pipeline/codeLanguage';
import { removeDocuments } from '../pipeline/coordinator';
import { useUiStore } from '../store/uiStore';
import { openDocument } from './openDocument';
import { startCompare } from './openCompare';
import { showSimilarTo } from './showSimilar';
import CloseButton from './CloseButton';

interface SidePanelHeaderProps {
  node: DocNode;
  codeLang: CodeLanguage | null;
  confirmRemove: boolean;
  onArmRemove: () => void;
  onCancelRemove: () => void;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
}

export default function SidePanelHeader({
  node,
  codeLang,
  confirmRemove,
  onArmRemove,
  onCancelRemove,
  closeButtonRef,
}: SidePanelHeaderProps) {
  const setSelected = useUiStore((s) => s.setSelected);
  const pushToast = useUiStore((s) => s.pushToast);
  const isDocument = node.kind === 'document';
  const isTopic = node.kind === 'topic';

  return (
    <div className="side-panel__header">
      <div className="side-panel__header-top">
        <h2 className="side-panel__title">
          <span className="side-panel__title-text">{node.title}</span>
          {codeLang && (
            <span className="side-panel__title-lang" title={codeLang.label}>
              {codeLang.short}
            </span>
          )}
          {isTopic && <span className="chip side-panel__header-cluster">Topic hub</span>}
        </h2>
        {isDocument && (
          <button
            type="button"
            className="side-panel__open-btn"
            title="Open the original file — opens with your default app for this type"
            onClick={() => void openDocument(node.id)}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <path d="M9 2h5v5" />
              <path d="M14 2 L7 9" />
              <path d="M12 9v4.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5H7" />
            </svg>
            Open
          </button>
        )}
        <CloseButton
          ref={closeButtonRef}
          title="Back to graph"
          aria-label="Back to graph"
          onClick={() => setSelected(null)}
        />
      </div>
      {isDocument && (
        <div className="side-panel__header-actions">
          <button
            type="button"
            className="side-panel__open-btn"
            title="Highlight documents similar to this one in the graph"
            onClick={() => {
              const count = showSimilarTo(node.id);
              if (count === 0) {
                pushToast('No similar documents in this corpus', 'info');
              }
            }}
          >
            More like this
          </button>
          <button
            type="button"
            className="side-panel__open-btn"
            title="Compare this document with another — click a second node in the graph"
            onClick={() => startCompare(node.id)}
          >
            Compare
          </button>
          {!confirmRemove && (
            <button
              type="button"
              className="side-panel__open-btn side-panel__remove-btn"
              title="Remove this document from the graph and delete its cached data — the file on disk is untouched"
              onClick={onArmRemove}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <path d="M3 4.5h10" />
                <path d="M6 4.5V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v2" />
                <path d="M4.5 4.5l.6 8.6a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.6" />
              </svg>
              Remove
            </button>
          )}
        </div>
      )}
      {isDocument && confirmRemove && (
        <div className="side-panel__remove-confirm">
          <span className="side-panel__remove-confirm-text">
            Remove from graph? This also deletes its cached data — the
            file on disk is untouched.
          </span>
          <button
            type="button"
            className="side-panel__open-btn side-panel__remove-btn side-panel__remove-confirm-btn"
            title="Permanently remove this document and its cached data"
            onClick={() => {
              void removeDocuments([node.id]);
              setSelected(null);
            }}
          >
            Confirm
          </button>
          <button
            type="button"
            className="side-panel__open-btn"
            title="Keep this document"
            onClick={onCancelRemove}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
