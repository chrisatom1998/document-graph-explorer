import { create } from 'zustand';
import type { YMapEvent } from 'yjs';
import { layoutSetDims } from '../layout/layoutBridge';
import { cameraPose } from '../scene/cameraPose';
import { useUiStore, type CameraPose, type GraphFilter } from '../store/uiStore';
import type { DocAnnotationRecord } from '../persistence/db';
import type { EdgeKind, FileType } from '../model/types';
import type { CollabSession } from './session';

export interface CollabPeer {
  id: string;
  displayName?: string;
  cursor?: { x: number; y: number; z: number } | null;
  selectedId?: string | null;
  camera?: Record<string, number> | null;
}

export interface CollabSharedView {
  dims?: 2 | 3;
  selectedId?: string | null;
  topicNodesEnabled?: boolean;
  clusterCollapsed?: boolean;
  filter?: Partial<GraphFilter>;
  camera?: CameraPose;
}

interface CollaborationState {
  session: CollabSession | null;
  roomId: string | null;
  sessionKey: string | null;
  invite: string | null;
  status: 'idle' | 'connecting' | 'connected';
  peers: Record<string, CollabPeer>;
  followMode: boolean;
  lastRemoteView: CollabSharedView | null;
  startSession: (roomId?: string, sessionKey?: string) => Promise<string | null>;
  joinSession: (roomId: string, sessionKey: string) => Promise<string | null>;
  joinInvite: (invite: string) => Promise<string | null>;
  leaveSession: () => void;
  setLocalPresence: (patch: Partial<CollabPeer>) => void;
  setFollowMode: (enabled: boolean) => void;
  syncSharedView: () => void;
  syncCameraPose: () => void;
  refreshPeers: () => void;
}

let stopAnnotationSync: (() => void) | null = null;

function randomCollabToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function collectPeers(session: CollabSession): Record<string, CollabPeer> {
  const next: Record<string, CollabPeer> = {};
  const states = session.provider?.awareness.getStates() ?? new Map();
  for (const [clientId, state] of states.entries()) {
    const peer = state as Partial<CollabPeer> & { displayName?: string };
    next[String(clientId)] = {
      id: String(clientId),
      displayName: typeof peer.displayName === 'string' ? peer.displayName : 'Peer',
      cursor: peer.cursor && typeof peer.cursor === 'object' ? peer.cursor : null,
      selectedId: typeof peer.selectedId === 'string' ? peer.selectedId : null,
      camera: peer.camera && typeof peer.camera === 'object' ? peer.camera : null,
    };
  }
  return next;
}

function readSharedView(): CollabSharedView {
  const ui = useUiStore.getState();
  const next: CollabSharedView = {
    dims: ui.dims,
    selectedId: ui.selectedId,
    topicNodesEnabled: ui.topicNodesEnabled,
    clusterCollapsed: ui.clusterCollapsed,
    filter: { ...ui.filter },
    camera: {
      px: cameraPose.px,
      py: cameraPose.py,
      pz: cameraPose.pz,
      tx: cameraPose.tx,
      ty: cameraPose.ty,
      tz: cameraPose.tz,
    },
  };
  return next;
}

function parseCameraPose(value: unknown): CameraPose | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<Record<keyof CameraPose, unknown>>;
  const keys: (keyof CameraPose)[] = ['px', 'py', 'pz', 'tx', 'ty', 'tz'];
  if (!keys.every((key) => typeof source[key] === 'number' && Number.isFinite(source[key]))) {
    return undefined;
  }
  return {
    px: source.px as number,
    py: source.py as number,
    pz: source.pz as number,
    tx: source.tx as number,
    ty: source.ty as number,
    tz: source.tz as number,
  };
}

const FILE_TYPES = new Set<FileType>([
  'md', 'txt', 'pdf', 'html', 'json', 'yaml', 'csv', 'docx', 'pptx', 'xlsx', 'code', 'other',
]);
const EDGE_KINDS = new Set<EdgeKind>(['reference', 'semantic', 'keyword', 'entity', 'topic']);

export function sanitizeSharedFilter(value: unknown): Partial<GraphFilter> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const next: Partial<GraphFilter> = {};
  let found = false;

  if (Object.hasOwn(source, 'fileTypes')) {
    const fileTypes = source.fileTypes;
    if (fileTypes === null) {
      next.fileTypes = null;
      found = true;
    } else if (Array.isArray(fileTypes) && fileTypes.every((item): item is FileType => FILE_TYPES.has(item as FileType))) {
      next.fileTypes = [...fileTypes];
      found = true;
    }
  }
  if (Object.hasOwn(source, 'clusters')) {
    const clusters = source.clusters;
    if (clusters === null) {
      next.clusters = null;
      found = true;
    } else if (Array.isArray(clusters) && clusters.every((item) => Number.isInteger(item))) {
      next.clusters = [...clusters] as number[];
      found = true;
    }
  }
  if (Object.hasOwn(source, 'minDegree') && typeof source.minDegree === 'number' && Number.isFinite(source.minDegree) && source.minDegree >= 0) {
    next.minDegree = source.minDegree;
    found = true;
  }
  if (Object.hasOwn(source, 'minEdgeWeight') && typeof source.minEdgeWeight === 'number' && Number.isFinite(source.minEdgeWeight) && source.minEdgeWeight >= 0 && source.minEdgeWeight <= 1) {
    next.minEdgeWeight = source.minEdgeWeight;
    found = true;
  }
  if (Object.hasOwn(source, 'edgeKinds')) {
    const edgeKinds = source.edgeKinds;
    if (edgeKinds === null) {
      next.edgeKinds = null;
      found = true;
    } else if (Array.isArray(edgeKinds) && edgeKinds.every((item): item is EdgeKind => EDGE_KINDS.has(item as EdgeKind))) {
      next.edgeKinds = [...edgeKinds];
      found = true;
    }
  }
  if (Object.hasOwn(source, 'modifiedWithinDays')) {
    const days = source.modifiedWithinDays;
    if (days === null) {
      next.modifiedWithinDays = null;
      found = true;
    } else if (typeof days === 'number' && Number.isFinite(days) && days >= 0) {
      next.modifiedWithinDays = days;
      found = true;
    }
  }
  return found ? next : undefined;
}

let queuedRemoteCameraPose: CameraPose | null = null;

function scheduleRemoteCameraPose(pose: CameraPose | null): void {
  if (!pose) return;
  queuedRemoteCameraPose = pose;
  const run = () => {
    const pending = queuedRemoteCameraPose;
    queuedRemoteCameraPose = null;
    if (!pending) return;
    useUiStore.getState().sendCameraPose(pending);
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(run);
    return;
  }
  setTimeout(run, 0);
}

function applySharedView(view: Partial<Record<string, unknown>>): void {
  const ui = useUiStore.getState();
  const next: CollabSharedView = {
    dims: typeof view.dims === 'number' && (view.dims === 2 || view.dims === 3) ? view.dims : undefined,
    selectedId: 'selectedId' in view ? (typeof view.selectedId === 'string' ? view.selectedId : null) : undefined,
    topicNodesEnabled: 'topicNodesEnabled' in view && typeof view.topicNodesEnabled === 'boolean' ? view.topicNodesEnabled : undefined,
    clusterCollapsed: 'clusterCollapsed' in view && typeof view.clusterCollapsed === 'boolean' ? view.clusterCollapsed : undefined,
    filter: sanitizeSharedFilter(view.filter),
    camera: parseCameraPose(view.camera),
  };
  if (next.dims !== undefined) {
    ui.setDims(next.dims);
    layoutSetDims(next.dims);
  }
  if (next.selectedId !== undefined) ui.setSelected(next.selectedId);
  if (next.topicNodesEnabled !== undefined) ui.setTopicNodes(next.topicNodesEnabled);
  if (next.clusterCollapsed !== undefined) ui.setClusterCollapsed(next.clusterCollapsed);
  if (next.filter) ui.setFilter(next.filter);
  scheduleRemoteCameraPose(next.camera ?? null);
  useCollabStore.setState({ lastRemoteView: next });
}

function annotationTimestamp(value: DocAnnotationRecord | undefined): number {
  return value && typeof value.updatedAt === 'number' ? value.updatedAt : 0;
}

async function bindAnnotationSync(session: CollabSession): Promise<() => void> {
  const [{ ensureAnnotationsLoaded, useAnnotationStore }, { useCorpusStore }] = await Promise.all([
    import('../store/annotationStore'),
    import('../store/corpusStore'),
  ]);
  const corpus = useCorpusStore.getState();
  if (corpus.mode !== 'local' || !corpus.activeCorpusId) return () => undefined;
  await ensureAnnotationsLoaded(corpus.activeCorpusId);
  if (useAnnotationStore.getState().scope !== corpus.activeCorpusId) return () => undefined;

  const map = session.annotations;
  let applyingRemote = false;

  const applyMapChange = (key: string): void => {
    const remote = map.get(key);
    const local = useAnnotationStore.getState().annotations[key];
    if (remote && local && annotationTimestamp(local) > annotationTimestamp(remote)) {
      map.set(key, local);
      return;
    }
    applyingRemote = true;
    try {
      useAnnotationStore.getState().applyRemote(key, remote ?? null);
    } finally {
      applyingRemote = false;
    }
  };

  const onRemoteChange = (event: YMapEvent<DocAnnotationRecord>): void => {
    for (const key of event.changes.keys.keys()) applyMapChange(key);
  };
  map.observe(onRemoteChange);

  const localAtBind = useAnnotationStore.getState().annotations;
  session.doc.transact(() => {
    for (const [key, local] of Object.entries(localAtBind)) {
      const remote = map.get(key);
      if (!remote || annotationTimestamp(local) >= annotationTimestamp(remote)) map.set(key, local);
      else applyMapChange(key);
    }
  });

  const unsubscribe = useAnnotationStore.subscribe((state, previous) => {
    if (applyingRemote || state.annotations === previous.annotations) return;
    const keys = new Set([
      ...Object.keys(previous.annotations),
      ...Object.keys(state.annotations),
    ]);
    session.doc.transact(() => {
      for (const key of keys) {
        const before = previous.annotations[key];
        const after = state.annotations[key];
        if (before === after) continue;
        if (after) map.set(key, after);
        else map.delete(key);
      }
    });
  });

  return () => {
    unsubscribe();
    map.unobserve(onRemoteChange);
  };
}

export const useCollabStore = create<CollaborationState>((set, get) => ({
  session: null,
  roomId: null,
  sessionKey: null,
  invite: null,
  status: 'idle',
  peers: {},
  followMode: false,
  lastRemoteView: null,

  startSession: async (roomId, sessionKey) => {
    if (get().session) {
      get().leaveSession();
    }
    const nextRoom = roomId ?? `graph-${randomCollabToken(8)}`;
    const nextKey = sessionKey ?? randomCollabToken(16);
    set({ status: 'connecting' });
    try {
      const { buildCollabInvite, createCollabSession } = await import('./session');
      const session = createCollabSession({ roomId: nextRoom, sessionKey: nextKey });
      const invite = buildCollabInvite(session.roomId, session.sessionKey);
      stopAnnotationSync = await bindAnnotationSync(session);
      session.provider?.awareness.on('change', () => {
        set({ peers: collectPeers(session) });
      });
      session.view.observe(() => {
        if (!get().followMode) return;
        applySharedView(session.view.toJSON() as Partial<Record<string, unknown>>);
      });
      session.provider?.awareness.setLocalState({
        displayName: 'You',
        cursor: null,
        selectedId: useUiStore.getState().selectedId,
        camera: null,
      });
      set({
        session,
        roomId: session.roomId,
        sessionKey: session.sessionKey,
        invite,
        status: 'connected',
        peers: collectPeers(session),
        followMode: false,
        lastRemoteView: null,
      });
      get().syncSharedView();
      return invite;
    } catch (error) {
      set({ status: 'idle' });
      throw error;
    }
  },

  joinSession: async (roomId, sessionKey) => {
    const current = get();
    if (current.session) {
      get().leaveSession();
    }
    set({ status: 'connecting' });
    try {
      const { buildCollabInvite, createCollabSession } = await import('./session');
      const session = createCollabSession({ roomId, sessionKey });
      const invite = buildCollabInvite(session.roomId, session.sessionKey);
      stopAnnotationSync = await bindAnnotationSync(session);
      session.provider?.awareness.on('change', () => {
        set({ peers: collectPeers(session) });
      });
      session.view.observe(() => {
        if (!get().followMode) return;
        applySharedView(session.view.toJSON() as Partial<Record<string, unknown>>);
      });
      session.provider?.awareness.setLocalState({
        displayName: 'You',
        cursor: null,
        selectedId: useUiStore.getState().selectedId,
        camera: null,
      });
      set({
        session,
        roomId: session.roomId,
        sessionKey: session.sessionKey,
        invite,
        status: 'connected',
        peers: collectPeers(session),
        followMode: false,
        lastRemoteView: null,
      });
      if (session.view.size > 0) {
        applySharedView(session.view.toJSON() as Partial<Record<string, unknown>>);
      }
      return invite;
    } catch (error) {
      set({ status: 'idle' });
      throw error;
    }
  },

  joinInvite: async (invite) => {
    const { parseCollabInvite } = await import('./session');
    const config = parseCollabInvite(invite);
    if (!config) return null;
    return get().joinSession(config.roomId, config.sessionKey);
  },

  leaveSession: () => {
    stopAnnotationSync?.();
    stopAnnotationSync = null;
    const { session } = get();
    if (!session) {
      set({ roomId: null, sessionKey: null, invite: null, status: 'idle', peers: {}, followMode: false, lastRemoteView: null });
      return;
    }
    session.provider?.destroy();
    session.doc.destroy();
    set({ session: null, roomId: null, sessionKey: null, invite: null, status: 'idle', peers: {}, followMode: false, lastRemoteView: null });
  },

  setLocalPresence: (patch) => {
    const { session } = get();
    if (!session?.provider) return;
    const current = session.provider.awareness.getLocalState() ?? {};
    const next = { ...current, ...patch };
    session.provider.awareness.setLocalState({
      ...next,
      displayName: typeof next.displayName === 'string' ? next.displayName : 'You',
      selectedId: typeof next.selectedId === 'string' ? next.selectedId : null,
      camera: next.camera && typeof next.camera === 'object' ? next.camera : null,
      cursor: next.cursor && typeof next.cursor === 'object' ? next.cursor : null,
    });
  },

  setFollowMode: (enabled) => {
    set({ followMode: enabled });
    const { session } = get();
    if (!session) return;
    if (enabled) {
      applySharedView(session.view.toJSON() as Partial<Record<string, unknown>>);
      return;
    }
    get().syncSharedView();
  },

  syncSharedView: () => {
    const { session, followMode } = get();
    if (!session || followMode) return;
    const view = readSharedView();
    const map = session.view;
    map.set('dims', view.dims ?? useUiStore.getState().dims);
    map.set('selectedId', view.selectedId ?? null);
    map.set('topicNodesEnabled', view.topicNodesEnabled ?? useUiStore.getState().topicNodesEnabled);
    map.set('clusterCollapsed', view.clusterCollapsed ?? useUiStore.getState().clusterCollapsed);
    map.set('filter', view.filter ?? useUiStore.getState().filter);
    map.set('camera', view.camera ?? null);
    set({ lastRemoteView: { ...view } });
  },

  syncCameraPose: () => {
    const { session, followMode } = get();
    if (!session || followMode) return;
    session.view.set('camera', {
      px: cameraPose.px,
      py: cameraPose.py,
      pz: cameraPose.pz,
      tx: cameraPose.tx,
      ty: cameraPose.ty,
      tz: cameraPose.tz,
    } satisfies CameraPose);
  },

  refreshPeers: () => {
    const { session } = get();
    if (!session) {
      set({ peers: {} });
      return;
    }
    set({ peers: collectPeers(session) });
  },
}));
