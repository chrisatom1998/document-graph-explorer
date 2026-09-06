import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { useAnnotationStore, ensureAnnotationsLoaded, _resetAnnotationsForTests } from '../store/annotationStore';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import { getCorpusRecord } from '../persistence/corpusRepository';
import type { CorpusRecord } from '../persistence/db';
import { DEFAULT_FILTER, useUiStore } from '../store/uiStore';
import type { DocNode } from '../model/types';
import {
  idOfSlot,
  positionBuffer,
  resetPositionBuffer,
  scaleOfSlot,
  slotOfId,
} from '../scene/positionBuffer';
import { buildSharedView, useCollabStore } from './store';
import { createCollabSession } from './session';

vi.mock('../persistence/corpusRepository', () => ({
  getCorpusRecord: vi.fn(async () => corpusRecord('c1', {
    'doc-1': { note: 'secret note', tags: ['private'], pinned: false, updatedAt: 10 },
  })),
  updateCorpusAnnotations: vi.fn(async () => undefined),
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
            on: vi.fn(),
            setLocalState: vi.fn(),
            getLocalState: () => ({}),
            getStates: () => new Map(),
            clientID: 1,
          },
          destroy: vi.fn(),
        },
        view: doc.getMap('view'),
        annotations: doc.getMap('annotations'),
        roomId: config.roomId,
        sessionKey: config.sessionKey,
        signaling: [],
      };
    }),
  };
});

function corpusRecord(id: string, annotations: CorpusRecord['annotations']): CorpusRecord {
  return {
    id, name: id, createdAt: 1, updatedAt: 1, corpusHash: null,
    docHashes: [], exportData: null, positions: {}, annotations,
  };
}

function seedNode(id: string, slot: number, pos: [number, number, number]): void {
  slotOfId.set(id, slot);
  idOfSlot[slot] = id;
  scaleOfSlot[slot] = 2;
  const needed = (slot + 1) * 3;
  if (positionBuffer.array.length < needed) {
    const next = new Float32Array(needed);
    next.set(positionBuffer.array);
    positionBuffer.array = next;
  }
  positionBuffer.array[slot * 3] = pos[0];
  positionBuffer.array[slot * 3 + 1] = pos[1];
  positionBuffer.array[slot * 3 + 2] = pos[2];
  positionBuffer.count = Math.max(positionBuffer.count, slot + 1);
}

function doc(id: string): DocNode {
  return {
    id,
    title: 'Enterprise Service Level Agreement',
    path: '/Users/secret-user/Private/sla-agreement-enterprise.pdf',
    fileType: 'pdf',
    kind: 'document',
    cluster: 0,
    degree: 1,
    status: 'ok',
    keywords: [],
    topics: [],
    entities: [],
    summary: '',
    wordCount: 10,
  };
}

describe('collab privacy: notes default-off and no disk paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.getState().setOfflineMode(false);
    resetPositionBuffer();
    useGraphStore.getState().reset();
    useGraphStore.getState().addNodes([doc('doc-1')]);
    _resetAnnotationsForTests();
    useCorpusStore.getState().reset();
    useCollabStore.getState().leaveSession();
    useUiStore.setState({
      selectedId: 'local-sla',
      dims: 3,
      topicNodesEnabled: false,
      clusterCollapsed: false,
      filter: { ...DEFAULT_FILTER },
      toasts: [],
    });
  });

  afterEach(() => {
    useCollabStore.getState().leaveSession();
    _resetAnnotationsForTests();
    useCorpusStore.getState().reset();
    resetPositionBuffer();
    useGraphStore.getState().reset();
    useSettingsStore.getState().setOfflineMode(false);
  });

  it('defaults shareNotes to off and does not push local notes into the room', async () => {
    useCorpusStore.getState().setLocalState(
      [{ id: 'c1', name: 'C', updatedAt: 1, documentCount: 1, watching: false }],
      'c1',
    );
    useAnnotationStore.getState().hydrate('c1', {
      'doc-1': { note: 'secret note', tags: ['private'], pinned: false, updatedAt: 10 },
    });

    expect(useCollabStore.getState().shareNotes).toBe(false);
    await useCollabStore.getState().startSession('room-priv', 'key-priv');
    const session = useCollabStore.getState().session;
    expect(session).not.toBeNull();
    expect(session?.annotations.size).toBe(0);
    expect(JSON.stringify(session?.annotations.toJSON() ?? {})).not.toContain('secret note');
  });

  it('pulls existing peer notes when opting in mid-session', async () => {
    const peerDoc = { ...doc('doc-peer'), path: 'docs/peer.pdf' };
    useGraphStore.getState().addNodes([peerDoc]);
    useCorpusStore.getState().setLocalState(
      [{ id: 'c1', name: 'C', updatedAt: 1, documentCount: 1, watching: false }],
      'c1',
    );
    useAnnotationStore.getState().hydrate('c1', {});

    await useCollabStore.getState().startSession('room-optin', 'key-optin');
    const session = useCollabStore.getState().session;
    expect(session).not.toBeNull();
    session!.annotations.set('doc-peer', {
      note: 'peer note',
      tags: ['shared'],
      pinned: false,
      updatedAt: 20,
    });
    expect(useAnnotationStore.getState().annotations[peerDoc.path]).toBeUndefined();

    useCollabStore.getState().setShareNotes(true);
    await vi.waitFor(() => {
      expect(useAnnotationStore.getState().annotations[peerDoc.path]?.note).toBe('peer note');
      expect(useAnnotationStore.getState().annotations[peerDoc.path]?.tags).toEqual(['shared']);
    });
  });

  it('pushes local notes only after the user opts in', async () => {
    useCorpusStore.getState().setLocalState(
      [{ id: 'c1', name: 'C', updatedAt: 1, documentCount: 1, watching: false }],
      'c1',
    );
    useAnnotationStore.getState().hydrate('c1', {
      'doc-1': { note: 'secret note', tags: ['private'], pinned: false, updatedAt: 10 },
    });

    useCollabStore.getState().setShareNotes(true);
    await useCollabStore.getState().startSession('room-notes', 'key-notes');
    await vi.waitFor(() => {
      expect(useCollabStore.getState().session?.annotations.get('doc-1')?.note).toBe('secret note');
    });
  });

  it('waits for pre-existing UI hydration before binding note sharing', async () => {
    useCorpusStore.getState().setLocalState(
      [{ id: 'c1', name: 'C', updatedAt: 1, documentCount: 1, watching: false }], 'c1',
    );
    let finishLoad!: (record: CorpusRecord) => void;
    vi.mocked(getCorpusRecord).mockReturnValueOnce(new Promise((resolve) => { finishLoad = resolve; }));
    const uiHydration = ensureAnnotationsLoaded('c1');
    await vi.waitFor(() => expect(getCorpusRecord).toHaveBeenCalledOnce());
    await useCollabStore.getState().startSession('room-ui-loading', 'key-ui-loading');
    const session = useCollabStore.getState().session!;
    useCollabStore.getState().setShareNotes(true);
    await Promise.resolve();
    expect(session.annotations.size).toBe(0);

    finishLoad(corpusRecord('c1', {
      'doc-1': { note: 'notes loaded by UI', tags: [], pinned: false, updatedAt: 10 },
    }));
    await uiHydration;
    await vi.waitFor(() => expect(session.annotations.get('doc-1')?.note).toBe('notes loaded by UI'));
    expect(useCollabStore.getState().shareNotes).toBe(true);
    expect(getCorpusRecord).toHaveBeenCalledOnce();
    useAnnotationStore.getState().update('doc-1', { note: 'subsequent edit' });
    expect(session.annotations.get('doc-1')?.note).toBe('subsequent edit');
  });

  it('turns note sharing off and supports retry when hydration fails', async () => {
    useCorpusStore.getState().setLocalState(
      [{ id: 'c1', name: 'C', updatedAt: 1, documentCount: 1, watching: false }], 'c1',
    );
    await useCollabStore.getState().startSession('room-load-failure', 'key-load-failure');
    const session = useCollabStore.getState().session!;
    vi.mocked(getCorpusRecord).mockRejectedValueOnce(new Error('IndexedDB read failed'));
    useCollabStore.getState().setShareNotes(true);
    await vi.waitFor(() => expect(useCollabStore.getState().shareNotes).toBe(false));
    expect(session.annotations.size).toBe(0);
    expect(useUiStore.getState().toasts.some((toast) => /notes for sharing/i.test(toast.message))).toBe(true);

    useCollabStore.getState().setShareNotes(true);
    await vi.waitFor(() => expect(session.annotations.get('doc-1')?.note).toBe('secret note'));
    expect(useCollabStore.getState().shareNotes).toBe(true);
  });

  it('omits filesystem paths from the published shared view', () => {
    const node = doc('local-sla');
    useGraphStore.getState().addNodes([node]);
    seedNode('local-sla', 0, [10, 20, 30]);

    const view = buildSharedView();
    const serialized = JSON.stringify(view);
    expect(view.selectedId).toBe('local-sla');
    expect(view.selectedTitle).toBe('Enterprise Service Level Agreement');
    expect(view).not.toHaveProperty('selectedPath');
    expect(view.cameraAnchor).not.toHaveProperty('path');
    expect(serialized).not.toContain('/Users/secret-user');
    expect(serialized).not.toContain(node.path);
  });

  it('disconnects an existing session offline and stops all subsequent publications', async () => {
    useCorpusStore.getState().setLocalState(
      [{ id: 'c1', name: 'C', updatedAt: 1, documentCount: 1, watching: false }], 'c1',
    );
    await ensureAnnotationsLoaded('c1');
    useCollabStore.getState().setShareNotes(true);
    await useCollabStore.getState().startSession('room-offline', 'key-offline');
    const session = useCollabStore.getState().session!;
    const updates = vi.fn();
    session.doc.on('update', updates);
    const presence = vi.mocked(session.provider!.awareness.setLocalState);

    useSettingsStore.getState().setOfflineMode(true);
    expect(session.provider!.destroy).toHaveBeenCalledOnce();
    expect(useCollabStore.getState()).toMatchObject({ session: null, status: 'idle', shareNotes: false });
    updates.mockClear();
    presence.mockClear();
    useAnnotationStore.getState().update('doc-1', { note: 'private offline edit' });
    useCollabStore.getState().setLocalPresence({ selectedId: 'doc-1' });
    useCollabStore.getState().syncSharedView();
    useCollabStore.getState().syncCameraPose();
    await Promise.resolve();

    expect(updates).not.toHaveBeenCalled();
    expect(presence).not.toHaveBeenCalled();
    expect(session.annotations.get('doc-1')?.note).toBe('secret note');
  });

  it.each(['startSession', 'joinSession'] as const)('invalidates %s before its session module resolves', async (method) => {
    const joining = useCollabStore.getState()[method]('room-pending', 'key-pending');
    useSettingsStore.getState().setOfflineMode(true);
    useSettingsStore.getState().setOfflineMode(false);
    await expect(joining).resolves.toBeNull();
    expect(createCollabSession).not.toHaveBeenCalled();
    expect(useCollabStore.getState()).toMatchObject({ session: null, status: 'idle' });
  });

  it('does not revive an invite when offline mode changes during invite parsing', async () => {
    const joining = useCollabStore.getState().joinInvite('#collab=v1.room-invite.key-invite');
    useSettingsStore.getState().setOfflineMode(true);
    useSettingsStore.getState().setOfflineMode(false);
    await expect(joining).resolves.toBeNull();
    expect(createCollabSession).not.toHaveBeenCalled();
  });

  it('invalidates a pending join when the workspace changes', async () => {
    const joining = useCollabStore.getState().joinSession('room-outgoing', 'key-outgoing');
    useCorpusStore.getState().setLocalState(
      [{ id: 'c2', name: 'C2', updatedAt: 1, documentCount: 1, watching: false }], 'c2',
    );
    await expect(joining).resolves.toBeNull();
    expect(createCollabSession).not.toHaveBeenCalled();
    expect(useCollabStore.getState()).toMatchObject({ session: null, status: 'idle', shareNotes: false });
  });

  it.each(['startSession', 'joinSession'] as const)('destroys a pending %s while note hydration is waiting', async (method) => {
    useCorpusStore.getState().setLocalState(
      [{ id: 'c1', name: 'C', updatedAt: 1, documentCount: 1, watching: false }], 'c1',
    );
    let finishLoad!: (record: CorpusRecord) => void;
    vi.mocked(getCorpusRecord).mockReturnValueOnce(new Promise((resolve) => { finishLoad = resolve; }));
    useCollabStore.getState().setShareNotes(true);
    const joining = useCollabStore.getState()[method]('room-loading', 'key-loading');
    await vi.waitFor(() => expect(getCorpusRecord).toHaveBeenCalledOnce());
    const session = vi.mocked(createCollabSession).mock.results[0].value;

    useSettingsStore.getState().setOfflineMode(true);
    expect(session.provider!.destroy).toHaveBeenCalledOnce();
    useSettingsStore.getState().setOfflineMode(false);
    finishLoad(corpusRecord('c1', {
      'doc-1': { note: 'late private note', tags: [], pinned: false, updatedAt: 10 },
    }));
    await expect(joining).resolves.toBeNull();
    expect(session.annotations.size).toBe(0);
    expect(useCollabStore.getState()).toMatchObject({ session: null, status: 'idle', shareNotes: false });
  });

  it.each(['startSession', 'joinSession'] as const)('honors notes off then on while %s waits for hydration', async (method) => {
    useCorpusStore.getState().setLocalState(
      [{ id: 'c1', name: 'C', updatedAt: 1, documentCount: 1, watching: false }], 'c1',
    );
    let finishLoad!: (record: CorpusRecord) => void;
    vi.mocked(getCorpusRecord).mockReturnValueOnce(new Promise((resolve) => { finishLoad = resolve; }));
    useCollabStore.getState().setShareNotes(true);
    const joining = useCollabStore.getState()[method]('room-retoggle', 'key-retoggle');
    await vi.waitFor(() => expect(getCorpusRecord).toHaveBeenCalledOnce());
    expect(useCollabStore.getState()).toMatchObject({ session: null, status: 'connecting' });
    useCollabStore.getState().setShareNotes(false);
    useCollabStore.getState().setShareNotes(true);
    finishLoad(corpusRecord('c1', {
      'doc-1': { note: 'loaded note', tags: [], pinned: false, updatedAt: 10 },
    }));

    await expect(joining).resolves.toBe('#collab=v1.room-retoggle.key-retoggle');
    const session = useCollabStore.getState().session!;
    await vi.waitFor(() => expect(session.annotations.get('doc-1')?.note).toBe('loaded note'));
    expect(useCollabStore.getState().shareNotes).toBe(true);
    expect(getCorpusRecord).toHaveBeenCalledOnce();
    useAnnotationStore.getState().update('doc-1', { note: 'edit after connection' });
    expect(session.annotations.get('doc-1')?.note).toBe('edit after connection');
  });

  it('closes sharing on a workspace switch before incoming notes hydrate or remote edits arrive', async () => {
    const corpora = ['c1', 'c2'].map((id) => ({ id, name: id, updatedAt: 1, documentCount: 1, watching: false }));
    useCorpusStore.getState().setLocalState(corpora, 'c1');
    await ensureAnnotationsLoaded('c1');
    useCollabStore.getState().setShareNotes(true);
    await useCollabStore.getState().startSession('room-c1', 'key-c1');
    const session = useCollabStore.getState().session!;

    useCorpusStore.getState().setSwitching(true);
    expect(session.provider!.destroy).toHaveBeenCalledOnce();
    expect(useCollabStore.getState()).toMatchObject({ session: null, shareNotes: false });
    useCorpusStore.getState().setLocalState(corpora, 'c2');
    useGraphStore.getState().reset();
    useGraphStore.getState().addNodes([{ ...doc('doc-2'), path: 'private/b.pdf' }]);
    useCorpusStore.getState().setSwitching(false);
    vi.mocked(getCorpusRecord).mockResolvedValueOnce(corpusRecord('c2', {
      'private/b.pdf': { note: 'workspace B secret', tags: [], pinned: false, updatedAt: 20 },
    }));
    await ensureAnnotationsLoaded('c2');

    expect(JSON.stringify(session.annotations.toJSON())).not.toContain('workspace B secret');
    session.annotations.set('doc-2', { note: 'stale peer edit', tags: [], pinned: false, updatedAt: 30 });
    expect(useAnnotationStore.getState().annotations['private/b.pdf'].note).toBe('workspace B secret');
  });

  it('guards the annotation scope even if hydration changes without a corpus transition', async () => {
    useCorpusStore.getState().setLocalState(
      [{ id: 'c1', name: 'C', updatedAt: 1, documentCount: 1, watching: false }], 'c1',
    );
    await ensureAnnotationsLoaded('c1');
    useCollabStore.getState().setShareNotes(true);
    await useCollabStore.getState().startSession('room-scoped', 'key-scoped');
    const session = useCollabStore.getState().session!;
    useAnnotationStore.getState().hydrate('c2', {
      'doc-1': { note: 'other workspace note', tags: [], pinned: false, updatedAt: 20 },
    });
    expect(session.annotations.get('doc-1')?.note).toBe('secret note');
    session.annotations.set('doc-1', { note: 'remote note', tags: [], pinned: false, updatedAt: 30 });
    expect(useAnnotationStore.getState().annotations['doc-1'].note).toBe('other workspace note');
  });

  it('omits orphan annotation paths on initial sharing and subsequent changes', async () => {
    useCorpusStore.getState().setLocalState(
      [{ id: 'c1', name: 'C', updatedAt: 1, documentCount: 1, watching: false }], 'c1',
    );
    const removedPath = '/Users/secret-user/Private/removed.pdf';
    useAnnotationStore.getState().hydrate('c1', {
      [removedPath]: { note: 'removed document note', tags: [], pinned: false, updatedAt: 10 },
      'doc-1': { note: 'visible note', tags: [], pinned: false, updatedAt: 10 },
    });
    useCollabStore.getState().setShareNotes(true);
    await useCollabStore.getState().startSession('room-orphans', 'key-orphans');
    const session = useCollabStore.getState().session!;
    expect([...session.annotations.keys()]).toEqual(['doc-1']);
    useAnnotationStore.getState().update(removedPath, { note: 'still private' });
    expect(JSON.stringify(session.annotations.toJSON())).not.toContain(removedPath);
    expect(JSON.stringify(session.annotations.toJSON())).not.toContain('still private');
  });
});
