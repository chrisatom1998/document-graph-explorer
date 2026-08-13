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

export const useCollabStore = create<CollaborationState>((set, get) => ({
  session: null,
  roomId: null,
  sessionKey: null,
  invite: null,
  status: 'idle',
  peers: {},

  startSession: (roomId, sessionKey) => {
    if (get().session) {
      get().leaveSession();
    }
    const nextRoom = roomId ?? `graph-${randomCollabToken(8)}`;
    const nextKey = sessionKey ?? randomCollabToken(16);
    const session = createCollabSession({ roomId: nextRoom, sessionKey: nextKey });
    const invite = buildCollabInvite(session.roomId, session.sessionKey);
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
      roomId: session.roomId,
      sessionKey: session.sessionKey,
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
    const invite = buildCollabInvite(session.roomId, session.sessionKey);
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
      roomId: session.roomId,
      sessionKey: session.sessionKey,
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
    const next = { ...current, ...patch };
    session.provider.awareness.setLocalState({
      ...next,
      displayName: typeof next.displayName === 'string' ? next.displayName : 'You',
      selectedId: typeof next.selectedId === 'string' ? next.selectedId : null,
      camera: next.camera && typeof next.camera === 'object' ? next.camera : null,
      cursor: next.cursor && typeof next.cursor === 'object' ? next.cursor : null,
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
