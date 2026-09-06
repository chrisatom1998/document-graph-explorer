/**
 * The async half of the one-shot "Add folder" ingest: awaiting the picked
 * directory, scanning it, and routing the result into the shared ingest
 * path. Split from folderPicker.ts so the eager entry chunk only carries the
 * synchronous picker opening (scripts/check-bundle.mjs budget) while this
 * module — and the scanner it demand-loads — arrive while the picker is open.
 */

import { useUiStore } from '../store/uiStore';
import type { NamedFile } from './localFiles';
import { reportReadFailures, type ReadFailure } from './readFailures';

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

/** Preferred path: scan and ingest the directory picked via showDirectoryPicker. */
export async function ingestPickedDirectory(
  picked: Promise<FileSystemDirectoryHandle>,
): Promise<void> {
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await picked;
  } catch (error) {
    // Cancelling / escaping the picker rejects with AbortError — a no-op.
    if (error instanceof DOMException && error.name === 'AbortError') return;
    console.warn('folder picker failed', error);
    useUiStore.getState().pushToast("Couldn't open that folder — check the console for details.");
    return;
  }
  try {
    const { scanFolder } = await import('./folderScanner');
    const failures: ReadFailure[] = [];
    const named = await scanFolder(handle, (failure) => failures.push(failure));
    await reportReadFailures(failures);
    if (named.length > 0 || failures.length === 0) await ingestScannedFolder(named, handle.name);
  } catch (error) {
    console.error('folder scan failed', error);
    useUiStore
      .getState()
      .pushToast("Something went wrong reading that folder — check the console for details.");
  }
}

/** Fallback path: run a flat <input webkitdirectory> selection through the scan filters. */
export async function ingestPickedFolderFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  try {
    const { scanPickedFolderFiles } = await import('./folderScanner');
    const failures: ReadFailure[] = [];
    const named = await scanPickedFolderFiles(files, (failure) => failures.push(failure));
    await reportReadFailures(failures);
    const rootName = files[0].webkitRelativePath.split('/')[0] || files[0].name;
    if (named.length > 0 || failures.length === 0) await ingestScannedFolder(named, rootName);
  } catch (error) {
    console.error('folder scan failed', error);
    useUiStore
      .getState()
      .pushToast("Something went wrong reading that folder — check the console for details.");
  }
}
