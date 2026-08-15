import { useEffect, useRef, useState } from 'react';
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
            className="glass-panel confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Replace current graph?"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancelImport();
            }}
          >
            <h2 className="confirm-dialog__title">Replace Current Graph?</h2>
            <p className="confirm-dialog__text">
              Importing <strong>{pendingFile.name}</strong> will replace the current graph in
              this tab. Existing cached documents and snapshots stay on this device.
            </p>
            <div className="confirm-dialog__row">
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
              className="glass-panel confirm-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Copy shareable graph URL?"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !sharing) setShareConfirmOpen(false);
              }}
            >
              <h2 className="confirm-dialog__title">Share This Graph?</h2>
              <p className="confirm-dialog__text">
                The link contains titles, summaries (up to 2000 characters), topics,
                entities, keywords, warnings, cluster labels, and connection evidence (up to 200 characters). It excludes
                full document text, local paths, embeddings, file handles, and settings. Anyone
                with the link can view the included graph metadata.
              </p>
              <div className="confirm-dialog__row">
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
