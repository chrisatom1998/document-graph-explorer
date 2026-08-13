/**
 * Layout-relative camera framing for collaboration follow mode.
 *
 * Peers keep independent force layouts (privacy: corpora/positions stay local).
 * Absolute world poses therefore cannot mean "look at the same nodes". This
 * module publishes a presenter-side anchor and remaps remote poses into the
 * follower's local coordinate frame.
 */

import { nodesMatchingFilter } from '../scene/emphasis';
import {
  getNodePosition,
  idOfSlot,
  positionBuffer,
  scaleOfSlot,
  slotOfId,
} from '../scene/positionBuffer';
import type { DocNode, Edge } from '../model/types';
import type { CameraPose, GraphFilter } from '../store/uiStore';

const ANCHOR_RADIUS_EPS = 1e-3;
const SELECTED_RADIUS_FLOOR = 1;

export interface CollabCameraAnchor {
  /** Prefer selected node id when that node exists in the publisher's layout. */
  id: string | null;
  x: number;
  y: number;
  z: number;
  /** RMS radius of the anchor set (selected node → small floor; else graph). */
  radius: number;
  /** Node count contributing to the anchor (debug / scale sanity). */
  count: number;
}

export interface FollowDebugSnapshot {
  dims: 2 | 3;
  selectedId: string | null;
  cameraPose: CameraPose;
  graphNodeCount: number;
  positionCount: number;
  anchor: CollabCameraAnchor | null;
  centroid: { x: number; y: number; z: number } | null;
  bbox: { min: [number, number, number]; max: [number, number, number] } | null;
  filteredCount: number | null;
  filteredSample: string[];
  slotSample: Array<{ id: string; slot: number; pos: [number, number, number] | null }>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Validate a remote camera-anchor payload from the shared Yjs view map. */
export function parseCameraAnchor(value: unknown): CollabCameraAnchor | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (
    !isFiniteNumber(source.x) ||
    !isFiniteNumber(source.y) ||
    !isFiniteNumber(source.z) ||
    !isFiniteNumber(source.radius) ||
    !isFiniteNumber(source.count)
  ) {
    return undefined;
  }
  if (source.radius < 0 || source.count < 0) return undefined;
  const id = source.id === null ? null : typeof source.id === 'string' ? source.id : undefined;
  if (id === undefined) return undefined;
  return {
    id,
    x: source.x,
    y: source.y,
    z: source.z,
    radius: source.radius,
    count: Math.floor(source.count),
  };
}

/**
 * Remap a presenter world-space pose into the follower's layout frame using
 * matching anchors. Translates by (local - remote), then optionally scales
 * about the local anchor when both radii are meaningful.
 */
export function remapCameraPose(
  remotePose: CameraPose,
  remoteAnchor: CollabCameraAnchor,
  localAnchor: CollabCameraAnchor,
): CameraPose {
  const dx = localAnchor.x - remoteAnchor.x;
  const dy = localAnchor.y - remoteAnchor.y;
  const dz = localAnchor.z - remoteAnchor.z;

  let px = remotePose.px + dx;
  let py = remotePose.py + dy;
  let pz = remotePose.pz + dz;
  let tx = remotePose.tx + dx;
  let ty = remotePose.ty + dy;
  let tz = remotePose.tz + dz;

  if (remoteAnchor.radius > ANCHOR_RADIUS_EPS && localAnchor.radius > ANCHOR_RADIUS_EPS) {
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

/** Centroid + RMS radius over an explicit id set that has live slots. */
export function computeCentroidAnchor(
  ids: Iterable<string> | null,
): CollabCameraAnchor | null {
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

/**
 * Resolve the local publish/apply anchor: selected node when present in the
 * layout, otherwise centroid of filter-matched nodes (falling back to all).
 */
export function computeCollabCameraAnchor(opts: {
  selectedId: string | null;
  filter: GraphFilter;
  nodes: DocNode[];
  edges: Edge[];
  /** Prefer this remote anchor id when resolving a follower-side local frame. */
  preferId?: string | null;
}): CollabCameraAnchor | null {
  const preferId = opts.preferId !== undefined ? opts.preferId : opts.selectedId;
  if (preferId) {
    const pos = getNodePosition(preferId);
    if (pos) {
      const slot = slotOfId.get(preferId);
      const scale = slot !== undefined ? scaleOfSlot[slot] || SELECTED_RADIUS_FLOOR : SELECTED_RADIUS_FLOOR;
      return {
        id: preferId,
        x: pos[0],
        y: pos[1],
        z: pos[2],
        radius: Math.max(scale, SELECTED_RADIUS_FLOOR),
        count: 1,
      };
    }
  }

  const matched = nodesMatchingFilter(opts.nodes, opts.edges, opts.filter);
  if (matched && matched.size > 0) {
    const filtered = computeCentroidAnchor(matched);
    if (filtered) return filtered;
  }
  return computeCentroidAnchor(null);
}

export function buildFollowDebugSnapshot(opts: {
  dims: 2 | 3;
  selectedId: string | null;
  filter: GraphFilter;
  nodes: DocNode[];
  edges: Edge[];
  cameraPose: CameraPose;
  anchor?: CollabCameraAnchor | null;
}): FollowDebugSnapshot {
  const matched = nodesMatchingFilter(opts.nodes, opts.edges, opts.filter);
  const filteredIds = matched ? [...matched] : null;
  const centroidAnchor = computeCentroidAnchor(filteredIds);
  const arr = positionBuffer.array;
  const count = positionBuffer.count;

  let bbox: FollowDebugSnapshot['bbox'] = null;
  if (count > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let any = false;
    for (let slot = 0; slot < count; slot++) {
      const id = idOfSlot[slot];
      if (!id) continue;
      if (matched && !matched.has(id)) continue;
      const i = slot * 3;
      if (i + 2 >= arr.length) continue;
      const x = arr[i];
      const y = arr[i + 1];
      const z = arr[i + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
      any = true;
    }
    if (any) {
      bbox = { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
    }
  }

  const sampleIds = filteredIds?.slice(0, 8) ?? [];
  if (opts.selectedId && !sampleIds.includes(opts.selectedId)) {
    sampleIds.unshift(opts.selectedId);
  }
  const slotSample = sampleIds.slice(0, 8).map((id) => ({
    id,
    slot: slotOfId.get(id) ?? -1,
    pos: getNodePosition(id),
  }));

  return {
    dims: opts.dims,
    selectedId: opts.selectedId,
    cameraPose: { ...opts.cameraPose },
    graphNodeCount: opts.nodes.length,
    positionCount: count,
    anchor: opts.anchor ?? computeCollabCameraAnchor(opts),
    centroid: centroidAnchor
      ? { x: centroidAnchor.x, y: centroidAnchor.y, z: centroidAnchor.z }
      : null,
    bbox,
    filteredCount: matched ? matched.size : null,
    filteredSample: sampleIds.slice(0, 8),
    slotSample,
  };
}
