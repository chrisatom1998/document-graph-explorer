/** One-time folder uploads use the standard directory file input, including in
 * embedded browsers that expose showDirectoryPicker but cannot open it.
 * Persistent folder watching keeps its separate File System Access flow.
 * Open synchronously during the user click; load scanning code afterward.
 */

import { useUiStore } from '../store/uiStore';
import { rememberAddOrigin } from '../scene/ingestGesture';
import { holdReload, recoverFromChunkError } from '../util/staleBuild';

function toastIngestLoadFailure(error: unknown): void {
  console.warn('folder ingest failed to load', error);
  if (recoverFromChunkError(error)) return;
  useUiStore.getState().pushToast("Couldn't open the folder picker.");
}

// ---------------------------------------------------------------------------
// Standard directory upload control; no persistent filesystem permission.
// ---------------------------------------------------------------------------

let folderInput: HTMLInputElement | null = null;

function openFolderInput(): void {
  if (typeof document === 'undefined') return;
  if (!folderInput?.isConnected) {
    folderInput = document.createElement('input');
    folderInput.type = 'file';
    folderInput.multiple = true;
    folderInput.setAttribute('aria-label', 'Choose a folder to import');
    // Select a directory and enumerate its files recursively.
    folderInput.setAttribute('webkitdirectory', '');
    folderInput.style.display = 'none';
    folderInput.addEventListener('change', () => {
      const files = folderInput?.files ? Array.from(folderInput.files) : [];
      if (folderInput) folderInput.value = ''; // allow re-picking the same folder
      // An empty change (or no change event at all, on cancel) is a no-op.
      if (files.length === 0) return;
      // Protect the selection before loading the module that starts ingestion.
      const release = holdReload();
      import('./folderIngest')
        .then(({ ingestPickedFolderFiles }) => ingestPickedFolderFiles(files))
        .catch(toastIngestLoadFailure)
        .finally(release);
    });
    document.body.appendChild(folderInput);
  }
  folderInput.click();
}

/**
 * The UI's "Add folder" action (EmptyState / Toolbar). Fire-and-forget by
 * design, matching openFilePicker: progress and errors surface through the
 * pipeline's own progress strip and toasts.
 */
export function openFolderPicker(): void {
  rememberAddOrigin();
  openFolderInput();
}
