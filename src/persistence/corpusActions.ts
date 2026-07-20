import { suspendFolderWatcher, bindFolderWatcherToActiveCorpus } from '../ingest/folderWatcher';
import { enqueueRun } from '../pipeline/runQueue';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';
import { deleteDocsFromCache, deleteGraphFromCache } from './cache';
import { deleteChatHistory } from './chatHistory';
import { flushPendingChatSave } from './chatHistorySync';
import {
  activateCorpus,
  createCorpus,
  deleteCorpusRecord,
  getCorpusRecord,
  renameCorpus,
  unreferencedDocumentIds,
} from './corpusRepository';
import { deleteOriginals } from './originals';
import { hydrateFromRecord } from './session';
import { saveSession } from './sessionSave';

/** Save the outgoing workspace, then restore another stable corpus head. */
export async function restoreCorpusById(id: string): Promise<boolean> {
  await suspendFolderWatcher();
  return enqueueRun(async () => {
    const record = await getCorpusRecord(id);
    if (!record) return false;
    if (useGraphStore.getState().phase === 'ready') await saveSession();
    // Land any debounced transcript against the workspace that produced it,
    // before setSwitching(true) starts suppressing saves.
    await flushPendingChatSave();

    useCorpusStore.getState().setSwitching(true);
    try {
      const { resetCorpus } = await import('../pipeline/coordinatorLazy');
      resetCorpus();
      await activateCorpus(id);
      const restored = record.exportData
        ? await hydrateFromRecord(record.exportData, record.positions ?? {}, record.corpusHash)
        : true;
      await bindFolderWatcherToActiveCorpus();
      return restored;
    } finally {
      useCorpusStore.getState().setSwitching(false);
    }
  });
}

/** Create and activate an empty named workspace. */
export async function createAndSwitchCorpus(name: string): Promise<string> {
  await suspendFolderWatcher();
  return enqueueRun(async () => {
    if (useGraphStore.getState().phase === 'ready') await saveSession();
    await flushPendingChatSave();
    useCorpusStore.getState().setSwitching(true);
    try {
      const record = await createCorpus(name);
      const { resetCorpus } = await import('../pipeline/coordinatorLazy');
      resetCorpus();
      await bindFolderWatcherToActiveCorpus();
      return record.id;
    } finally {
      useCorpusStore.getState().setSwitching(false);
    }
  });
}

export async function renameCorpusById(id: string, name: string): Promise<void> {
  await renameCorpus(id, name);
}

/** Delete one workspace without purging source data still used elsewhere. */
export async function deleteCorpusById(id: string): Promise<boolean> {
  if (useCorpusStore.getState().mode !== 'local') {
    throw new Error('Switch to a local corpus before deleting a saved corpus.');
  }
  if (useCorpusStore.getState().activeCorpusId === id) await suspendFolderWatcher();
  return enqueueRun(async () => {
    const activeId = useCorpusStore.getState().activeCorpusId;
    const removed = await deleteCorpusRecord(id);
    if (!removed) return false;

    if (removed.corpusHash) await deleteGraphFromCache(removed.corpusHash);
    const purge = await unreferencedDocumentIds(removed.docHashes);
    await Promise.all([
      deleteDocsFromCache(purge),
      deleteOriginals(purge),
      deleteChatHistory(removed.id),
    ]);

    if (activeId !== id) {
      return true;
    }
    const nextId = useCorpusStore.getState().corpora[0]?.id;
    let next = nextId ? await getCorpusRecord(nextId) : undefined;
    if (!next) {
      next = await createCorpus('My corpus');
    } else {
      await activateCorpus(next.id);
    }

    const { resetCorpus } = await import('../pipeline/coordinatorLazy');
    resetCorpus();
    if (next.exportData) {
      await hydrateFromRecord(next.exportData, next.positions ?? {}, next.corpusHash);
    }
    await bindFolderWatcherToActiveCorpus();
    return true;
  });
}
