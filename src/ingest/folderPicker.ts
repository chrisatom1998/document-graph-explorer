/**
 * One-shot "Add folder" ingest (Google Drive-style): pick a directory once
 * and every relevant file inside it — subfolders included — is ingested,
 * with the same relevance filters as dropping a folder (gitignore, ignored
 * dirs, lockfiles, dotfiles, size caps, ignored-tray routing).
 *
 * Preferred path: window.showDirectoryPicker() → scanFolder(). Browsers
 * without the File System Access API get a hidden
 * `<input type="file" webkitdirectory>` — still a single folder pick, still
 * recursive — whose flat file list runs through the same scan filters via
 * scanPickedFolderFiles(). Cancelling either picker is a no-op.
 *
 * Deliberately NOT a live "watch this folder" source — that already exists
 * in the corpus switcher (folderWatcher.ts). This is a one-time import.
 *
 * This module is imported eagerly by Toolbar/EmptyState so the picker opens
 * synchronously with the click, inside the user activation window
 * showDirectoryPicker and input.click() require. Everything downstream —
 * folderIngest.ts and the scanner it pulls in — is imported on demand while
 * the picker is open, keeping the entry chunk within its strictly enforced
 * size budget (scripts/check-bundle.mjs).
 */

import { useUiStore } from '../store/uiStore';
import { rememberAddOrigin } from '../scene/ingestGesture';

function directoryPickerSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function toastIngestLoadFailure(error: unknown): void {
  console.warn('folder ingest failed to load', error);
  useUiStore.getState().pushToast("Couldn't open the folder picker.");
}

// ---------------------------------------------------------------------------
// fallback: hidden <input webkitdirectory> (Firefox, older Safari)
// ---------------------------------------------------------------------------

let fallbackInput: HTMLInputElement | null = null;

function openFallbackFolderInput(): void {
  if (typeof document === 'undefined') return;
  if (!fallbackInput) {
    fallbackInput = document.createElement('input');
    fallbackInput.type = 'file';
    // Non-standard but supported by every engine that lacks
    // showDirectoryPicker; makes the picker select a directory and enumerate
    // its files recursively.
    fallbackInput.setAttribute('webkitdirectory', '');
    fallbackInput.style.display = 'none';
    fallbackInput.addEventListener('change', () => {
      const files = fallbackInput?.files ? Array.from(fallbackInput.files) : [];
      if (fallbackInput) fallbackInput.value = ''; // allow re-picking the same folder
      // An empty change (or no change event at all, on cancel) is a no-op.
      if (files.length === 0) return;
      import('./folderIngest')
        .then(({ ingestPickedFolderFiles }) => ingestPickedFolderFiles(files))
        .catch(toastIngestLoadFailure);
    });
    document.body.appendChild(fallbackInput);
  }
  fallbackInput.click();
}

/**
 * The UI's "Add folder" action (EmptyState / Toolbar). Fire-and-forget by
 * design, matching openFilePicker: progress and errors surface through the
 * pipeline's own progress strip and toasts.
 */
export function openFolderPicker(): void {
  rememberAddOrigin();
  if (directoryPickerSupported()) {
    // Open the picker synchronously; the ingest chunk loads while it's up.
    const picked = window.showDirectoryPicker!({
      id: 'knowledge-nebula-add-folder',
      mode: 'read',
    });
    import('./folderIngest')
      .then(({ ingestPickedDirectory }) => ingestPickedDirectory(picked))
      .catch(toastIngestLoadFailure);
    // If the user cancels before the ingest chunk arrives, the rejection has
    // no handler attached yet — swallow it here; ingestPickedDirectory still
    // observes it (as a no-op AbortError) once the import resolves.
    picked.catch(() => {});
    return;
  }
  openFallbackFolderInput();
}
