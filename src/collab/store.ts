import { create } from 'zustand';
import { useUiStore } from '../store/uiStore';
import {
  buildCollabInvite,
  createCollabSession,
  destroyCollabSession,
  parseCollabInvite,
  type CollabSession,
} from './session';

export interface CollabPeer {
  id: string;
  displayName?: string;
  cursor?: { x: number; y: number; z: number } | null;
  selectedId?: string | null;
  camera?: Record<string, number> | null;
}

interface CollaborationState {
  session: CollabSession | null;
  roomId: string | null;
  sessionKey: string | null;
  invite: string | null;
  status: 'idle' | 'connecting' | 'connected';
  peers: Record<string, CollabPeer>;
  startSession: (roomId?: string, sessionKey?: string) => string | null;
  joinSession: (roomId: string, sessionKey: string) => string | null;
  joinInvite: (invite: string) => string | null;
  leaveSession: () => void;
  setLocalPresence: (patch: Partial<CollabPeer>) => void;
  refreshPeers: () => void;
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

export const useCollabStore = create<CollaborationState>((set, get) => ({
  session: null,
  roomId: null,
  sessionKey: null,
  invite: null,
  status: 'idle',
  peers: {},

  startSession: (roomId, sessionKey) => {
    const nextRoom = roomId ?? `graph-${Math.random().toString(36).slice(2, 10)}`;
    const nextKey = sessionKey ?? Math.random().toString(36).slice(2, 12);
    const session = createCollabSession({ roomId: nextRoom, sessionKey: nextKey });
    const invite = buildCollabInvite(nextRoom, nextKey);
    session.provider?.awareness.on('change', () => {
      set({ peers: collectPeers(session) });
    });
    session.provider?.awareness.setLocalState({
      displayName: 'You',
      cursor: null,
      selectedId: useUiStore.getState().selectedId,
      camera: null,
    });
    set({
      session,
      roomId: nextRoom,
      sessionKey: nextKey,
      invite,
      status: 'connected',
      peers: collectPeers(session),
    });
    return invite;
  },

  joinSession: (roomId, sessionKey) => {
    const current = get();
    if (current.session) {
      get().leaveSession();
    }
    const session = createCollabSession({ roomId, sessionKey });
    const invite = buildCollabInvite(roomId, sessionKey);
    session.provider?.awareness.on('change', () => {
      set({ peers: collectPeers(session) });
    });
    session.provider?.awareness.setLocalState({
      displayName: 'You',
      cursor: null,
      selectedId: useUiStore.getState().selectedId,
      camera: null,
    });
    set({
      session,
      roomId,
      sessionKey,
      invite,
      status: 'connected',
      peers: collectPeers(session),
    });
    return invite;
  },

  joinInvite: (invite) => {
    const config = parseCollabInvite(invite);
    if (!config) return null;
    return get().joinSession(config.roomId, config.sessionKey);
  },

  leaveSession: () => {
    const { session } = get();
    if (!session) {
      set({ roomId: null, sessionKey: null, invite: null, status: 'idle', peers: {} });
      return;
    }
    destroyCollabSession(session);
    set({ session: null, roomId: null, sessionKey: null, invite: null, status: 'idle', peers: {} });
  },

  setLocalPresence: (patch) => {
    const { session } = get();
    if (!session?.provider) return;
    const current = session.provider.awareness.getLocalState() ?? {};
    session.provider.awareness.setLocalState({
      ...current,
      ...patch,
      displayName: typeof patch.displayName === 'string' ? patch.displayName : current.displayName ?? 'You',
      selectedId: typeof patch.selectedId === 'string' ? patch.selectedId : current.selectedId ?? null,
      camera: patch.camera ?? current.camera ?? null,
      cursor: patch.cursor ?? current.cursor ?? null,
    });
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
