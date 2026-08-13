import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { useAnnotationStore, _resetAnnotationsForTests } from '../store/annotationStore';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';
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

vi.mock('../persistence/corpusRepository', () => ({
  getCorpusRecord: vi.fn(async () => ({
    annotations: {
      'doc-1': { note: 'secret note', tags: ['private'], pinned: false, updatedAt: 10 },
    },
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
    resetPositionBuffer();
    useGraphStore.getState().reset();
    _resetAnnotationsForTests();
    useCorpusStore.getState().reset();
    useCollabStore.getState().leaveSession();
    useUiStore.setState({
      selectedId: 'local-sla',
      dims: 3,
      topicNodesEnabled: false,
      clusterCollapsed: false,
      filter: { ...DEFAULT_FILTER },
    });
  });

  afterEach(() => {
    useCollabStore.getState().leaveSession();
    _resetAnnotationsForTests();
    useCorpusStore.getState().reset();
    resetPositionBuffer();
    useGraphStore.getState().reset();
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
});
