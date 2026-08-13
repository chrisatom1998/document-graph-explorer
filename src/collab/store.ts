import { create } from 'zustand';
import type { YMapEvent } from 'yjs';
import { layoutEpoch, layoutSetDims, layoutSettledEpoch, onLayoutSettled } from '../layout/layoutBridge';
import { cameraPose } from '../scene/cameraPose';
import { useGraphStore } from '../store/graphStore';
import { useUiStore, type CameraPose, type GraphFilter } from '../store/uiStore';
import type { DocAnnotationRecord } from '../persistence/db';
import type { EdgeKind, FileType } from '../model/types';
import type { CollabSession } from './session';
import {
  buildFollowDebugSnapshot,
  computeCollabCameraAnchor,
  parseCameraAnchor,
  remapCameraPose,
  type CollabCameraAnchor,
} from './viewFrame';

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
  filter?: GraphFilter;
  camera?: CameraPose;
  cameraAnchor?: CollabCameraAnchor;
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

function cloneFilter(filter: GraphFilter): GraphFilter {
  return {
    fileTypes: filter.fileTypes ? [...filter.fileTypes] : null,
    clusters: filter.clusters ? [...filter.clusters] : null,
    minDegree: filter.minDegree,
    minEdgeWeight: filter.minEdgeWeight,
    edgeKinds: filter.edgeKinds ? [...filter.edgeKinds] : null,
    modifiedWithinDays: filter.modifiedWithinDays,
  };
}

/** Stable semantic compare for follow-mode divergence detection. */
export function graphFiltersEqual(a: GraphFilter, b: GraphFilter): boolean {
  return JSON.stringify(cloneFilter(a)) === JSON.stringify(cloneFilter(b));
}

function readLocalCameraPose(): CameraPose {
  return {
    px: cameraPose.px,
    py: cameraPose.py,
    pz: cameraPose.pz,
    tx: cameraPose.tx,
    ty: cameraPose.ty,
    tz: cameraPose.tz,
  };
}

function readLocalCameraAnchor(selectedId: string | null, filter: GraphFilter): CollabCameraAnchor | undefined {
  const graph = useGraphStore.getState();
  return computeCollabCameraAnchor({
    selectedId,
    filter,
    nodes: graph.nodes,
    edges: graph.edges,
  }) ?? undefined;
}

function readSharedView(): CollabSharedView {
  const ui = useUiStore.getState();
  const next: CollabSharedView = {
    dims: ui.dims,
    selectedId: ui.selectedId,
    topicNodesEnabled: ui.topicNodesEnabled,
    clusterCollapsed: ui.clusterCollapsed,
    filter: cloneFilter(ui.filter),
    camera: readLocalCameraPose(),
    cameraAnchor: readLocalCameraAnchor(ui.selectedId, ui.filter),
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

interface PendingRemoteCamera {
  pose: CameraPose;
  anchor?: CollabCameraAnchor;
  requireFollow: boolean;
}

let queuedRemoteCamera: PendingRemoteCamera | null = null;
let pendingSettleCamera: PendingRemoteCamera | null = null;
let stopSettleWait: (() => void) | null = null;
let lastFollowDebugAt = 0;

/** Cancel rAF/settle-queued remote poses. Exported for unit tests. */
export function clearDeferredRemoteCameras(): void {
  queuedRemoteCamera = null;
  pendingSettleCamera = null;
  if (stopSettleWait) {
    stopSettleWait();
    stopSettleWait = null;
  }
}

function resolveLocalFollowPose(pending: PendingRemoteCamera): CameraPose {
  if (!pending.anchor) return pending.pose;
  const ui = useUiStore.getState();
  const graph = useGraphStore.getState();
  const localAnchor = computeCollabCameraAnchor({
    selectedId: ui.selectedId,
    preferId: pending.anchor.id,
    filter: ui.filter,
    nodes: graph.nodes,
    edges: graph.edges,
  });
  if (!localAnchor) return pending.pose;
  return remapCameraPose(pending.pose, pending.anchor, localAnchor);
}

function deliverRemoteCameraPose(pending: PendingRemoteCamera): void {
  const { session, followMode } = useCollabStore.getState();
  if (!session) return;
  if (pending.requireFollow && !followMode) return;
  useUiStore.getState().sendCameraPose(resolveLocalFollowPose(pending));
}

function scheduleRemoteCameraPose(
  pose: CameraPose | null,
  anchor: CollabCameraAnchor | undefined,
  opts: { waitForSettle?: boolean } = {},
): void {
  if (!pose) return;
  const pending: PendingRemoteCamera = {
    pose,
    anchor,
    requireFollow: useCollabStore.getState().followMode,
  };

  // While a dims-driven settle is outstanding, keep coalescing into that
  // callback instead of also firing a same-frame rAF pose against mid-flatten
  // coordinates.
  if (opts.waitForSettle || stopSettleWait) {
    pendingSettleCamera = pending;
    // Drop any camera-only rAF already scheduled; it would apply against
    // mid-transition coordinates before the post-settle pose.
    queuedRemoteCamera = null;
    if (opts.waitForSettle) {
      // Re-arm for THIS setDims. Ignore settles tagged with an older epoch
      // (already-queued cooling, or a previous dims toggle still in flight).
      const minEpoch = layoutEpoch();
      stopSettleWait?.();
      stopSettleWait = onLayoutSettled(() => {
        if (layoutSettledEpoch() < minEpoch) return;
        stopSettleWait?.();
        stopSettleWait = null;
        const settled = pendingSettleCamera;
        pendingSettleCamera = null;
        if (!settled) return;
        deliverRemoteCameraPose(settled);
      });
    }
    return;
  }

  queuedRemoteCamera = pending;
  const run = () => {
    const next = queuedRemoteCamera;
    queuedRemoteCamera = null;
    if (!next) return;
    deliverRemoteCameraPose(next);
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(run);
    return;
  }
  setTimeout(run, 0);
}

function maybeLogFollowDebug(
  remote: CollabSharedView,
  localUi: ReturnType<typeof useUiStore.getState>,
): void {
  if (!import.meta.env.DEV) return;
  if (typeof window === 'undefined') return;
  const enabled = (window as Window & { __nebulaFollowDebug?: boolean }).__nebulaFollowDebug;
  if (!enabled) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastFollowDebugAt < 1000) return;
  lastFollowDebugAt = now;
  const graph = useGraphStore.getState();
  const local = buildFollowDebugSnapshot({
    dims: localUi.dims,
    selectedId: localUi.selectedId,
    filter: localUi.filter,
    nodes: graph.nodes,
    edges: graph.edges,
    cameraPose: readLocalCameraPose(),
  });
  console.info('[collab-follow]', {
    remote: {
      dims: remote.dims,
      selectedId: remote.selectedId,
      cameraPose: remote.camera,
      cameraAnchor: remote.cameraAnchor,
    },
    local,
  });
}

/** Apply a remote shared-view snapshot. Exported for unit tests. */
export function applySharedView(view: Partial<Record<string, unknown>>): void {
  const ui = useUiStore.getState();
  const remoteFilter = sanitizeSharedFilter(view.filter);
  const remoteCamera = parseCameraPose(view.camera);
  const remoteAnchor = parseCameraAnchor(view.cameraAnchor);
  const nextDims =
    typeof view.dims === 'number' && (view.dims === 2 || view.dims === 3) ? view.dims : undefined;
  const nextSelectedId =
    'selectedId' in view ? (typeof view.selectedId === 'string' ? view.selectedId : null) : undefined;
  const nextTopicNodes =
    'topicNodesEnabled' in view && typeof view.topicNodesEnabled === 'boolean'
      ? view.topicNodesEnabled
      : undefined;
  const nextCollapsed =
    'clusterCollapsed' in view && typeof view.clusterCollapsed === 'boolean'
      ? view.clusterCollapsed
      : undefined;

  let dimsChanged = false;
  if (nextDims !== undefined && nextDims !== ui.dims) {
    ui.setDims(nextDims);
    layoutSetDims(nextDims);
    dimsChanged = true;
  }
  if (nextSelectedId !== undefined && nextSelectedId !== ui.selectedId) {
    ui.setSelected(nextSelectedId);
  }
  if (nextTopicNodes !== undefined && nextTopicNodes !== ui.topicNodesEnabled) {
    ui.setTopicNodes(nextTopicNodes);
  }
  if (nextCollapsed !== undefined && nextCollapsed !== ui.clusterCollapsed) {
    ui.setClusterCollapsed(nextCollapsed);
  }
  if (remoteFilter) {
    const merged = { ...ui.filter, ...remoteFilter };
    if (!graphFiltersEqual(ui.filter, merged)) {
      ui.setFilter(remoteFilter);
    }
  }

  const appliedUi = useUiStore.getState();
  const applied: CollabSharedView = {
    dims: appliedUi.dims,
    selectedId: appliedUi.selectedId,
    topicNodesEnabled: appliedUi.topicNodesEnabled,
    clusterCollapsed: appliedUi.clusterCollapsed,
    filter: cloneFilter(appliedUi.filter),
    camera: remoteCamera,
    cameraAnchor: remoteAnchor,
  };
  useCollabStore.setState({ lastRemoteView: applied });
  maybeLogFollowDebug(applied, appliedUi);
  scheduleRemoteCameraPose(remoteCamera ?? null, remoteAnchor, { waitForSettle: dimsChanged });
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
    clearDeferredRemoteCameras();
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
    if (!enabled) clearDeferredRemoteCameras();
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
    session.doc.transact(() => {
      map.set('dims', view.dims ?? useUiStore.getState().dims);
      map.set('selectedId', view.selectedId ?? null);
      map.set('topicNodesEnabled', view.topicNodesEnabled ?? useUiStore.getState().topicNodesEnabled);
      map.set('clusterCollapsed', view.clusterCollapsed ?? useUiStore.getState().clusterCollapsed);
      map.set('filter', view.filter ?? useUiStore.getState().filter);
      map.set('camera', view.camera ?? null);
      map.set('cameraAnchor', view.cameraAnchor ?? null);
    });
    set({ lastRemoteView: { ...view } });
  },

  syncCameraPose: () => {
    const { session, followMode } = get();
    if (!session || followMode) return;
    const ui = useUiStore.getState();
    const pose = readLocalCameraPose();
    const anchor = readLocalCameraAnchor(ui.selectedId, ui.filter) ?? null;
    session.doc.transact(() => {
      session.view.set('camera', pose);
      session.view.set('cameraAnchor', anchor);
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
