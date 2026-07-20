import { FOLDER_WATCH_INTERVAL_MS } from '../config';
import { getCorpusRecord, updateCorpusWatch } from '../persistence/corpusRepository';
import type { WatchedFileRecord, WatchedFolderRecord } from '../persistence/db';
import { documentContentId } from '../pipeline/documentId';
import { useCorpusStore } from '../store/corpusStore';
import {
  useFolderWatchStore,
  type FolderWatchStatus,
} from '../store/folderWatchStore';
import { useUiStore } from '../store/uiStore';
import { scanFolder } from './folderScanner';
import { prepareIngestFiles } from './localFiles';

let interval: ReturnType<typeof setInterval> | null = null;
let boundCorpusId: string | null = null;
let activeSync: Promise<number> | null = null;
let rerunRequested = false;

function manifestsEqual(
  left: Record<string, WatchedFileRecord>,
  right: Record<string, WatchedFileRecord>,
): boolean {
  const paths = Object.keys(left);
  if (paths.length !== Object.keys(right).length) return false;
  return paths.every((path) => {
    const a = left[path];
    const b = right[path];
    return Boolean(
      b &&
        a.size === b.size &&
        a.lastModified === b.lastModified &&
        a.docId === b.docId,
    );
  });
}

interface FolderWatchPatch {
  status?: FolderWatchStatus;
  folderName?: string | null;
  lastSyncAt?: number | null;
  lastChangeCount?: number;
  error?: string | null;
}

function setWatchState(patch: FolderWatchPatch): void {
  useFolderWatchStore.getState().setState(patch);
}

function clearTimer(): void {
  if (interval !== null) clearInterval(interval);
  interval = null;
  if (typeof window !== 'undefined') window.removeEventListener('focus', handleWake);
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
}

function handleWake(): void {
  void requestFolderSync().catch(() => undefined);
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') handleWake();
}

function beginMonitoring(corpusId: string, folderName: string): void {
  clearTimer();
  boundCorpusId = corpusId;
  setWatchState({ status: 'watching', folderName, error: null });
  interval = setInterval(() => {
    if (document.visibilityState === 'visible') {
      void requestFolderSync().catch(() => undefined);
    }
  }, FOLDER_WATCH_INTERVAL_MS);
  window.addEventListener('focus', handleWake);
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

async function syncBoundFolder(): Promise<number> {
  const corpusId = boundCorpusId;
  if (!corpusId || useCorpusStore.getState().activeCorpusId !== corpusId) return 0;
  const record = await getCorpusRecord(corpusId);
  const watch = record?.watch;
  if (!watch || watch.paused) return 0;

  const permission = watch.handle.queryPermission
    ? await watch.handle.queryPermission({ mode: 'read' })
    : 'granted';
  if (permission !== 'granted') {
    clearTimer();
    setWatchState({ status: 'reconnect', folderName: watch.rootName, error: null });
    return 0;
  }

  setWatchState({ status: 'checking', folderName: watch.rootName, error: null });
  const scanned = await scanFolder(watch.handle);
  const byPath = new Map(scanned.map((entry) => [entry.path!, entry]));
  const changed = scanned.filter((entry) => {
    const previous = watch.files[entry.path!];
    return !previous || previous.size !== entry.file.size || previous.lastModified !== entry.file.lastModified;
  });
  const changedPaths = new Set(changed.map((entry) => entry.path!));
  const { files: prepared, deferredPaths } = await prepareIngestFiles(changed, {
    deferredWillRetry: true, // the next poll picks up whatever didn't fit
  });
  const preparedByPath = new Map(prepared.map((file) => [file.path!, file]));
  const nextFiles: Record<string, WatchedFileRecord> = {};
  const removeIds = new Set<string>();
  const replacements: { oldId: string; newId: string }[] = [];

  for (const [path, entry] of byPath) {
    const previous = watch.files[path];
    const ingestFile = preparedByPath.get(path);
    if (!ingestFile) {
      // Held back by this batch's total-size cap, not by anything wrong with
      // the file. Keep the prior manifest entry (or none, for a file never
      // seen) so the next scan still sees it as changed and retries it —
      // recording the new size/mtime here would strand it forever.
      if (deferredPaths.has(path)) {
        if (previous) nextFiles[path] = previous;
        continue;
      }
      // A changed file that is now over an ingest limit must not leave the
      // prior revision displayed as though it still matched the folder.
      if (changedPaths.has(path) && previous?.docId) removeIds.add(previous.docId);
      nextFiles[path] = {
        size: entry.file.size,
        lastModified: entry.file.lastModified,
        docId: changedPaths.has(path) ? '' : previous?.docId ?? '',
      };
      continue;
    }
    const docId = await documentContentId(path, ingestFile.bytes);
    nextFiles[path] = {
      size: entry.file.size,
      lastModified: entry.file.lastModified,
      docId,
    };
    if (previous?.docId && previous.docId !== docId) {
      replacements.push({ oldId: previous.docId, newId: docId });
    }
  }

  for (const [path, previous] of Object.entries(watch.files)) {
    if (!byPath.has(path) && previous.docId) removeIds.add(previous.docId);
  }

  const files = prepared.filter((file) => nextFiles[file.path!]?.docId);
  const expectedIds = files.map((file) => nextFiles[file.path!]!.docId);
  let acceptedIds = expectedIds;
  if (files.length > 0 || removeIds.size > 0) {
    const { reconcileWatchedFiles } = await import('../pipeline/coordinatorLazy');
    acceptedIds = await reconcileWatchedFiles(
      files,
      [...removeIds],
      replacements,
      expectedIds,
    );
  }

  // Parse/node-limit failures are reported by the ingestion pipeline without
  // rejecting the entire batch. Keep the prior manifest revision (or no entry
  // for a brand-new file) so the next scan retries instead of deleting the
  // last good node and treating the failed replacement as current.
  const accepted = new Set(acceptedIds);
  for (const entry of changed) {
    const path = entry.path!;
    const candidate = nextFiles[path];
    if (!candidate?.docId || accepted.has(candidate.docId)) continue;
    const previous = watch.files[path];
    if (previous) nextFiles[path] = previous;
    else delete nextFiles[path];
  }

  const nextWatch: WatchedFolderRecord = { ...watch, files: nextFiles, paused: false };
  if (watch.paused || !manifestsEqual(watch.files, nextFiles)) {
    await updateCorpusWatch(corpusId, nextWatch);
  }
  const replacedCount = replacements.filter(({ newId }) => accepted.has(newId)).length;
  const changeCount = accepted.size + removeIds.size + replacedCount;
  setWatchState({
    status: 'watching',
    folderName: watch.rootName,
    lastSyncAt: Date.now(),
    lastChangeCount: changeCount,
    error: null,
  });
  if (changeCount > 0) {
    useUiStore
      .getState()
      .pushToast(
        `Folder synced — ${changeCount} ${changeCount === 1 ? 'change' : 'changes'} indexed.`,
        'info',
      );
  }
  return changeCount;
}

export function requestFolderSync(): Promise<number> {
  if (activeSync) {
    rerunRequested = true;
    return activeSync;
  }
  activeSync = syncBoundFolder()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setWatchState({ status: 'error', error: message });
      throw error;
    })
    .finally(() => {
      activeSync = null;
      if (rerunRequested) {
        rerunRequested = false;
        void requestFolderSync().catch(() => undefined);
      }
    });
  return activeSync;
}

export async function suspendFolderWatcher(): Promise<void> {
  clearTimer();
  boundCorpusId = null;
  rerunRequested = false;
  if (activeSync) await activeSync.catch(() => 0);
}

export function folderWatchingSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/**
 * Re-arms watching for whichever corpus is now active. Resolves once the watch
 * STATE is published and monitoring is re-armed — the catch-up scan is kicked
 * off but deliberately not awaited, because that scan reaches
 * `reconcileWatchedFiles`, which enqueues onto the same FIFO run queue. Awaiting
 * it from inside an `enqueueRun` callback (corpus switch, delete, snapshot
 * restore) would wait on a run that cannot start until the current one ends:
 * a permanent deadlock. Fire-and-forget keeps this function safe to call from
 * inside the queue; the diff lands as a normal queued run right afterwards.
 *
 * Invariant for queued callers: suspend the watcher BEFORE entering the queue
 * (every current caller does), so the `suspendFolderWatcher` drain below can
 * never await a sync that is itself waiting on the queue.
 */
export async function bindFolderWatcherToActiveCorpus(): Promise<void> {
  await suspendFolderWatcher();
  const corpusId = useCorpusStore.getState().activeCorpusId;
  if (!corpusId) {
    setWatchState({ status: 'idle', folderName: null, error: null });
    return;
  }
  const record = await getCorpusRecord(corpusId);
  const watch = record?.watch;
  if (!watch) {
    setWatchState({ status: folderWatchingSupported() ? 'idle' : 'unsupported', folderName: null });
    return;
  }
  if (watch.paused) {
    setWatchState({ status: 'paused', folderName: watch.rootName, error: null });
    return;
  }
  const permission = watch.handle.queryPermission
    ? await watch.handle.queryPermission({ mode: 'read' })
    : 'prompt';
  if (permission !== 'granted') {
    setWatchState({ status: 'reconnect', folderName: watch.rootName, error: null });
    return;
  }
  beginMonitoring(corpusId, watch.rootName);
  void requestFolderSync().catch(() => undefined);
}

export async function chooseFolderToWatch(): Promise<void> {
  if (!folderWatchingSupported()) {
    setWatchState({ status: 'unsupported' });
    throw new Error('Folder watching is not supported in this browser. You can still drag in a folder once.');
  }
  const corpusId = useCorpusStore.getState().activeCorpusId;
  if (!corpusId) throw new Error('Create a local corpus before watching a folder.');
  const handle = await window.showDirectoryPicker!({ id: 'knowledge-nebula-source', mode: 'read' });
  // Drain AFTER the picker, never before: showDirectoryPicker needs the user
  // activation from this click, and awaiting a scan first can outlive it. An
  // in-flight sync captured the OLD watch record and finishes by writing
  // `{...oldWatch, files, paused:false}` — draining here forces that write to
  // land before the new handle is stored, instead of clobbering it afterwards.
  await suspendFolderWatcher();
  const watch: WatchedFolderRecord = {
    handle,
    rootName: handle.name,
    files: {},
    paused: false,
  };
  await updateCorpusWatch(corpusId, watch);
  beginMonitoring(corpusId, handle.name);
  await requestFolderSync();
}

export async function reconnectFolderWatcher(): Promise<void> {
  const corpusId = useCorpusStore.getState().activeCorpusId;
  if (!corpusId) return;
  const record = await getCorpusRecord(corpusId);
  const watch = record?.watch;
  if (!watch) return;
  const permission = watch.handle.requestPermission
    ? await watch.handle.requestPermission({ mode: 'read' })
    : 'denied';
  if (permission !== 'granted') {
    setWatchState({ status: 'reconnect', folderName: watch.rootName });
    return;
  }
  watch.paused = false;
  await updateCorpusWatch(corpusId, watch);
  beginMonitoring(corpusId, watch.rootName);
  await requestFolderSync();
}

export async function pauseFolderWatcher(): Promise<void> {
  const corpusId = useCorpusStore.getState().activeCorpusId;
  if (!corpusId) return;
  // Drain any in-flight scan first; otherwise its stale paused=false record
  // can land after this write and silently resume the source on next launch.
  await suspendFolderWatcher();
  const record = await getCorpusRecord(corpusId);
  if (!record?.watch) return;
  record.watch.paused = true;
  await updateCorpusWatch(corpusId, record.watch);
  setWatchState({ status: 'paused', folderName: record.watch.rootName });
}

export async function forgetFolderWatcher(): Promise<void> {
  const corpusId = useCorpusStore.getState().activeCorpusId;
  if (!corpusId) return;
  await suspendFolderWatcher();
  await updateCorpusWatch(corpusId, undefined);
  setWatchState({ status: 'idle', folderName: null, lastSyncAt: null, lastChangeCount: 0 });
}
