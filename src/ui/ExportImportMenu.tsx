import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  exportGraphJSON,
  exportScenePNG,
  importGraphJSONFile,
} from '../persistence/exportImport';
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

function messageFromError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function importGraphJsonFileWithToast(file: File): Promise<boolean> {
  try {
    const { nodes, edges } = await importGraphJSONFile(file);
    useUiStore
      .getState()
      .pushToast(
        `Imported ${plural(nodes.length, 'document')} and ${plural(edges.length, 'connection')}.`,
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmOpen = pendingFile !== null;
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

  return (
    <>
      <div className="toolbar__menu glass-panel">
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

      {pendingFile && (
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
        </div>
      )}
    </>
  );
}
