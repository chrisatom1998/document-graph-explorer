import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  exportGraphJSON,
  exportScenePNG,
  importGraphJSONFile,
  toGraphExport,
} from '../persistence/exportImport';
import { createShareUrl } from '../persistence/shareUrl';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { useFocusTrap } from './useFocusTrap';

let graphJsonInput: HTMLInputElement | null = null;

export function openGraphJsonPicker(onPick: (file: File) => void): void {
  if (typeof document === 'undefined') return;
  if (!graphJsonInput) {
    graphJsonInput = document.createElement('input');
    graphJsonInput.type = 'file';
    graphJsonInput.accept = '.json,application/json';
    graphJsonInput.style.display = 'none';
    document.body.appendChild(graphJsonInput);
  }
  graphJsonInput.onchange = () => {
    const file = graphJsonInput?.files?.[0] ?? null;
    if (graphJsonInput) graphJsonInput.value = '';
    if (file) onPick(file);
  };
  graphJsonInput.click();
}

function plural(count: number, singular: string, pluralWord = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

function formatList(items: string[]): string {
  if (items.length < 2) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

function messageFromError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function importGraphJsonFileWithToast(file: File): Promise<boolean> {
  try {
    const { nodes, edges } = await importGraphJSONFile(file);
    const documentCount = nodes.filter((node) => node.kind === 'document').length;
    const topicCount = nodes.length - documentCount;
    const importedItems = [
      plural(documentCount, 'document'),
      ...(topicCount > 0 ? [plural(topicCount, 'topic node')] : []),
      plural(edges.length, 'connection'),
    ];
    useUiStore
      .getState()
      .pushToast(
        `Imported ${formatList(importedItems)}.`,
        'info',
      );
    return true;
  } catch (err) {
    useUiStore.getState().pushToast(messageFromError(err), 'error');
    return false;
  }
}

const confirmPanelStyle: CSSProperties = {
  width: 'min(420px, 92vw)',
  padding: '20px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};
const confirmTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 600,
};
const confirmTextStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.55,
  opacity: 0.78,
};
const confirmRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
};

function IconJson() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5.2 2.5H12L15 5.5v10H5.2a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" />
      <path d="M12 2.5v3h3" />
      <path d="M6.4 8.1c-.7.4-1 1-1 1.8s.3 1.4 1 1.8" strokeLinecap="round" />
      <path d="M11.6 8.1c.7.4 1 1 1 1.8s-.3 1.4-1 1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconImage() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2.7" y="3" width="12.6" height="12" rx="1.8" />
      <circle cx="6.5" cy="6.8" r="1.2" />
      <path
        d="M4 13l3.5-3.5 2.2 2.1 1.5-1.5L14 13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconImport() {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 2.5v8" />
      <path d="M5.8 7.5 9 10.7l3.2-3.2" />
      <path d="M3.5 12.5v1.8c0 .8.6 1.4 1.4 1.4h8.2c.8 0 1.4-.6 1.4-1.4v-1.8" />
    </svg>
  );
}

function IconLink() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M7.2 10.8 10.8 7.2" strokeLinecap="round" />
      <path d="M6.1 12.7 4.8 14a2.6 2.6 0 0 1-3.7-3.7l2.4-2.4a2.6 2.6 0 0 1 3.7 0" strokeLinecap="round" />
      <path d="m11.9 5.3 1.3-1.3a2.6 2.6 0 1 1 3.7 3.7l-2.4 2.4a2.6 2.6 0 0 1-3.7 0" strokeLinecap="round" />
    </svg>
  );
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Copy failed — export graph JSON instead.');
}

interface ExportImportMenuProps {
  onClose?: () => void;
  onDialogOpenChange?: (open: boolean) => void;
}

export default function ExportImportMenu({
  onClose,
  onDialogOpenChange,
}: ExportImportMenuProps) {
  const phase = useGraphStore((s) => s.phase);
  const nodeCount = useGraphStore((s) => s.nodes.length);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [shareConfirmOpen, setShareConfirmOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmOpen = pendingFile !== null || shareConfirmOpen;
  useFocusTrap(dialogRef, confirmOpen);

  useEffect(() => {
    onDialogOpenChange?.(confirmOpen);
    return () => {
      if (confirmOpen) onDialogOpenChange?.(false);
    };
  }, [confirmOpen, onDialogOpenChange]);

  const canImport = phase === 'idle' || phase === 'ready';
  const canExportGraph = phase === 'ready';

  const runImport = async (file: File) => {
    setImporting(true);
    const ok = await importGraphJsonFileWithToast(file);
    setImporting(false);
    if (ok) {
      setPendingFile(null);
      onClose?.();
    }
  };

  const pickImportFile = () => {
    if (!canImport) return;
    openGraphJsonPicker((file) => {
      if (useGraphStore.getState().nodes.length > 0) {
        setPendingFile(file);
        return;
      }
      void runImport(file);
    });
  };

  const cancelImport = () => {
    if (!importing) setPendingFile(null);
  };

  const copyShareLink = async () => {
    setSharing(true);
    try {
      const url = await createShareUrl(toGraphExport(false));
      await copyText(url);
      useUiStore.getState().pushToast('Shareable graph link copied.', 'info');
      setShareConfirmOpen(false);
      onClose?.();
    } catch (error) {
      useUiStore.getState().pushToast(messageFromError(error), 'error');
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      <div className="toolbar__menu glass-panel">
        <button
          type="button"
          className="toolbar__menu-item"
          title="Copy a backend-free link to this graph"
          disabled={!canExportGraph}
          onClick={() => setShareConfirmOpen(true)}
        >
          <IconLink />
          <span>Copy shareable URL</span>
        </button>
        <button
          type="button"
          className="toolbar__menu-item"
          title="Export the current graph as JSON"
          disabled={!canExportGraph}
          onClick={() => {
            void exportGraphJSON()
              .then(() =>
                useUiStore.getState().pushToast('Graph JSON export started.', 'info'),
              )
              .catch((err: unknown) =>
                useUiStore.getState().pushToast(messageFromError(err), 'error'),
              );
            onClose?.();
          }}
        >
          <IconJson />
          <span>Export graph JSON</span>
        </button>
        <button
          type="button"
          className="toolbar__menu-item"
          title="Export the current scene as a PNG image"
          disabled={nodeCount === 0}
          onClick={() => {
            void exportScenePNG().then((ok) => {
              useUiStore
                .getState()
                .pushToast(
                  ok ? 'PNG export started.' : "Couldn't export PNG - no scene canvas found.",
                  ok ? 'info' : 'error',
                );
            });
            onClose?.();
          }}
        >
          <IconImage />
          <span>Export image PNG</span>
        </button>
        <button
          type="button"
          className="toolbar__menu-item"
          title={canImport ? 'Import a graph JSON file' : 'Import is disabled while processing'}
          disabled={!canImport}
          onClick={pickImportFile}
        >
          <IconImport />
          <span>Import graph JSON</span>
        </button>
      </div>

      {pendingFile &&
        createPortal(
          <div className="settings-backdrop" onClick={cancelImport}>
          <div
            ref={dialogRef}
            className="glass-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Replace current graph?"
            style={confirmPanelStyle}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancelImport();
            }}
          >
            <h2 style={confirmTitleStyle}>Replace Current Graph?</h2>
            <p style={confirmTextStyle}>
              Importing <strong>{pendingFile.name}</strong> will replace the current graph in
              this tab. Existing cached documents and snapshots stay on this device.
            </p>
            <div style={confirmRowStyle}>
              <button
                type="button"
                className="snapshot-btn"
                disabled={importing}
                onClick={cancelImport}
              >
                Cancel
              </button>
              <button
                type="button"
                className="snapshot-btn snapshot-btn--load"
                disabled={importing}
                onClick={() => {
                  void runImport(pendingFile);
                }}
              >
                {importing ? 'Importing...' : 'Import graph'}
              </button>
            </div>
          </div>
          </div>,
          document.body,
        )}

      {shareConfirmOpen &&
        createPortal(
          <div className="settings-backdrop" onClick={() => !sharing && setShareConfirmOpen(false)}>
            <div
              ref={dialogRef}
              className="glass-panel"
              role="dialog"
              aria-modal="true"
              aria-label="Copy shareable graph URL?"
              style={confirmPanelStyle}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !sharing) setShareConfirmOpen(false);
              }}
            >
              <h2 style={confirmTitleStyle}>Share This Graph?</h2>
              <p style={confirmTextStyle}>
                The link contains titles, short source excerpts (up to 200 characters), topics,
                entities, keywords, warnings, cluster labels, and connection evidence. It excludes
                full document text, local paths, embeddings, file handles, and settings. Anyone
                with the link can view the included graph metadata.
              </p>
              <div style={confirmRowStyle}>
                <button
                  type="button"
                  className="snapshot-btn"
                  disabled={sharing}
                  onClick={() => setShareConfirmOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="snapshot-btn snapshot-btn--load"
                  disabled={sharing}
                  onClick={() => void copyShareLink()}
                >
                  {sharing ? 'Creating link…' : 'Copy link'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
