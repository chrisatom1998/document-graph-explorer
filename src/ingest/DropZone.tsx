/**
 * Full-window drag-and-drop overlay (spec §4.1). Appears on window
 * dragenter, hides on dragleave/drop. Handles single files AND folders
 * (recursive webkitGetAsEntry walk, skipping IGNORED_DIRS and dotfiles),
 * reads bytes, and hands IngestFile[] to the pipeline coordinator.
 *
 * Also exports openFilePicker() — the hidden multi-select input flow used
 * by the UI's EmptyState/Toolbar "Add files" button.
 *
 * Styling contract: the UI subsystem owns styles.css and styles the
 * `dropzone-overlay` / `dropzone-overlay visible` / `dropzone-card`
 * class names.
 */

import { useEffect, useRef, useState } from 'react';
import { IGNORED_DIRS, MAX_INGEST_FILE_BYTES, MAX_INGEST_TOTAL_BYTES } from '../config';
import type { IngestFile } from '../model/types';
import { ingestFiles } from '../pipeline/coordinator';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { routeFile } from './fileRouter';

interface NamedFile {
  file: File;
  /** relative path for folder drops; undefined for top-level files */
  path?: string;
}

// ---------------------------------------------------------------------------
// directory walking (webkitGetAsEntry API is callback-based; promisify it)
// ---------------------------------------------------------------------------

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function isIgnoredDir(name: string): boolean {
  return IGNORED_DIRS.has(name) || IGNORED_DIRS.has(name.toLowerCase());
}

async function walkEntry(entry: FileSystemEntry, depth: number, out: NamedFile[]): Promise<void> {
  if (entry.name.startsWith('.')) return; // dotfiles and dot-directories
  if (entry.isDirectory) {
    if (isIgnoredDir(entry.name)) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns batches (~100); keep reading until empty
    for (;;) {
      const batch = await readAllEntries(reader);
      if (batch.length === 0) break;
      for (const child of batch) await walkEntry(child, depth + 1, out);
    }
  } else if (entry.isFile) {
    const file = await entryFile(entry as FileSystemFileEntry);
    const relPath = entry.fullPath.replace(/^\/+/, '');
    out.push({ file, path: depth > 0 ? relPath : undefined });
  }
}

/**
 * NOTE: entries must be captured synchronously — DataTransferItemList is
 * invalidated once the drop handler yields. This function's item loop runs
 * before any await.
 */
function filesFromDataTransfer(dt: DataTransfer): Promise<NamedFile[]> {
  const entries: FileSystemEntry[] = [];
  const directFiles: File[] = [];
  if (dt.items && dt.items.length > 0) {
    for (let i = 0; i < dt.items.length; i += 1) {
      const item = dt.items[i];
      if (item.kind !== 'file') continue;
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      if (entry) entries.push(entry);
      else {
        const file = item.getAsFile();
        if (file) directFiles.push(file);
      }
    }
  } else {
    for (const file of Array.from(dt.files)) directFiles.push(file);
  }

  return (async () => {
    const out: NamedFile[] = [];
    for (const entry of entries) await walkEntry(entry, 0, out);
    for (const file of directFiles) {
      if (!file.name.startsWith('.')) out.push({ file });
    }
    return out;
  })();
}

// ---------------------------------------------------------------------------
// IngestFile construction
// ---------------------------------------------------------------------------

const MAX_INGEST_MB = Math.round(MAX_INGEST_FILE_BYTES / (1024 * 1024));
const MAX_INGEST_TOTAL_MB = Math.round(MAX_INGEST_TOTAL_BYTES / (1024 * 1024));

async function toIngestFiles(named: NamedFile[]): Promise<IngestFile[]> {
  const out: IngestFile[] = [];
  let totalBytes = 0;
  let totalCapHit = false;
  for (const { file, path } of named) {
    const fileType = routeFile(file.name);
    if (fileType !== null && file.size > MAX_INGEST_FILE_BYTES) {
      useGraphStore.getState().addIgnored(file.name, `too large (over ${MAX_INGEST_MB} MB)`);
      continue;
    }
    // Every file is read fully into memory before the pipeline runs, so the
    // per-file cap alone can't stop a huge folder drop from OOMing the tab.
    if (fileType !== null && totalBytes + file.size > MAX_INGEST_TOTAL_BYTES) {
      useGraphStore
        .getState()
        .addIgnored(file.name, `drop exceeds ${MAX_INGEST_TOTAL_MB} MB total — add it separately`);
      if (!totalCapHit) {
        totalCapHit = true;
        useUiStore
          .getState()
          .pushToast(
            `That drop is over the ${MAX_INGEST_TOTAL_MB} MB total limit — the remainder was skipped (see the ignored list).`,
            'warning',
          );
      }
      continue;
    }
    // Unsupported files are still forwarded (with empty bytes, so huge
    // binaries are never read) — the coordinator routes them by name into
    // the ignored tray.
    const bytes = fileType !== null ? await file.arrayBuffer() : new ArrayBuffer(0);
    totalBytes += bytes.byteLength;
    out.push({
      fileId: crypto.randomUUID(),
      name: file.name,
      path,
      fileType: fileType ?? 'other',
      bytes,
      lastModified: file.lastModified > 0 ? file.lastModified : undefined,
    });
  }
  return out;
}

async function ingestNamedFiles(named: NamedFile[]): Promise<void> {
  try {
    const files = await toIngestFiles(named);
    if (files.length > 0) await ingestFiles(files);
  } catch (err) {
    console.error('ingestion failed', err);
    useUiStore.getState().pushToast("Something went wrong adding those files — check the console for details.");
  }
}

// ---------------------------------------------------------------------------
// hidden file picker (imported by the UI's EmptyState / Toolbar)
// ---------------------------------------------------------------------------

let pickerInput: HTMLInputElement | null = null;

export function openFilePicker(): void {
  if (typeof document === 'undefined') return;
  if (!pickerInput) {
    pickerInput = document.createElement('input');
    pickerInput.type = 'file';
    pickerInput.multiple = true;
    pickerInput.style.display = 'none';
    pickerInput.addEventListener('change', () => {
      const files = pickerInput?.files ? Array.from(pickerInput.files) : [];
      if (pickerInput) pickerInput.value = ''; // allow re-picking the same files
      if (files.length > 0) {
        void ingestNamedFiles(files.map((file) => ({ file })));
      }
    });
    document.body.appendChild(pickerInput);
  }
  pickerInput.click();
}

// ---------------------------------------------------------------------------
// overlay component
// ---------------------------------------------------------------------------

function dragHasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
}

export function DropZone() {
  const [visible, setVisible] = useState(false);
  const depthRef = useRef(0);

  useEffect(() => {
    const onDragEnter = (e: DragEvent): void => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      depthRef.current += 1;
      setVisible(true);
    };
    const onDragOver = (e: DragEvent): void => {
      if (!dragHasFiles(e)) return;
      e.preventDefault(); // required so the drop event fires
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (e: DragEvent): void => {
      if (!dragHasFiles(e)) return;
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setVisible(false);
    };
    const onDrop = (e: DragEvent): void => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      depthRef.current = 0;
      setVisible(false);
      const dt = e.dataTransfer;
      if (!dt) return;
      // filesFromDataTransfer captures entries synchronously, then walks async
      void filesFromDataTransfer(dt).then(ingestNamedFiles);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div
      className={visible ? 'dropzone-overlay visible' : 'dropzone-overlay'}
      aria-hidden={!visible}
    >
      <div className="dropzone-card">Drop to add to your nebula</div>
    </div>
  );
}

export default DropZone;
