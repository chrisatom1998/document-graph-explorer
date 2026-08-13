import { create } from 'zustand';
import { useUiStore, type GraphFilter } from '../store/uiStore';
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
  refreshPeers: () => void;
}

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
  };
  return next;
}

function applySharedView(view: Partial<Record<string, unknown>>): void {
  const ui = useUiStore.getState();
  const next: CollabSharedView = {
    dims: typeof view.dims === 'number' && (view.dims === 2 || view.dims === 3) ? view.dims : undefined,
    selectedId: 'selectedId' in view ? (typeof view.selectedId === 'string' ? view.selectedId : null) : undefined,
    topicNodesEnabled: 'topicNodesEnabled' in view && typeof view.topicNodesEnabled === 'boolean' ? view.topicNodesEnabled : undefined,
    clusterCollapsed: 'clusterCollapsed' in view && typeof view.clusterCollapsed === 'boolean' ? view.clusterCollapsed : undefined,
    filter: view.filter && typeof view.filter === 'object' ? (view.filter as Partial<GraphFilter>) : undefined,
  };
  if (next.dims !== undefined) ui.setDims(next.dims);
  if (next.selectedId !== undefined) ui.setSelected(next.selectedId);
  if (next.topicNodesEnabled !== undefined) ui.setTopicNodes(next.topicNodesEnabled);
  if (next.clusterCollapsed !== undefined) ui.setClusterCollapsed(next.clusterCollapsed);
  if (next.filter) ui.setFilter(next.filter);
  useCollabStore.setState({ lastRemoteView: next });
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
    set({ lastRemoteView: { ...view } });
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
