import { create } from 'zustand';
import type { YMapEvent } from 'yjs';
import { layoutEpoch, layoutSetDims, layoutSettledEpoch, onLayoutSettled } from '../layout/layoutBridge';
import { cameraPose } from '../scene/cameraPose';
import { nodesMatchingFilter } from '../scene/emphasis';
import { getNodePosition, idOfSlot, positionBuffer, scaleOfSlot, slotOfId } from '../scene/positionBuffer';
import { clampUpdatedAt } from '../store/annotationSanitize';
import { annotationKey, useAnnotationStore } from '../store/annotationStore';
import { useGraphStore } from '../store/graphStore';
import { useUiStore, type CameraPose, type GraphFilter } from '../store/uiStore';
import type { DocAnnotationRecord } from '../persistence/db';
import type { DocNode, EdgeKind, FileType } from '../model/types';
import type { CollabSession } from './session';
import type { CollabCameraAnchor } from './viewFrame';

const loadViewFrame = () => import('./viewFrame');

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
  selectedTitle?: string | null;
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
  /** Push local notes/tags into the room. Default OFF. */
  shareNotes: boolean;
  lastRemoteView: CollabSharedView | null;
  startSession: (roomId?: string, sessionKey?: string) => Promise<string | null>;
  joinSession: (roomId: string, sessionKey: string) => Promise<string | null>;
  joinInvite: (invite: string) => Promise<string | null>;
  leaveSession: () => void;
  setLocalPresence: (patch: Partial<CollabPeer>) => void;
  setFollowMode: (enabled: boolean) => void;
  setShareNotes: (enabled: boolean) => void;
  syncSharedView: () => void;
  syncCameraPose: () => void;
  refreshPeers: () => void;
}

let stopAnnotationSync: (() => void) | null = null;

const WEAK_KEY_WARNING =
  'This session key is short enough to guess — anyone who finds the room can read and edit shared notes.';

function randomCollabToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function collectPeers(session: CollabSession): Record<string, CollabPeer> {
  const next: Record<string, CollabPeer> = {};
  const awareness = session.provider?.awareness;
  const states = awareness?.getStates() ?? new Map();
  const localId = awareness?.clientID;
  for (const [clientId, state] of states.entries()) {
    if (localId !== undefined && clientId === localId) continue;
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

function parseCameraAnchor(value: unknown): CollabCameraAnchor | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const hasFinite = ['x', 'y', 'z', 'radius', 'count'].every((key) => {
    const v = source[key];
    return typeof v === 'number' && Number.isFinite(v);
  });
  if (!hasFinite) return undefined;
  if (source.radius !== undefined && Number(source.radius) < 0) return undefined;
  if (source.count !== undefined && Number(source.count) < 0) return undefined;
  const id = source.id === null ? null : typeof source.id === 'string' ? source.id : undefined;
  if (id === undefined) return undefined;
  const title = source.title === null || typeof source.title === 'string' ? source.title : undefined;
  return {
    id,
    title,
    x: Number(source.x),
    y: Number(source.y),
    z: Number(source.z),
    radius: Number(source.radius),
    count: Math.floor(Number(source.count)),
  };
}

function resolveFollowNodeId(
  nodes: DocNode[],
  remoteId: string | null | undefined,
  hints?: { title?: string | null },
): string | null {
  if (remoteId && (nodes.some((node) => node.id === remoteId) || slotOfId.has(remoteId))) return remoteId;
  const unique = (matches: DocNode[]): string | null => {
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
      const docs = matches.filter((node) => node.kind === 'document');
      if (docs.length === 1) return docs[0].id;
    }
    return null;
  };
  if (hints?.title) {
    const byTitle = unique(nodes.filter((node) => node.title === hints.title));
    if (byTitle) return byTitle;
  }
  return null;
}

function computeCentroidAnchor(ids: Iterable<string> | null): CollabCameraAnchor | null {
  const arr = positionBuffer.array;
  const count = positionBuffer.count;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let n = 0;

  const accumulate = (id: string): void => {
    const slot = slotOfId.get(id);
    if (slot === undefined || slot >= count) return;
    const i = slot * 3;
    if (i + 2 >= arr.length) return;
    cx += arr[i];
    cy += arr[i + 1];
    cz += arr[i + 2];
    n++;
  };

  if (ids) {
    for (const id of ids) accumulate(id);
  } else {
    for (let slot = 0; slot < count; slot++) {
      const id = idOfSlot[slot];
      if (!id) continue;
      accumulate(id);
    }
  }

  if (n === 0) return null;
  cx /= n;
  cy /= n;
  cz /= n;

  let sumSq = 0;
  const accumulateRadius = (id: string): void => {
    const slot = slotOfId.get(id);
    if (slot === undefined || slot >= count) return;
    const i = slot * 3;
    if (i + 2 >= arr.length) return;
    const dx = arr[i] - cx;
    const dy = arr[i + 1] - cy;
    const dz = arr[i + 2] - cz;
    sumSq += dx * dx + dy * dy + dz * dz;
  };

  if (ids) {
    for (const id of ids) accumulateRadius(id);
  } else {
    for (let slot = 0; slot < count; slot++) {
      const id = idOfSlot[slot];
      if (!id) continue;
      accumulateRadius(id);
    }
  }

  return {
    id: null,
    x: cx,
    y: cy,
    z: cz,
    radius: Math.sqrt(sumSq / n),
    count: n,
  };
}

function remapCameraPose(remotePose: CameraPose, remoteAnchor: CollabCameraAnchor, localAnchor: CollabCameraAnchor): CameraPose {
  const sameAnchorIdentity =
    remoteAnchor.id === localAnchor.id ||
    (remoteAnchor.title != null && remoteAnchor.title === localAnchor.title);
  if (!sameAnchorIdentity) return { ...remotePose };

  const dx = localAnchor.x - remoteAnchor.x;
  const dy = localAnchor.y - remoteAnchor.y;
  const dz = localAnchor.z - remoteAnchor.z;

  let px = remotePose.px + dx;
  let py = remotePose.py + dy;
  let pz = remotePose.pz + dz;
  let tx = remotePose.tx + dx;
  let ty = remotePose.ty + dy;
  let tz = remotePose.tz + dz;

  const kindsMatch = (remoteAnchor.id == null) === (localAnchor.id == null);
  if (kindsMatch && remoteAnchor.radius > 1e-3 && localAnchor.radius > 1e-3) {
    const scale = localAnchor.radius / remoteAnchor.radius;
    if (Number.isFinite(scale) && Math.abs(scale - 1) > 1e-6) {
      px = localAnchor.x + (px - localAnchor.x) * scale;
      py = localAnchor.y + (py - localAnchor.y) * scale;
      pz = localAnchor.z + (pz - localAnchor.z) * scale;
      tx = localAnchor.x + (tx - localAnchor.x) * scale;
      ty = localAnchor.y + (ty - localAnchor.y) * scale;
      tz = localAnchor.z + (tz - localAnchor.z) * scale;
    }
  }

  return { px, py, pz, tx, ty, tz };
}

function computeCollabCameraAnchor(opts: {
  selectedId: string | null;
  filter: GraphFilter;
  nodes: DocNode[];
  edges: unknown[];
  preferId?: string | null;
}): CollabCameraAnchor | null {
  const preferId = opts.preferId ?? opts.selectedId;
  if (preferId) {
    const pos = getNodePosition(preferId);
    if (pos) {
      const slot = slotOfId.get(preferId);
      const scale = slot !== undefined ? scaleOfSlot[slot] || 1 : 1;
      const node = opts.nodes.find((candidate) => candidate.id === preferId);
      return {
        id: preferId,
        title: node?.title ?? null,
        x: pos[0],
        y: pos[1],
        z: pos[2],
        radius: Math.max(scale, 1),
        count: 1,
      };
    }
  }

  const matched = nodesMatchingFilter(opts.nodes, opts.edges as any, opts.filter);
  if (matched && matched.size > 0) {
    const filtered = computeCentroidAnchor(matched);
    if (filtered) return filtered;
  }
  return computeCentroidAnchor(null);
}

async function readLocalCameraAnchor(selectedId: string | null, filter: GraphFilter): Promise<CollabCameraAnchor | undefined> {
  const graph = useGraphStore.getState();
  return computeCollabCameraAnchor({
    selectedId,
    filter,
    nodes: graph.nodes,
    edges: graph.edges,
  }) ?? undefined;
}

function readSelectedTitle(selectedId: string | null): string | null {
  if (!selectedId) return null;
  const node = useGraphStore.getState().nodes.find((candidate) => candidate.id === selectedId);
  return node?.title ?? null;
}

function stripAnchorPath(anchor: CollabCameraAnchor | undefined): CollabCameraAnchor | undefined {
  if (!anchor) return undefined;
  return {
    id: anchor.id,
    title: anchor.title,
    x: anchor.x,
    y: anchor.y,
    z: anchor.z,
    radius: anchor.radius,
    count: anchor.count,
  };
}

/** Snapshot of the local view that is safe to publish (no disk paths). */
export function buildSharedView(): CollabSharedView {
  const ui = useUiStore.getState();
  return {
    dims: ui.dims,
    selectedId: ui.selectedId,
    selectedTitle: readSelectedTitle(ui.selectedId),
    topicNodesEnabled: ui.topicNodesEnabled,
    clusterCollapsed: ui.clusterCollapsed,
    filter: cloneFilter(ui.filter),
    camera: readLocalCameraPose(),
    cameraAnchor: stripAnchorPath(computeCollabCameraAnchor({
      selectedId: ui.selectedId,
      filter: ui.filter,
      nodes: useGraphStore.getState().nodes,
      edges: useGraphStore.getState().edges,
    }) ?? undefined),
  };
}

async function readSharedView(): Promise<CollabSharedView> {
  return buildSharedView();
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
  localCameraActivityEpoch: number;
}

let queuedRemoteCamera: PendingRemoteCamera | null = null;
let pendingSettleCamera: PendingRemoteCamera | null = null;
let stopSettleWait: (() => void) | null = null;
let localCameraActivityEpoch = 0;
let lastFollowDebugAt = 0;
export const FOLLOW_SETTLE_WAIT_MS = 8_000;
let queuedRemoteCameraRaf: number | null = null;
let queuedRemoteCameraTimeout: ReturnType<typeof setTimeout> | null = null;
let settleWaitTimer: ReturnType<typeof setTimeout> | null = null;

function clearQueuedRemoteCameraFrame(): void {
  queuedRemoteCamera = null;
  if (queuedRemoteCameraRaf != null) {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(queuedRemoteCameraRaf);
    } else {
      clearTimeout(queuedRemoteCameraRaf);
    }
    queuedRemoteCameraRaf = null;
  }
  if (queuedRemoteCameraTimeout != null) {
    clearTimeout(queuedRemoteCameraTimeout);
    queuedRemoteCameraTimeout = null;
  }
}

function clearSettleWait(): void {
  if (settleWaitTimer != null) {
    clearTimeout(settleWaitTimer);
    settleWaitTimer = null;
  }
  if (stopSettleWait) {
    stopSettleWait();
    stopSettleWait = null;
  }
}

function deliverSettledCamera(final = true): void {
  if (final) {
    clearSettleWait();
    const settled = pendingSettleCamera;
    pendingSettleCamera = null;
    if (!settled) return;
    void deliverRemoteCameraPose(settled);
    return;
  }
  // Timeout fallback: apply now so a hung layout cannot pin the camera, but
  // keep the settle listener so a later genuine settle can remap against
  // finished positions (and so later poses still coalesce into that wait).
  if (settleWaitTimer != null) {
    clearTimeout(settleWaitTimer);
    settleWaitTimer = null;
  }
  const settled = pendingSettleCamera;
  if (!settled) return;
  void deliverRemoteCameraPose(settled);
}

/** Cancel rAF/settle-queued remote poses. */
export function clearDeferredRemoteCameras(): void {
  clearQueuedRemoteCameraFrame();
  pendingSettleCamera = null;
  clearSettleWait();
}

/** Mark deliberate local camera input so a delayed join pose cannot override it. */
export function noteLocalCameraActivity(): void {
  localCameraActivityEpoch += 1;
}

function resolveLocalFollowPose(pending: PendingRemoteCamera): CameraPose {
  if (!pending.anchor) return pending.pose;
  const ui = useUiStore.getState();
  const graph = useGraphStore.getState();
  const resolvedId = resolveFollowNodeId(graph.nodes, pending.anchor.id, {
    title: pending.anchor.title,
  });
  const localAnchor = computeCollabCameraAnchor({
    selectedId: ui.selectedId,
    preferId: resolvedId,
    filter: ui.filter,
    nodes: graph.nodes,
    edges: graph.edges,
  });
  if (!localAnchor) return pending.pose;
  return remapCameraPose(pending.pose, pending.anchor, localAnchor);
}

function deliverRemoteCameraPose(pending: PendingRemoteCamera): void {
  const { session, followMode, lastRemoteView } = useCollabStore.getState();
  if (!session) return;
  if (!followMode && lastRemoteView) return;
  if (pending.requireFollow && !followMode) return;
  if (!pending.requireFollow && pending.localCameraActivityEpoch !== localCameraActivityEpoch) return;
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
    localCameraActivityEpoch,
  };

  // While a dims-driven settle is outstanding, keep coalescing into that
  // callback instead of also firing a same-frame rAF pose against mid-flatten
  // coordinates.
  if (opts.waitForSettle || stopSettleWait) {
    pendingSettleCamera = pending;
    clearQueuedRemoteCameraFrame();
    if (opts.waitForSettle) {
      const minEpoch = layoutEpoch();
      clearSettleWait();
      stopSettleWait = onLayoutSettled(() => {
        if (layoutSettledEpoch() < minEpoch) return;
        deliverSettledCamera();
      });
      settleWaitTimer = setTimeout(() => {
        settleWaitTimer = null;
        deliverSettledCamera(false);
      }, FOLLOW_SETTLE_WAIT_MS);
    }
    return;
  }

  queuedRemoteCamera = pending;
  const run = () => {
    queuedRemoteCameraRaf = null;
    queuedRemoteCameraTimeout = null;
    const next = queuedRemoteCamera;
    queuedRemoteCamera = null;
    if (!next) return;
    void deliverRemoteCameraPose(next);
  };
  if (typeof requestAnimationFrame === 'function') {
    queuedRemoteCameraRaf = requestAnimationFrame(run);
    return;
  }
  queuedRemoteCameraTimeout = setTimeout(run, 0);
}

async function maybeLogFollowDebug(
  remote: CollabSharedView,
  localUi: ReturnType<typeof useUiStore.getState>,
): Promise<void> {
  if (!import.meta.env.DEV) return;
  if (typeof window === 'undefined') return;
  const enabled = (window as Window & { __nebulaFollowDebug?: boolean }).__nebulaFollowDebug;
  if (!enabled) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastFollowDebugAt < 1000) return;
  lastFollowDebugAt = now;
  const { buildFollowDebugSnapshot } = await loadViewFrame();
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
export async function applySharedView(view: Partial<Record<string, unknown>>): Promise<void> {
  const { followMode, lastRemoteView } = useCollabStore.getState();
  // Join snapshot (no view applied yet) may run while follow is off. After
  // that, unfollow must ignore presenter writes — requireFollow is copied
  // from followMode at schedule time, so later poses would be treated as
  // join poses and still snap camera/dims/selection/filters.
  if (!followMode && lastRemoteView) return;

  const ui = useUiStore.getState();
  const remoteFilter = sanitizeSharedFilter(view.filter);
  const remoteCamera = parseCameraPose(view.camera);
  const remoteAnchor = parseCameraAnchor(view.cameraAnchor);
  const nextDims =
    typeof view.dims === 'number' && (view.dims === 2 || view.dims === 3) ? view.dims : undefined;
  const remoteSelectedHint = {
    title:
      typeof view.selectedTitle === 'string'
        ? view.selectedTitle
        : remoteAnchor?.title,
  };
  const nextSelectedId =
    'selectedId' in view
      ? typeof view.selectedId === 'string'
        ? resolveFollowNodeId(useGraphStore.getState().nodes, view.selectedId, remoteSelectedHint) ??
          (ui.selectedId === view.selectedId ? ui.selectedId : null)
        : null
      : undefined;
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
  await maybeLogFollowDebug(applied, appliedUi);
  scheduleRemoteCameraPose(remoteCamera ?? null, remoteAnchor, { waitForSettle: dimsChanged });
}

function annotationTimestamp(value: DocAnnotationRecord | undefined): number {
  return value ? clampUpdatedAt(value.updatedAt, 0) : 0;
}

async function bindAnnotationSync(session: CollabSession, token: number): Promise<() => void> {
  const [{ ensureAnnotationsLoaded, useAnnotationStore }, { useCorpusStore }, { useGraphStore }] = await Promise.all([
    import('../store/annotationStore'),
    import('../store/corpusStore'),
    import('../store/graphStore'),
  ]);
  const corpus = useCorpusStore.getState();
  if (corpus.mode !== 'local' || !corpus.activeCorpusId) return () => undefined;
  await ensureAnnotationsLoaded(corpus.activeCorpusId);
  if (useAnnotationStore.getState().scope !== corpus.activeCorpusId) return () => undefined;
  if (token !== annotationBindingToken) return () => undefined;

  const map = session.annotations;
  let applyingRemote = false;
  const mappedKeys = new Map<string, string>(); // shared key -> local annotation key

  const annotationKeyForLocal = (key: string): string => {
    const hit = useGraphStore.getState().nodes.find(
      (node) => node.id === key || node.path === key || `${node.title} ${node.id}` === key,
    );
    if (hit) {
      mappedKeys.set(hit.id, key);
      return hit.id;
    }
    return key;
  };

  const localKeyForShared = (sharedKey: string): string => {
    const localKey = mappedKeys.get(sharedKey);
    if (localKey) return localKey;
    const hit = useGraphStore.getState().nodes.find((node) => node.id === sharedKey);
    return hit ? annotationKey(hit) : sharedKey;
  };

  const applyMapChange = (key: string): void => {
    const remote = map.get(key);
    const localKey = localKeyForShared(key);
    const local = useAnnotationStore.getState().annotations[localKey];
    if (remote && local && annotationTimestamp(local) > annotationTimestamp(remote)) {
      map.set(key, local);
      return;
    }
    applyingRemote = true;
    try {
      useAnnotationStore.getState().applyRemote(localKey, remote ?? null);
    } finally {
      applyingRemote = false;
    }
    // applyRemote clamps far-future stamps, but applyingRemote suppresses the
    // store subscription, so write the sanitized record back or later LWW
    // compares keep losing to the raw peer stamp.
    const applied = useAnnotationStore.getState().annotations[localKey];
    if (applied && remote && applied.updatedAt !== remote.updatedAt) {
      map.set(key, applied);
    }
  };

  const onRemoteChange = (event: YMapEvent<DocAnnotationRecord>): void => {
    for (const key of event.changes.keys.keys()) applyMapChange(key);
  };
  map.observe(onRemoteChange);

  const localAtBind = useAnnotationStore.getState().annotations;
  session.doc.transact(() => {
    for (const [key, local] of Object.entries(localAtBind)) {
      const sharedKey = annotationKeyForLocal(key);
      const remote = map.get(sharedKey);
      if (!remote || annotationTimestamp(local) >= annotationTimestamp(remote)) {
        map.set(sharedKey, local);
      } else {
        applyMapChange(sharedKey);
      }
    }
    for (const key of map.keys()) {
      const localKey = localKeyForShared(key);
      if (!(localKey in localAtBind)) applyMapChange(key);
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
        const sharedKey = annotationKeyForLocal(key);
        if (before === after) continue;
        if (after) map.set(sharedKey, after);
        else map.delete(sharedKey);
      }
    });
  });

  return () => {
    unsubscribe();
    map.unobserve(onRemoteChange);
  };
}

let annotationBindingToken = 0;

export const useCollabStore = create<CollaborationState>((set, get) => ({
  session: null,
  roomId: null,
  sessionKey: null,
  invite: null,
  status: 'idle',
  peers: {},
  followMode: false,
  shareNotes: false,
  lastRemoteView: null,

  startSession: async (roomId, sessionKey) => {
    if (get().session) {
      get().leaveSession();
    }
    const nextRoom = roomId ?? `graph-${randomCollabToken(8)}`;
    const nextKey = sessionKey ?? randomCollabToken(16);
    set({ status: 'connecting' });
    try {
      const { buildCollabInvite, createCollabSession, isWeakCollabKey } = await import('./session');
      // Only reachable for a key the caller typed; generated keys are 16 bytes.
      if (sessionKey && isWeakCollabKey(sessionKey)) {
        useUiStore.getState().pushToast(WEAK_KEY_WARNING, 'warning');
      }
      const session = createCollabSession({ roomId: nextRoom, sessionKey: nextKey });
      const invite = buildCollabInvite(session.roomId, session.sessionKey);
      if (get().shareNotes) {
        const token = ++annotationBindingToken;
        const stop = await bindAnnotationSync(session, token);
        if (get().shareNotes && token === annotationBindingToken) {
          stopAnnotationSync = stop;
        } else {
          stop();
        }
      }
      session.provider?.awareness.on('change', () => {
        set({ peers: collectPeers(session) });
      });
      // Presenter: skip re-applying our own writes back to ourselves.
      session.view.observe(() => {
        if (!get().followMode) return;
        void applySharedView(session.view.toJSON() as Partial<Record<string, unknown>>);
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
      const { buildCollabInvite, createCollabSession, isWeakCollabKey } = await import('./session');
      if (isWeakCollabKey(sessionKey)) {
        useUiStore.getState().pushToast(WEAK_KEY_WARNING, 'warning');
      }
      const session = createCollabSession({ roomId, sessionKey });
      const invite = buildCollabInvite(session.roomId, session.sessionKey);
      if (get().shareNotes) {
        const token = ++annotationBindingToken;
        const stop = await bindAnnotationSync(session, token);
        if (get().shareNotes && token === annotationBindingToken) {
          stopAnnotationSync = stop;
        } else {
          stop();
        }
      }
      session.provider?.awareness.on('change', () => {
        set({ peers: collectPeers(session) });
      });
      // Joiner: apply the first snapshot even before follow is on (join pose
      // / late Yjs sync). After that, only follow mode may keep applying
      // presenter view — requireFollow is snapshotted at schedule time and
      // does not restore independent control on unfollow.
      session.view.observe(() => {
        if (!get().followMode && get().lastRemoteView) return;
        void applySharedView(session.view.toJSON() as Partial<Record<string, unknown>>);
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
        void applySharedView(session.view.toJSON() as Partial<Record<string, unknown>>);
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
      set({ roomId: null, sessionKey: null, invite: null, status: 'idle', peers: {}, followMode: false, shareNotes: false, lastRemoteView: null });
      return;
    }
    session.provider?.destroy();
    session.doc.destroy();
    set({ session: null, roomId: null, sessionKey: null, invite: null, status: 'idle', peers: {}, followMode: false, shareNotes: false, lastRemoteView: null });
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

  setShareNotes: (enabled) => {
    if (get().shareNotes === enabled) return;
    const { session } = get();
    const token = ++annotationBindingToken;
    stopAnnotationSync?.();
    stopAnnotationSync = null;
    if (session && !enabled) {
      session.doc.transact(() => {
        for (const key of Object.keys(useAnnotationStore.getState().annotations)) {
          const candidate = useGraphStore.getState().nodes.find(
            (node) => node.id === key || node.path === key || `${node.title} ${node.id}` === key,
          );
          const sharedKey = candidate ? candidate.id : key;
          if (session.annotations.has(sharedKey)) session.annotations.delete(sharedKey);
        }
      });
    }
    set({ shareNotes: enabled });
    if (!session || !enabled) return;
    void bindAnnotationSync(session, token).then((stop) => {
      if (get().shareNotes && get().session === session && token === annotationBindingToken) {
        stopAnnotationSync = stop;
      } else {
        stop();
      }
    }).catch((error) => {
      console.warn('[knowledge-nebula] annotation sync bind failed', error);
    });
  },

  setFollowMode: (enabled) => {
    if (!enabled) clearDeferredRemoteCameras();
    set({ followMode: enabled });
    const { session } = get();
    if (!session) return;
    if (enabled) {
      void applySharedView(session.view.toJSON() as Partial<Record<string, unknown>>);
      return;
    }
    get().syncSharedView();
  },

  syncSharedView: () => {
    const { session, followMode } = get();
    if (!session || followMode) return;
    void (async () => {
      const view = await readSharedView();
      const map = session.view;
      session.doc.transact(() => {
        map.set('dims', view.dims ?? useUiStore.getState().dims);
        map.set('selectedId', view.selectedId ?? null);
        map.delete('selectedPath');
        map.set('selectedTitle', view.selectedTitle ?? null);
        map.set('topicNodesEnabled', view.topicNodesEnabled ?? useUiStore.getState().topicNodesEnabled);
        map.set('clusterCollapsed', view.clusterCollapsed ?? useUiStore.getState().clusterCollapsed);
        map.set('filter', view.filter ?? useUiStore.getState().filter);
        map.set('camera', view.camera ?? null);
        map.set('cameraAnchor', view.cameraAnchor ?? null);
      });
      set({ lastRemoteView: { ...view } });
    })();
  },

  syncCameraPose: () => {
    const { session, followMode } = get();
    if (!session || followMode) return;
    void (async () => {
      const ui = useUiStore.getState();
      const pose = readLocalCameraPose();
      const anchor = (await readLocalCameraAnchor(ui.selectedId, ui.filter)) ?? null;
      session.doc.transact(() => {
        session.view.set('camera', pose);
        session.view.set('cameraAnchor', anchor);
      });
    })();
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
