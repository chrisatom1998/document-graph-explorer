import { enqueueRun } from '../pipeline/runQueue';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { decodeShareFragment, extractShareFragment } from './shareUrl';

type LaunchQueue = { setConsumer: (consumer: (params: { targetURL?: string }) => void) => void };

/**
 * Own incoming share links for one mounted application. URL parsing is pure;
 * imports and local restore use the same queue as ingest/workspace switches.
 */
export function startShareNavigation(onLocalReady?: () => void): () => void {
  let disposed = false;
  let current: AbortController | undefined;
  let lastFragment: string | null | undefined;
  let lastLocation: string | undefined;
  const launchQueue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue;

  const reportShareError = async (error: unknown, signal: AbortSignal) => {
    if (signal.aborted) return;
    // Invalid startup links still expose the owner's workspace switcher, but
    // must not hydrate an unrelated private graph or attach new files to it.
    if (useGraphStore.getState().nodes.length === 0) {
      await enqueueRun(async () => {
        if (useGraphStore.getState().nodes.length > 0) return;
        if (!useCorpusStore.getState().initialized) {
          const { initializeCorpusRepository } = await import('./corpusRepository');
          signal.throwIfAborted();
          try {
            await initializeCorpusRepository();
          } catch (storageError) {
            const { reportPersistenceUnavailable } = await import('./cache');
            reportPersistenceUnavailable(storageError);
          } finally {
            // Even a replacement/cleanup during initialization must not leave
            // a private corpus id attached to an empty, unhydrated view.
            useCorpusStore.getState().setEphemeral('Invalid shared graph', 'shared');
          }
        }
        signal.throwIfAborted();
        useCorpusStore.getState().setEphemeral('Invalid shared graph', 'shared');
      }, { signal });
    }
    if (!signal.aborted) {
      useUiStore.getState().pushToast(error instanceof Error ? error.message : 'This shared graph link is invalid.');
    }
  };

  const restoreLocal = async (signal: AbortSignal) => {
    try {
      await enqueueRun(async () => {
        // DropZone is already live. A completed early drop owns its graph;
        // startup must not append a saved workspace after that ingest.
        if (useGraphStore.getState().nodes.length === 0) {
          const { restoreSession } = await import('./session');
          signal.throwIfAborted();
          await restoreSession({ signal });
        }
        signal.throwIfAborted();
        if (useCorpusStore.getState().mode === 'local') {
          const { bindFolderWatcherToActiveCorpus } = await import('../ingest/folderWatcher');
          signal.throwIfAborted();
          await bindFolderWatcherToActiveCorpus({ isCurrent: () => !signal.aborted });
        }
      }, { signal });
      if (!signal.aborted) onLocalReady?.();
    } catch (error) {
      if (!signal.aborted) console.warn('session restore failed', error);
    }
  };

  const open = (href: string, initial = false, explicitLaunch = false) => {
    if (disposed) return;
    let fragment: string | null;
    try {
      fragment = extractShareFragment(href);
    } catch (error) {
      current?.abort();
      current = new AbortController();
      lastFragment = undefined;
      void reportShareError(error, current.signal).catch(() => undefined);
      return;
    }
    if (fragment === lastFragment && !explicitLaunch) return;
    lastFragment = fragment;
    current?.abort();
    current = new AbortController();
    const { signal } = current;
    if (fragment === null) {
      // Removing a link cancels any pending import. Keep an already displayed
      // graph; an empty startup can resume its normal local restore.
      if (initial || useGraphStore.getState().nodes.length === 0) void restoreLocal(signal);
      return;
    }
    void (async () => {
      const shared = await decodeShareFragment(fragment);
      signal.throwIfAborted();
      if (!shared) return;
      const { importGraphExportData } = await import('./exportImport');
      signal.throwIfAborted();
      await importGraphExportData(shared, 'shared', { signal });
      signal.throwIfAborted();
      useUiStore.getState().pushToast(
        'Opened a shared graph — document contents remain on the owner’s device.', 'info',
      );
    })().catch(error => reportShareError(error, signal)).catch(() => undefined);
  };

  const checkLocation = () => {
    const href = window.location.href;
    if (disposed || href === lastLocation) return;
    const initial = lastLocation === undefined;
    lastLocation = href;
    open(href, initial);
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') checkLocation();
  };
  const events = ['hashchange', 'popstate', 'pageshow', 'focus'] as const;
  for (const event of events) window.addEventListener(event, checkLocation);
  document.addEventListener('visibilitychange', onVisibility);
  checkLocation();
  launchQueue?.setConsumer(params => {
    if (disposed || !params.targetURL) return;
    // focus-existing launches can supply a new URL without navigating the
    // window. Its unchanged old location must not undo the launch on resume.
    lastLocation = window.location.href;
    open(params.targetURL, false, true);
  });

  return () => {
    if (disposed) return;
    disposed = true;
    current?.abort();
    for (const event of events) window.removeEventListener(event, checkLocation);
    document.removeEventListener('visibilitychange', onVisibility);
    launchQueue?.setConsumer(() => undefined);
  };
}
