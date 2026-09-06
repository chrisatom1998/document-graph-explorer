// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repository = vi.hoisted(() => ({
  getCorpusRecord: vi.fn(),
  updateCorpusWatch: vi.fn().mockResolvedValue(undefined),
  updateCorpusIngestReport: vi.fn().mockResolvedValue(undefined),
}));
const scanner = vi.hoisted(() => ({ scanFolder: vi.fn() }));
const localFiles = vi.hoisted(() => ({ prepareIngestFiles: vi.fn() }));
const coordinator = vi.hoisted(() => ({ reconcileWatchedFiles: vi.fn() }));

vi.mock('../persistence/corpusRepository', () => repository);
vi.mock('./folderScanner', () => scanner);
vi.mock('./localFiles', () => localFiles);
vi.mock('../pipeline/coordinatorLazy', () => coordinator);
vi.mock('../pipeline/documentId', () => ({
  documentContentId: vi.fn(async (path: string) => `doc:${path}`),
}));

import { bindFolderWatcherToActiveCorpus, suspendFolderWatcher } from './folderWatcher';
import { enqueueRun } from '../pipeline/runQueue';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';
import type { ReadFailure } from './readFailures';

const CORPUS_ID = 'corpus-1';

/** A watch record whose folder has one file the manifest has never seen. */
function watchRecordWithPendingChange() {
  return {
    id: CORPUS_ID,
    watch: {
      handle: {
        name: 'vault',
        queryPermission: vi.fn().mockResolvedValue('granted'),
      } as unknown as FileSystemDirectoryHandle,
      rootName: 'vault',
      files: {},
      paused: false,
    },
  };
}

function scannedFile(path: string) {
  return {
    path,
    file: { name: path, size: 10, lastModified: 1 } as File,
  };
}

beforeEach(() => {
  useGraphStore.getState().reset();
  useCorpusStore.setState({ activeCorpusId: CORPUS_ID, mode: 'local' });
  repository.getCorpusRecord.mockResolvedValue(watchRecordWithPendingChange());
  scanner.scanFolder.mockResolvedValue([scannedFile('notes.md')]);
  localFiles.prepareIngestFiles.mockResolvedValue({
    files: [{ path: 'notes.md', name: 'notes.md', bytes: new ArrayBuffer(4) }],
    deferredPaths: new Set<string>(),
  });
});

afterEach(async () => {
  await suspendFolderWatcher();
  vi.clearAllMocks();
});

describe('bindFolderWatcherToActiveCorpus inside the run queue', () => {
  it('does not deadlock when the catch-up sync needs the queue it is already inside', async () => {
    const order: string[] = [];
    // The real shape of the deadlock: reconciling watched files is itself a
    // queued run, so a bind that awaited it from inside a queued run could
    // never finish.
    coordinator.reconcileWatchedFiles.mockImplementation(() =>
      enqueueRun(async () => {
        order.push('reconcile');
        return ['doc:notes.md'];
      }),
    );

    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const switchRun = enqueueRun(async () => {
        await bindFolderWatcherToActiveCorpus();
        order.push('switch-complete');
      });

      const outcomePromise = Promise.race([
        switchRun.then(() => 'resolved' as const),
        new Promise<'deadlocked'>((resolve) => {
          setTimeout(() => resolve('deadlocked'), 500);
        }),
      ]);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(500);

      expect(await outcomePromise).toBe('resolved');
      expect(order).toContain('switch-complete');
    } finally {
      vi.useRealTimers();
    }
  });

  it('still performs the catch-up reconcile, just after the queued run finishes', async () => {
    const order: string[] = [];
    let reconciled: () => void;
    const reconcileHappened = new Promise<void>((resolve) => {
      reconciled = resolve;
    });
    coordinator.reconcileWatchedFiles.mockImplementation(() =>
      enqueueRun(async () => {
        order.push('reconcile');
        reconciled();
        return ['doc:notes.md'];
      }),
    );

    await enqueueRun(async () => {
      await bindFolderWatcherToActiveCorpus();
      order.push('switch-complete');
    });

    await reconcileHappened;
    expect(order).toEqual(['switch-complete', 'reconcile']);
  });
});

describe('files deferred by the batch size cap', () => {
  beforeEach(() => {
    coordinator.reconcileWatchedFiles.mockResolvedValue([]);
  });

  /** The manifest the watcher persisted at the end of the sync, if any. */
  function persistedManifest(): Record<string, unknown> | undefined {
    const lastCall = repository.updateCorpusWatch.mock.calls.at(-1);
    return lastCall?.[1]?.files;
  }

  it('leaves a never-seen deferred file out of the manifest so the next scan retries it', async () => {
    localFiles.prepareIngestFiles.mockResolvedValue({
      files: [],
      deferredPaths: new Set(['notes.md']),
    });

    await bindFolderWatcherToActiveCorpus();
    await vi.waitFor(() => expect(scanner.scanFolder).toHaveBeenCalled());

    // No entry at all: the next scan compares against nothing, sees the file
    // as new, and prepares it again.
    expect(persistedManifest()?.['notes.md']).toBeUndefined();
  });

  it('keeps the prior revision of a deferred file rather than recording its new mtime', async () => {
    const previous = { size: 10, lastModified: 1, docId: 'doc:notes.md' };
    repository.getCorpusRecord.mockResolvedValue({
      id: CORPUS_ID,
      watch: {
        ...watchRecordWithPendingChange().watch,
        files: { 'notes.md': previous },
      },
    });
    // Same path, newer mtime — a real edit that this batch had no room for.
    scanner.scanFolder.mockResolvedValue([
      { path: 'notes.md', file: { name: 'notes.md', size: 999, lastModified: 42 } as File },
    ]);
    localFiles.prepareIngestFiles.mockResolvedValue({
      files: [],
      deferredPaths: new Set(['notes.md']),
    });

    await bindFolderWatcherToActiveCorpus();
    await vi.waitFor(() => expect(scanner.scanFolder).toHaveBeenCalled());

    // Recording lastModified: 42 here would make the next scan consider the
    // file unchanged and strand the edit forever.
    const manifest = persistedManifest();
    if (manifest) expect(manifest['notes.md']).toEqual(previous);
  });

  it('still permanently skips a file rejected on its own size, not the batch cap', async () => {
    repository.getCorpusRecord.mockResolvedValue({
      id: CORPUS_ID,
      watch: {
        ...watchRecordWithPendingChange().watch,
        files: { 'huge.md': { size: 10, lastModified: 1, docId: 'doc:huge.md' } },
      },
    });
    scanner.scanFolder.mockResolvedValue([
      { path: 'huge.md', file: { name: 'huge.md', size: 99e6, lastModified: 42 } as File },
    ]);
    // Oversized files are not deferred — they can never succeed.
    localFiles.prepareIngestFiles.mockResolvedValue({
      files: [],
      deferredPaths: new Set<string>(),
    });

    await bindFolderWatcherToActiveCorpus();
    await vi.waitFor(() => expect(coordinator.reconcileWatchedFiles).toHaveBeenCalled());

    // The stale node is removed and the new mtime IS recorded: retrying would
    // just fail again.
    expect(coordinator.reconcileWatchedFiles).toHaveBeenCalledWith(
      [],
      ['doc:huge.md'],
      [],
      [],
    );
  });
});

describe('partial folder read failures', () => {
  it.each(['deferred', 'failed'])('retains a directory report until its %s descendant is retried', async (kind) => {
    const path = 'vault/blocked/foo.txt';
    const previous = { size: 10, lastModified: 1, docId: `doc:${path}` };
    repository.getCorpusRecord.mockResolvedValue({
      ...watchRecordWithPendingChange(),
      watch: { ...watchRecordWithPendingChange().watch, files: { [path]: previous } },
    });
    useGraphStore.setState({
      ingestReport: { finishedAt: 1, entries: [
        { name: 'vault/blocked', reason: 'could not read: Permission denied', kind: 'ignored' },
      ] },
    });
    scanner.scanFolder.mockResolvedValue([scannedFile(path)]);
    localFiles.prepareIngestFiles.mockResolvedValue({
      files: [],
      deferredPaths: new Set(kind === 'deferred' ? [path] : []),
      failedPaths: new Set(kind === 'failed' ? [path] : []),
    });
    await bindFolderWatcherToActiveCorpus();
    await suspendFolderWatcher();
    expect(useGraphStore.getState().ingestReport?.entries[0].name).toBe('vault/blocked');
    expect(repository.updateCorpusWatch).not.toHaveBeenCalled();

    localFiles.prepareIngestFiles.mockResolvedValue({
      files: [{ path, name: 'foo.txt', bytes: new ArrayBuffer(4) }],
      deferredPaths: new Set<string>(), failedPaths: new Set<string>(),
    });
    coordinator.reconcileWatchedFiles.mockResolvedValue([`doc:${path}`]);
    await bindFolderWatcherToActiveCorpus();
    await suspendFolderWatcher();
    expect(localFiles.prepareIngestFiles.mock.calls.at(-1)?.[0]).toEqual([scannedFile(path)]);
    expect(coordinator.reconcileWatchedFiles).toHaveBeenCalledOnce();
    expect(useGraphStore.getState().ingestReport).toBeNull();
  });

  it('clears and persists a recovered empty-directory report without an ingest run', async () => {
    useGraphStore.setState({
      ingestReport: { finishedAt: 1, entries: [
        { name: 'vault/empty', reason: 'could not read: Permission denied', kind: 'ignored' },
      ] },
    });
    scanner.scanFolder.mockResolvedValue([]);
    localFiles.prepareIngestFiles.mockResolvedValue({
      files: [], deferredPaths: new Set<string>(), failedPaths: new Set<string>(),
    });
    await bindFolderWatcherToActiveCorpus();
    await vi.waitFor(() => expect(repository.updateCorpusIngestReport).toHaveBeenCalledWith(CORPUS_ID, null));
    expect(useGraphStore.getState().ingestReport).toBeNull();
    expect(coordinator.reconcileWatchedFiles).not.toHaveBeenCalled();
  });

  it.each(['file', 'directory'])('clears a recovered %s read failure despite unchanged metadata', async (kind) => {
    const path = 'vault/blocked/foo.txt';
    const failedPath = kind === 'directory' ? 'vault/blocked' : path;
    const previous = { size: 10, lastModified: 1, docId: `doc:${path}` };
    repository.getCorpusRecord.mockResolvedValue({
      ...watchRecordWithPendingChange(),
      watch: { ...watchRecordWithPendingChange().watch, files: { [path]: previous } },
    });
    scanner.scanFolder.mockImplementation(async (_handle: unknown, onError: (failure: ReadFailure) => void) => {
      onError({ path: failedPath, directory: kind === 'directory', error: new Error('Permission denied') });
      return [];
    });
    localFiles.prepareIngestFiles.mockResolvedValue({
      files: [], deferredPaths: new Set<string>(), failedPaths: new Set<string>(),
    });
    useGraphStore.getState().addIgnored('another/foo.txt', 'could not read: Other source still denied');
    await bindFolderWatcherToActiveCorpus();
    await vi.waitFor(() => expect(useGraphStore.getState().ingestReport?.entries.some((entry) => entry.name === failedPath)).toBe(true));
    await suspendFolderWatcher();

    // A restored report alone must suffice; transient tray/status state is
    // not available after reloading the app.
    useGraphStore.setState({ ignoredFiles: [], fileStatuses: {} });
    scanner.scanFolder.mockResolvedValue([scannedFile(path)]);
    localFiles.prepareIngestFiles.mockResolvedValue({
      files: [{ path, name: 'foo.txt', bytes: new ArrayBuffer(4) }],
      deferredPaths: new Set<string>(), failedPaths: new Set<string>(),
    });
    coordinator.reconcileWatchedFiles.mockResolvedValue([`doc:${path}`]);
    await bindFolderWatcherToActiveCorpus();
    await vi.waitFor(() => expect(repository.updateCorpusIngestReport).toHaveBeenCalledTimes(2));

    expect(localFiles.prepareIngestFiles.mock.calls.at(-1)?.[0]).toEqual([scannedFile(path)]);
    expect(repository.updateCorpusWatch).not.toHaveBeenCalled();
    expect(useGraphStore.getState().ingestReport?.entries).toEqual([
      { name: 'another/foo.txt', reason: 'could not read: Other source still denied', kind: 'ignored' },
    ]);
    expect(repository.updateCorpusIngestReport.mock.calls.at(-1)?.[1]).toEqual(useGraphStore.getState().ingestReport);
  });

  it('persists a failure-only scan even when the same path previously succeeded', async () => {
    const previous = { size: 10, lastModified: 1, docId: 'old-doc' };
    repository.getCorpusRecord.mockResolvedValue({
      ...watchRecordWithPendingChange(),
      watch: { ...watchRecordWithPendingChange().watch, files: { 'vault/old.txt': previous } },
    });
    useGraphStore.getState().setFileStatus({
      fileId: 'previous-success', name: 'old.txt', path: 'vault/old.txt', stage: 'cached',
    });
    scanner.scanFolder.mockImplementation(async (_handle: unknown, onError: (failure: ReadFailure) => void) => {
      onError({ path: 'vault/old.txt', error: new Error('Permission denied') });
      return [];
    });
    localFiles.prepareIngestFiles.mockResolvedValue({
      files: [], deferredPaths: new Set<string>(), failedPaths: new Set<string>(),
    });

    await bindFolderWatcherToActiveCorpus();
    await vi.waitFor(() => expect(repository.updateCorpusIngestReport).toHaveBeenCalled());

    expect(coordinator.reconcileWatchedFiles).not.toHaveBeenCalled();
    expect(repository.updateCorpusWatch).not.toHaveBeenCalled();
    expect(repository.updateCorpusIngestReport).toHaveBeenLastCalledWith(CORPUS_ID, {
      finishedAt: expect.any(Number),
      entries: [{ name: 'vault/old.txt', reason: 'could not read: Permission denied', kind: 'ignored' }],
    });
    expect(useGraphStore.getState().ingestReport?.entries[0].name).toBe('vault/old.txt');
  });

  it.each(['file', 'directory', 'bytes'])('retains previous revisions on %s failure while processing other changes', async (kind) => {
    const retainedPath = kind === 'directory' ? 'vault/blocked/old.txt' : 'vault/old.txt';
    const previous = { size: 10, lastModified: 1, docId: 'old-doc' };
    repository.getCorpusRecord.mockResolvedValue({
      ...watchRecordWithPendingChange(),
      watch: {
        ...watchRecordWithPendingChange().watch,
        files: {
          [retainedPath]: previous,
          'vault/deleted.txt': { size: 10, lastModified: 1, docId: 'deleted-doc' },
        },
      },
    });
    scanner.scanFolder.mockImplementation(async (_handle: unknown, onError: (failure: ReadFailure) => void) => {
      if (kind !== 'bytes') onError({
        path: kind === 'directory' ? 'vault/blocked' : retainedPath,
        directory: kind === 'directory',
        error: new Error('Temporarily unavailable'),
      });
      return [scannedFile('vault/new.txt'), ...(kind === 'bytes' ? [{ path: retainedPath, file: { size: 20, lastModified: 2 } as File }] : [])];
    });
    localFiles.prepareIngestFiles.mockImplementation(async (_files: unknown, options: { onReadError: (failure: ReadFailure) => void }) => {
      if (kind === 'bytes') options.onReadError({ path: retainedPath, error: new Error('Temporarily unavailable') });
      return {
        files: [{ path: 'vault/new.txt', name: 'new.txt', bytes: new ArrayBuffer(4) }],
        deferredPaths: new Set<string>(),
        failedPaths: new Set(kind === 'bytes' ? [retainedPath] : []),
      };
    });
    coordinator.reconcileWatchedFiles.mockResolvedValue(['doc:vault/new.txt']);

    await bindFolderWatcherToActiveCorpus();
    await vi.waitFor(() => expect(repository.updateCorpusWatch).toHaveBeenCalled());

    expect(repository.updateCorpusWatch.mock.calls.at(-1)?.[1].files).toEqual({
      [retainedPath]: previous,
      'vault/new.txt': { size: 10, lastModified: 1, docId: 'doc:vault/new.txt' },
    });
    expect(coordinator.reconcileWatchedFiles.mock.calls.at(-1)?.[1]).toEqual(['deleted-doc']);

    // Once access returns, the retained old mtime makes this file eligible
    // for ingestion again rather than stranding the failed revision.
    await suspendFolderWatcher();
    repository.getCorpusRecord.mockResolvedValue({
      id: CORPUS_ID, watch: repository.updateCorpusWatch.mock.calls.at(-1)?.[1],
    });
    scanner.scanFolder.mockResolvedValue([
      scannedFile('vault/new.txt'),
      { path: retainedPath, file: { size: 20, lastModified: 2 } as File },
    ]);
    localFiles.prepareIngestFiles.mockResolvedValue({
      files: [{ path: retainedPath, name: 'old.txt', bytes: new ArrayBuffer(4) }],
      deferredPaths: new Set<string>(), failedPaths: new Set<string>(),
    });
    coordinator.reconcileWatchedFiles.mockResolvedValue([`doc:${retainedPath}`]);
    await bindFolderWatcherToActiveCorpus();
    await vi.waitFor(() => expect(repository.updateCorpusWatch).toHaveBeenCalledTimes(2));
    expect(localFiles.prepareIngestFiles.mock.calls.at(-1)?.[0]).toEqual([
      { path: retainedPath, file: { size: 20, lastModified: 2 } },
    ]);
    expect(repository.updateCorpusWatch.mock.calls.at(-1)?.[1].files[retainedPath]).toEqual({
      size: 20, lastModified: 2, docId: `doc:${retainedPath}`,
    });
  });
});
