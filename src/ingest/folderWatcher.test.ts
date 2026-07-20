// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repository = vi.hoisted(() => ({
  getCorpusRecord: vi.fn(),
  updateCorpusWatch: vi.fn().mockResolvedValue(undefined),
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

    const switchRun = enqueueRun(async () => {
      await bindFolderWatcherToActiveCorpus();
      order.push('switch-complete');
    });

    const outcome = await Promise.race([
      switchRun.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('deadlocked'), 500)),
    ]);

    expect(outcome).toBe('resolved');
    expect(order).toContain('switch-complete');
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
