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
 * The scanner and ingest modules are imported on demand: this module is on
 * the eager Toolbar/EmptyState path, and the entry chunk has a strictly
 * enforced size budget (scripts/check-bundle.mjs). The picker itself still
 * opens synchronously with the click, preserving the user activation
 * showDirectoryPicker requires.
 */

import { useUiStore } from '../store/uiStore';
import type { NamedFile } from './localFiles';

function directoryPickerSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

async function ingestScannedFolder(named: NamedFile[], folderName: string): Promise<void> {
  if (named.length === 0) {
    useUiStore
      .getState()
      .pushToast(`No supported files found in “${folderName}” — nothing was added.`, 'info');
    return;
  }
  const { ingestNamedFiles } = await import('./localFiles');
  await ingestNamedFiles(named);
}

async function pickAndIngestFolder(): Promise<void> {
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker!({
      id: 'knowledge-nebula-add-folder',
      mode: 'read',
    });
  } catch (error) {
    // Cancelling / escaping the picker rejects with AbortError — a no-op.
    if (error instanceof DOMException && error.name === 'AbortError') return;
    console.warn('folder picker failed', error);
    useUiStore.getState().pushToast("Couldn't open that folder — check the console for details.");
    return;
  }
  try {
    const { scanFolder } = await import('./folderScanner');
    await ingestScannedFolder(await scanFolder(handle), handle.name);
  } catch (error) {
    console.error('folder scan failed', error);
    useUiStore
      .getState()
      .pushToast("Something went wrong reading that folder — check the console for details.");
  }
}

// ---------------------------------------------------------------------------
// fallback: hidden <input webkitdirectory> (Firefox, older Safari)
// ---------------------------------------------------------------------------

let fallbackInput: HTMLInputElement | null = null;

async function ingestPickedFolderFiles(files: File[]): Promise<void> {
  try {
    const { scanPickedFolderFiles } = await import('./folderScanner');
    const named = await scanPickedFolderFiles(files);
    const rootName = files[0].webkitRelativePath.split('/')[0] || files[0].name;
    await ingestScannedFolder(named, rootName);
  } catch (error) {
    console.error('folder scan failed', error);
    useUiStore
      .getState()
      .pushToast("Something went wrong reading that folder — check the console for details.");
  }
}

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
      if (files.length > 0) void ingestPickedFolderFiles(files);
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
  if (directoryPickerSupported()) {
    void pickAndIngestFolder();
    return;
  }
  openFallbackFolderInput();
}
