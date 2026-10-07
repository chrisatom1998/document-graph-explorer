// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphExport } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useCorpusStore } from '../store/corpusStore';
import { useChatStore } from '../store/chatStore';
import { useUiStore } from '../store/uiStore';
import { useFolderWatchStore } from '../store/folderWatchStore';
import { clearRuntimeStores, textStore } from '../store/runtimeStores';
import { enqueueRun } from '../pipeline/runQueue';

// Keep the real import, queue, corpus repository and save logic; only browser
// storage and worker plumbing are replaced. Reads clone data like IndexedDB.
const storage = vi.hoisted(() => new Map<string, Map<string, unknown>>());
const watcher = vi.hoisted(() => ({
  suspended: false,
  bindingWait: undefined as (() => Promise<void>) | undefined,
}));
const storageDelay = vi.hoisted(() => ({
  corporaRead: undefined as (() => Promise<void>) | undefined,
  documentsRead: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('./db', () => {
  const table = (name: string) => {
    if (!storage.has(name)) storage.set(name, new Map());
    return storage.get(name)!;
  };
  const get = async (name: string, key: string) => {
    if (name === 'documents') await storageDelay.documentsRead?.();
    return structuredClone(table(name).get(key));
  };
  const put = async (name: string, value: unknown, key?: string) => {
    const record = value as Record<string, unknown>;
    table(name).set(key ?? String(record.id ?? record.hash ?? record.corpusHash), structuredClone(value));
  };
  const getAll = async (name: string) => {
    if (name === 'corpora') await storageDelay.corporaRead?.();
    return structuredClone([...table(name).values()]);
  };
  const remove = async (name: string, key: string) => { table(name).delete(key); };
  return { getDb: async () => ({
    get, put, getAll, delete: remove,
    transaction: () => ({
      done: Promise.resolve(),
      objectStore: (name: string) => ({
        get: (key: string) => get(name, key), put: (value: unknown, key?: string) => put(name, value, key),
        getAll: () => getAll(name), delete: (key: string) => remove(name, key),
      }),
    }),
  }) };
});
vi.mock('../layout/layoutBridge', () => ({
  layoutAddNodes: () => [], layoutReheat: () => undefined, layoutSetClusters: () => undefined,
  layoutSetLinks: () => undefined, layoutSetDims: () => undefined, layoutEpoch: () => 0,
  layoutSettledEpoch: () => 0, onLayoutSettled: () => () => undefined,
}));
vi.mock('../ingest/folderWatcher', () => ({
  suspendFolderWatcher: async () => { watcher.suspended = true; },
  bindFolderWatcherToActiveCorpus: async (options: { isCurrent?: () => boolean } = {}) => {
    await watcher.bindingWait?.();
    if (!options.isCurrent || options.isCurrent()) watcher.suspended = false;
  },
  tryResumeFolderWatcher: async (isCurrent: () => boolean) => {
    if (isCurrent()) watcher.suspended = false;
    return true;
  },
}));
vi.mock('../pipeline/coordinatorLazy', () => ({
  rebuildEmbeddings: async () => undefined,
  resetCorpus: () => {
    useGraphStore.getState().reset();
    clearRuntimeStores();
    useChatStore.getState().clearMessages();
  },
}));

import { importGraphExportData } from './exportImport';
import { getCorpusRecord } from './corpusRepository';
import { getSetting } from './cache';
import { startShareNavigation } from './shareNavigation';

const stopNavigations: Array<() => void> = [];
function startNavigation(onLocalReady?: () => void) {
  const stop = startShareNavigation(onLocalReady);
  stopNavigations.push(stop);
  return stop;
}

function rawShare(title: string): string {
  return `#graph=v1.raw.${Buffer.from(JSON.stringify(graph(title))).toString('base64url')}`;
}

function titles() { return useGraphStore.getState().nodes.map(node => node.title); }

function navigate(url: string, event = 'hashchange') {
  window.history.replaceState(null, '', url);
  (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event));
}

function graph(title: string): GraphExport {
  return {
    version: 1, createdAt: '2026-10-07T12:00:00.000Z', generator: 'knowledge-nebula', includeEmbeddings: false,
    nodes: [{ id: title, title, kind: 'document', fileType: 'txt', topics: [], entities: [], keywords: [],
      wordCount: 1, cluster: 0, degree: 0, status: 'ok' }],
    edges: [], clusterNames: {},
  };
}

function privateWorkspace() {
  storage.set('corpora', new Map([['private', {
    id: 'private', name: 'Private workspace', createdAt: 1, updatedAt: 1,
    corpusHash: 'private-hash', docHashes: ['Saved private document'],
    exportData: graph('Saved private document'), positions: {},
  }]]));
  storage.set('settings', new Map([['lastCorpusId', 'private']]));
  useCorpusStore.getState().setLocalState([{ id: 'private', name: 'Private workspace',
    updatedAt: 1, documentCount: 1, watching: false }], 'private');
  useGraphStore.getState().addNodes(graph('Edited private document').nodes);
  useGraphStore.getState().setCorpusHash('private-hash');
  useGraphStore.getState().setPhase('ready');
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  storage.clear();
  storageDelay.corporaRead = undefined;
  storageDelay.documentsRead = undefined;
  watcher.suspended = false;
  watcher.bindingWait = undefined;
  useCorpusStore.getState().reset();
  useGraphStore.getState().reset();
  useUiStore.setState({ toasts: [] });
  useFolderWatchStore.getState().setState({
    status: 'idle', folderName: null, lastSyncAt: null, lastChangeCount: 0, error: null,
  });
  clearRuntimeStores();
});
afterEach(async () => {
  for (const stop of stopNavigations.splice(0)) stop();
  await enqueueRun(async () => undefined);
  useCorpusStore.getState().reset();
  useGraphStore.getState().reset();
  clearRuntimeStores();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('incoming share navigation', () => {
  it('restores the saved local workspace when startup has no share directive', async () => {
    privateWorkspace();
    useCorpusStore.getState().reset();
    useGraphStore.getState().reset();
    let ready = false;
    startNavigation(() => { ready = true; });
    await vi.waitFor(() => expect(ready).toBe(true));
    expect(titles()).toEqual(['Saved private document']);
    expect(useCorpusStore.getState()).toMatchObject({ mode: 'local', activeCorpusId: 'private' });
  });

  it('opens an explicit query share on startup without mixing in saved private documents', async () => {
    privateWorkspace();
    useCorpusStore.getState().reset();
    useGraphStore.getState().reset();
    window.history.replaceState(null, '', `/?graph=${rawShare('Query share').slice('#graph='.length)}`);
    startNavigation();
    await vi.waitFor(() => expect(titles()).toEqual(['Query share']));
    expect(useCorpusStore.getState().corpora.map(c => c.id)).toEqual(['private']);
    expect((await getCorpusRecord('private'))?.exportData?.nodes[0].title).toBe('Saved private document');
  });

  it('does not re-arm a startup watcher after a shared link has suspended it', async () => {
    privateWorkspace();
    useCorpusStore.getState().reset();
    useGraphStore.getState().reset();
    let release!: () => void;
    let binding = false;
    watcher.bindingWait = () => new Promise<void>(resolve => { binding = true; release = resolve; });
    startNavigation();
    await vi.waitFor(() => expect(binding).toBe(true));
    navigate(rawShare('Shared after startup'));
    await vi.waitFor(() => expect(watcher.suspended).toBe(true));
    watcher.bindingWait = undefined;
    release();
    await vi.waitFor(() => expect(titles()).toEqual(['Shared after startup']));
    expect(watcher.suspended).toBe(true);
  });

  it.each(['corporaRead', 'documentsRead'] as const)(
    'cancels an obsolete local restore during %s before publishing private data', async boundary => {
      privateWorkspace();
      storage.set('documents', new Map([['Saved private document', {
        text: 'Private full text', chunkTexts: [], mdLinkTargets: [], docLinks: [],
      }]]));
      useCorpusStore.getState().reset();
      useGraphStore.getState().reset();
      let release!: () => void;
      let reading = false;
      storageDelay[boundary] = () => new Promise<void>(resolve => { reading = true; release = resolve; });
      startNavigation();
      await vi.waitFor(() => expect(reading).toBe(true));
      navigate('#graph=v1.raw.bad!');
      storageDelay[boundary] = undefined;
      release();
      await vi.waitFor(() => expect(useUiStore.getState().toasts.some(t => /malformed/iu.test(t.message))).toBe(true));
      expect(titles()).toEqual([]);
      expect(textStore.has('Saved private document')).toBe(false);
      expect(useCorpusStore.getState()).toMatchObject({ mode: 'shared', activeCorpusId: null });
      expect((await getCorpusRecord('private'))?.exportData?.nodes[0].title).toBe('Saved private document');
    },
  );

  it.each(['hashchange', 'popstate', 'pageshow', 'focus', 'visibilitychange'])(
    'opens a new link on %s while retaining the private workspace', async event => {
      privateWorkspace();
      window.history.replaceState(null, '', rawShare('First share'));
      startNavigation();
      await vi.waitFor(() => expect(titles()).toEqual(['First share']));
      navigate(rawShare('Next share'), event);
      await vi.waitFor(() => expect(titles()).toEqual(['Next share']));
      expect((await getCorpusRecord('private'))?.exportData?.nodes[0].title).toBe('Edited private document');
    },
  );

  it('keeps a manually opened workspace on duplicate resume events, but permits revisiting a link', async () => {
    window.history.replaceState(null, '', rawShare('Shared document'));
    startNavigation();
    await vi.waitFor(() => expect(titles()).toEqual(['Shared document']));
    useGraphStore.getState().reset();
    privateWorkspace();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    await enqueueRun(async () => undefined);
    expect(titles()).toEqual(['Edited private document']);
    navigate('/');
    navigate(rawShare('Shared document'));
    await vi.waitFor(() => expect(titles()).toEqual(['Shared document']));
  });

  it('imports only the latest link when navigation changes behind an in-flight ingest', async () => {
    privateWorkspace();
    let release!: () => void;
    const blocker = enqueueRun(() => new Promise<void>(resolve => { release = resolve; }));
    window.history.replaceState(null, '', rawShare('Obsolete share'));
    startNavigation();
    await vi.waitFor(() => expect(watcher.suspended).toBe(true));
    const seen: string[] = [];
    const unsubscribe = useGraphStore.subscribe(state => { seen.push(...state.nodes.map(n => n.title)); });
    navigate(rawShare('Latest share'));
    release();
    await blocker;
    await vi.waitFor(() => expect(titles()).toEqual(['Latest share']));
    unsubscribe();
    expect(seen).not.toContain('Obsolete share');
    expect(useUiStore.getState().toasts.filter(t => t.message.startsWith('Opened a shared graph'))).toHaveLength(1);
  });

  it('cancels pending imports and ignores later navigation after cleanup', async () => {
    privateWorkspace();
    let release!: () => void;
    const blocker = enqueueRun(() => new Promise<void>(resolve => { release = resolve; }));
    window.history.replaceState(null, '', rawShare('Cancelled share'));
    const stop = startNavigation();
    await vi.waitFor(() => expect(watcher.suspended).toBe(true));
    stop();
    navigate(rawShare('After cleanup'));
    release();
    await blocker;
    await enqueueRun(async () => undefined);
    expect(titles()).toEqual(['Edited private document']);
    expect(useUiStore.getState().toasts).toEqual([]);
  });

  it('reports an invalid link without discarding the graph already open', async () => {
    window.history.replaceState(null, '', rawShare('Current share'));
    startNavigation();
    await vi.waitFor(() => expect(titles()).toEqual(['Current share']));
    navigate('#graph=v1.raw.bad!');
    await vi.waitFor(() => expect(useUiStore.getState().toasts.some(t => /malformed/iu.test(t.message))).toBe(true));
    expect(titles()).toEqual(['Current share']);
  });

  it('does not attach an aborted startup or the next queued drop to an unhydrated private corpus', async () => {
    privateWorkspace();
    useCorpusStore.getState().reset();
    useGraphStore.getState().reset();
    let release!: () => void;
    let reading = false;
    storageDelay.corporaRead = () => new Promise<void>(resolve => { reading = true; release = resolve; });
    window.history.replaceState(null, '', rawShare('Aborted startup'));
    startNavigation();
    await vi.waitFor(() => expect(reading).toBe(true));
    // A drop can already be queued before the bad replacement URL decodes.
    const nextDropOwner = enqueueRun(async () => useCorpusStore.getState().activeCorpusId);
    navigate('#graph=v1.raw.bad!');
    storageDelay.corporaRead = undefined;
    release();
    expect(await nextDropOwner).toBeNull();
    await vi.waitFor(() => expect(useUiStore.getState().toasts.some(t => /malformed/iu.test(t.message))).toBe(true));
    expect(titles()).toEqual([]);
    expect(useCorpusStore.getState()).toMatchObject({ mode: 'shared', activeCorpusId: null });
    expect((await getCorpusRecord('private'))?.exportData?.nodes[0].title).toBe('Saved private document');
  });

  it('accepts a PWA launch URL and does not reimport the previous location on focus', async () => {
    let consume: ((params: { targetURL?: string }) => void) | undefined;
    vi.stubGlobal('launchQueue', { setConsumer: (callback: typeof consume) => { consume = callback; } });
    window.history.replaceState(null, '', rawShare('Old location'));
    startNavigation();
    await vi.waitFor(() => expect(titles()).toEqual(['Old location']));
    consume?.({ targetURL: `https://document-graph-explorer.vercel.app/${rawShare('Launched share')}` });
    await vi.waitFor(() => expect(titles()).toEqual(['Launched share']));
    window.dispatchEvent(new Event('focus'));
    await enqueueRun(async () => undefined);
    expect(titles()).toEqual(['Launched share']);
  });

  it('reopens an identical link when a PWA launch explicitly requests it after a local switch', async () => {
    let consume: ((params: { targetURL?: string }) => void) | undefined;
    vi.stubGlobal('launchQueue', { setConsumer: (callback: typeof consume) => { consume = callback; } });
    const fragment = rawShare('Explicit share');
    window.history.replaceState(null, '', fragment);
    startNavigation();
    await vi.waitFor(() => expect(titles()).toEqual(['Explicit share']));
    useGraphStore.getState().reset();
    privateWorkspace();
    consume?.({ targetURL: `https://document-graph-explorer.vercel.app/${fragment}` });
    await vi.waitFor(() => expect(titles()).toEqual(['Explicit share']));
  });
});

describe('share import lifecycle', () => {
  it.each(['shared', 'imported'] as const)(
    'clears stale folder controls after %s import while retaining the saved watch configuration', async mode => {
      privateWorkspace();
      const saved = (await getCorpusRecord('private'))!;
      const watch = { handle: { name: 'Private folder' }, rootName: 'Private folder', files: {}, paused: false };
      storage.get('corpora')!.set('private', { ...saved, watch });
      useFolderWatchStore.getState().setState({
        status: mode === 'shared' ? 'watching' : 'checking', folderName: 'Private folder',
        lastSyncAt: 123, lastChangeCount: 2, error: 'Old folder warning',
      });

      await importGraphExportData(graph('Portable document'), mode);

      expect(useCorpusStore.getState()).toMatchObject({ mode, activeCorpusId: null });
      expect(useFolderWatchStore.getState()).toMatchObject({
        status: 'idle', folderName: null, lastSyncAt: null, lastChangeCount: 0, error: null,
      });
      expect(watcher.suspended).toBe(true);
      expect((await getCorpusRecord('private'))?.watch).toEqual(watch);
    },
  );

  it('saves outgoing local edits before opening a shared graph without overwriting the private corpus', async () => {
    privateWorkspace();
    await importGraphExportData(graph('Shared document'), 'shared');
    expect(useGraphStore.getState().nodes.map(n => n.title)).toEqual(['Shared document']);
    expect(useCorpusStore.getState()).toMatchObject({ mode: 'shared', activeCorpusId: null });
    expect((await getCorpusRecord('private'))?.exportData?.nodes.map(n => n.title)).toEqual(['Edited private document']);
    expect(await getSetting('lastCorpusId')).toBe('private');
    await importGraphExportData(graph('Another share'), 'shared');
    expect((await getCorpusRecord('private'))?.exportData?.nodes.map(n => n.title)).toEqual(['Edited private document']);
  });

  it('skips an obsolete share that was waiting behind an ingest', async () => {
    privateWorkspace();
    useFolderWatchStore.getState().setState({ status: 'watching', folderName: 'Private folder' });
    let release!: () => void;
    const blocker = enqueueRun(() => new Promise<void>(resolve => { release = resolve; }));
    const controller = new AbortController();
    const pending = importGraphExportData(graph('Stale share'), 'shared', { signal: controller.signal })
      .then(() => 'imported', error => error.name as string);
    await vi.waitFor(() => expect(watcher.suspended).toBe(true));
    controller.abort();
    release();
    await blocker;
    expect(await pending).toBe('AbortError');
    expect(useGraphStore.getState().nodes.map(n => n.title)).toEqual(['Edited private document']);
    expect(useCorpusStore.getState()).toMatchObject({ mode: 'local', activeCorpusId: 'private' });
    expect(watcher.suspended).toBe(false);
    expect(useFolderWatchStore.getState()).toMatchObject({ status: 'watching', folderName: 'Private folder' });
  });

  it('loads the local workspace list on a shared startup without hydrating its private documents', async () => {
    privateWorkspace();
    useCorpusStore.getState().reset();
    useGraphStore.getState().reset();
    await importGraphExportData(graph('Startup share'), 'shared');
    expect(useCorpusStore.getState().corpora.map(c => c.id)).toEqual(['private']);
    expect(useGraphStore.getState().nodes.map(n => n.title)).toEqual(['Startup share']);
    expect((await getCorpusRecord('private'))?.exportData?.nodes.map(n => n.title)).toEqual(['Saved private document']);
  });
});
