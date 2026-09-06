import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { GraphExport } from '../model/types';
import { importGraphExportData } from '../persistence/exportImport';
import { resetCorpus } from '../pipeline/coordinatorLazy';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import { useUiStore } from '../store/uiStore';
import { useCollabStore } from './store';

vi.mock('../layout/layoutBridge', () => ({
  layoutAddNodes: vi.fn(() => []),
  layoutReheat: vi.fn(),
  layoutSetClusters: vi.fn(),
  layoutSetLinks: vi.fn(),
  layoutSetDims: vi.fn(),
  layoutEpoch: () => 0,
  layoutSettledEpoch: () => 0,
  onLayoutSettled: () => () => undefined,
}));

vi.mock('../ingest/folderWatcher', () => ({ suspendFolderWatcher: vi.fn(async () => undefined) }));
vi.mock('../pipeline/coordinatorLazy', () => ({
  resetCorpus: vi.fn(() => {
    useGraphStore.getState().reset();
    useUiStore.getState().setSelected(null);
  }),
}));

vi.mock('./session', async () => {
  const actual = await vi.importActual<typeof import('./session')>('./session');
  return {
    ...actual,
    createCollabSession: vi.fn((config: { roomId: string; sessionKey: string }) => {
      const doc = new Y.Doc();
      return {
        doc,
        provider: {
          awareness: {
            on: vi.fn(), setLocalState: vi.fn(), getLocalState: () => ({}),
            getStates: () => new Map(), clientID: 1,
          },
          destroy: vi.fn(),
        },
        view: doc.getMap('view'), annotations: doc.getMap('annotations'),
        roomId: config.roomId, sessionKey: config.sessionKey, signaling: [],
      };
    }),
  };
});

function graph(id: string): GraphExport {
  return {
    version: 1, createdAt: '2026-09-06T00:00:00.000Z', generator: 'knowledge-nebula', includeEmbeddings: false,
    nodes: [{
      id, title: `Document ${id}`, kind: 'document', fileType: 'txt',
      topics: [], keywords: [], entities: [], wordCount: 1, cluster: 0, degree: 0, status: 'ok',
    }],
    edges: [], clusterNames: {},
  };
}

describe('collaboration across graph replacements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.getState().setOfflineMode(false);
    useCollabStore.getState().leaveSession();
    useCorpusStore.getState().reset();
    useGraphStore.getState().reset();
    useUiStore.getState().setSelected(null);
  });

  afterEach(() => {
    useCollabStore.getState().leaveSession();
    useCorpusStore.getState().reset();
    useGraphStore.getState().reset();
  });

  it.each(['imported', 'shared'] as const)('disconnects before replacing a %s graph with the same mode', async (mode) => {
    await importGraphExportData(graph('A'), mode);
    useUiStore.getState().setSelected('A');
    await useCollabStore.getState().startSession('room-A', 'key-A');
    const session = useCollabStore.getState().session!;
    const identityBefore = useCorpusStore.getState();
    expect(session.view.get('selectedTitle')).toBe('Document A');
    expect(session.provider!.destroy).not.toHaveBeenCalled();
    vi.mocked(resetCorpus).mockImplementationOnce(() => {
      expect(session.provider!.destroy).toHaveBeenCalledOnce();
      expect(useCollabStore.getState().session).toBeNull();
      useGraphStore.getState().reset();
      useUiStore.getState().setSelected(null);
    });

    await importGraphExportData(graph('B'), mode);
    expect(useCorpusStore.getState()).toMatchObject({
      activeCorpusId: identityBefore.activeCorpusId, mode: identityBefore.mode, switching: false,
    });
    expect(useGraphStore.getState().nodes.map((node) => node.id)).toEqual(['B']);
    expect(useCollabStore.getState()).toMatchObject({ session: null, shareNotes: false, status: 'idle' });
    session.view.set('selectedId', 'B');
    expect(useUiStore.getState().selectedId).toBeNull();
    useUiStore.getState().setSelected('B');
    useCollabStore.getState().syncSharedView();
    await Promise.resolve();
    expect(session.view.get('selectedTitle')).toBe('Document A');
  });
});
