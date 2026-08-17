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
import { IconImage, IconImport, IconJson, IconLink, IconUsd } from './icons';

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
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmOpen = pendingFile !== null || shareConfirmOpen;
  useFocusTrap(dialogRef, confirmOpen);
  const canShareNatively =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    onDialogOpenChange?.(confirmOpen);
    return () => {
      if (confirmOpen) onDialogOpenChange?.(false);
    };
  }, [confirmOpen, onDialogOpenChange]);

  useEffect(() => {
    if (!shareConfirmOpen) {
      setShareUrl(null);
      setShareError(null);
      return;
    }
    let cancelled = false;
    setSharing(true);
    setShareUrl(null);
    setShareError(null);
    void createShareUrl(toGraphExport(false))
      .then((url) => {
        if (!cancelled) setShareUrl(url);
      })
      .catch((error: unknown) => {
        if (!cancelled) setShareError(messageFromError(error));
      })
      .finally(() => {
        if (!cancelled) setSharing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shareConfirmOpen]);

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

  const openShareConfirm = () => {
    onDialogOpenChange?.(true);
    setShareConfirmOpen(true);
  };

  const copyShareLink = async () => {
    if (!shareUrl) return;
    setSharing(true);
    try {
      await copyText(shareUrl);
      useUiStore.getState().pushToast('Shareable graph link copied.', 'info');
      setShareConfirmOpen(false);
      onClose?.();
    } catch (error) {
      useUiStore.getState().pushToast(messageFromError(error), 'error');
    } finally {
      setSharing(false);
    }
  };

  const shareNatively = async () => {
    if (!shareUrl || !canShareNatively) return;
    try {
      await navigator.share({
        title: 'Shared document graph',
        url: shareUrl,
      });
      useUiStore.getState().pushToast('Shareable graph link ready.', 'info');
      setShareConfirmOpen(false);
      onClose?.();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      useUiStore.getState().pushToast(messageFromError(error), 'error');
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
          onClick={openShareConfirm}
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
          title="Export the graph as an OpenUSD stage (.usda) for usdview / NVIDIA Omniverse"
          disabled={!canExportGraph}
          onClick={() => {
            void import('../persistence/usdExport')
              .then((m) => m.exportGraphUSD())
              .then(() =>
                useUiStore.getState().pushToast('OpenUSD export started.', 'info'),
              )
              .catch((err: unknown) =>
                useUiStore.getState().pushToast(messageFromError(err), 'error'),
              );
            onClose?.();
          }}
        >
          <IconUsd />
          <span>Export OpenUSD scene</span>
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
                The link contains titles, summaries (up to 2000 characters), topics,
                entities, keywords, warnings, cluster labels, and connection evidence (up to 200 characters). It excludes
                full document text, local paths, embeddings, file handles, and settings. Anyone
                with the link can view the included graph metadata.
              </p>
              {shareError ? (
                <p style={confirmTextStyle} role="alert">
                  {shareError}
                </p>
              ) : (
                <label style={{ ...confirmTextStyle, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  Shareable link
                  <textarea
                    readOnly
                    value={shareUrl ?? ''}
                    placeholder={sharing ? 'Creating link…' : ''}
                    aria-label="Shareable graph URL"
                    rows={3}
                    style={{
                      width: '100%',
                      resize: 'vertical',
                      minHeight: 64,
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
                      background: 'color-mix(in srgb, currentColor 6%, transparent)',
                      color: 'inherit',
                      font: 'inherit',
                      fontSize: 12,
                      lineHeight: 1.4,
                    }}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
              )}
              <div style={confirmRowStyle}>
                <button
                  type="button"
                  className="snapshot-btn"
                  disabled={sharing}
                  onClick={() => setShareConfirmOpen(false)}
                >
                  Cancel
                </button>
                {canShareNatively && (
                  <button
                    type="button"
                    className="snapshot-btn"
                    disabled={sharing || !shareUrl}
                    onClick={() => void shareNatively()}
                  >
                    Share…
                  </button>
                )}
                <button
                  type="button"
                  className="snapshot-btn snapshot-btn--load"
                  disabled={sharing || !shareUrl}
                  onClick={() => void copyShareLink()}
                >
                  {sharing && !shareUrl ? 'Creating link…' : 'Copy link'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
