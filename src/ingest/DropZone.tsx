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
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { posixJoin } from '../util/posixPath';
import { isIngestCandidate, routeFileWithSniff } from './fileRouter';
import { hasUnignoreUnder, mergeGitIgnoreRules, pathIsGitIgnored, type GitIgnoreRule } from './gitignore';
import type { NamedFile } from './localFiles';
import { rememberAddOrigin, rememberDropOrigin } from '../scene/ingestGesture';

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

async function readDirectoryEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const entries: FileSystemEntry[] = [];
  for (;;) {
    const batch = await readAllEntries(reader);
    if (batch.length === 0) break;
    entries.push(...batch);
  }
  return entries;
}

async function readGitignoreText(entries: FileSystemEntry[]): Promise<string | null> {
  const hit = entries.find((entry) => entry.isFile && entry.name === '.gitignore');
  if (!hit) return null;
  try {
    return await (await entryFile(hit as FileSystemFileEntry)).text();
  } catch {
    return null;
  }
}

async function walkDirectory(
  dir: FileSystemDirectoryEntry,
  rootName: string,
  repoRel: string,
  depth: number,
  ancestorRules: GitIgnoreRule[],
  out: NamedFile[],
): Promise<void> {
  // Ignored-dir skipping for descendants happens at the call site (gated on
  // hasUnignoreUnder); this only covers the directly-dropped root itself.
  if ((depth === 0 && isIgnoredDir(dir.name)) || (dir.name.startsWith('.') && dir.name !== rootName)) return;
  const children = await readDirectoryEntries(dir);
  const rules = mergeGitIgnoreRules(ancestorRules, await readGitignoreText(children), repoRel);
  for (const child of children) {
    if (child.name === '.gitignore') continue;
    if (child.name.startsWith('.')) continue;
    const childRel = repoRel ? posixJoin(repoRel, child.name) : child.name;
    if (child.isDirectory) {
      // A default-ignored dir (node_modules, dist, …) is only worth walking
      // when a gitignore negation might reach inside it; otherwise skip it
      // outright rather than enumerating a huge vendor tree.
      if (isIgnoredDir(child.name) && !hasUnignoreUnder(childRel, rules)) continue;
      if (pathIsGitIgnored(childRel, true, rules)) continue;
      await walkDirectory(child as FileSystemDirectoryEntry, rootName, childRel, depth + 1, rules, out);
      continue;
    }
    if (!child.isFile) continue;
    if (!isIngestCandidate(child.name)) continue;
    if (pathIsGitIgnored(childRel, false, rules)) continue;
    const file = await entryFile(child as FileSystemFileEntry);
    const relPath = child.fullPath.replace(/^\/+/, '');
    out.push({ file, path: depth >= 0 ? relPath : undefined });
  }
}

async function walkEntry(entry: FileSystemEntry, depth: number, out: NamedFile[]): Promise<void> {
  if (entry.isDirectory) {
    await walkDirectory(entry as FileSystemDirectoryEntry, entry.name, '', depth, [], out);
    return;
  }
  if (entry.name.startsWith('.')) return;
  if (entry.isFile) {
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
    const shouldRead = isIngestCandidate(file.name);
    if (shouldRead && file.size > MAX_INGEST_FILE_BYTES) {
      useGraphStore.getState().addIgnored(file.name, `too large (over ${MAX_INGEST_MB} MB)`);
      continue;
    }
    // Every file is read fully into memory before the pipeline runs, so the
    // per-file cap alone can't stop a huge folder drop from OOMing the tab.
    if (shouldRead && totalBytes + file.size > MAX_INGEST_TOTAL_BYTES) {
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
    // the ignored tray. Sniffable unknowns (LICENSE, *.rules) are read so
    // the text-fallback can run.
    const bytes = shouldRead ? await file.arrayBuffer() : new ArrayBuffer(0);
    const fileType = routeFileWithSniff(file.name, bytes);
    totalBytes += fileType !== null ? bytes.byteLength : 0;
    out.push({
      fileId: crypto.randomUUID(),
      name: file.name,
      path,
      fileType: fileType ?? 'other',
      bytes: fileType !== null ? bytes : new ArrayBuffer(0),
      lastModified: file.lastModified > 0 ? file.lastModified : undefined,
    });
  }
  return out;
}

async function ingestNamedFiles(named: NamedFile[]): Promise<void> {
  try {
    const files = await toIngestFiles(named);
    if (files.length > 0) {
      const { ingestFiles } = await import('../pipeline/coordinatorLazy');
      await ingestFiles(files);
    } else {
      // Every file was rejected by size gating — no run will settle, so
      // snapshot the rejections into the persistent report here.
      const { publishIngestReport } = await import('../pipeline/ingestReport');
      publishIngestReport();
    }
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
  rememberAddOrigin();
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
      rememberDropOrigin(e.clientX, e.clientY);
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
