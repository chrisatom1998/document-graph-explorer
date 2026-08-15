/**
 * Ingest as the first wow (spec §4.3, §8): nodes spawn at the drop/Add/center
 * origin and travel to their force-layout homes while the sim is hot. Pure
 * math + a tiny bit of session state so tests can lock the rules without
 * standing up R3F.
 *
 * Visual language stays the existing 700ms easeOutBack pop + halo flare
 * (Nodes.tsx). This module owns origin projection, travel interpolation,
 * first-ingest camera follow vs incremental no-steal, and edge reveal.
 */

import { cameraPose } from './cameraPose';
import {
  clearPendingOrigin,
  pendingIngestOrigin,
  type PendingOrigin,
  type Vec3,
} from './ingestGesture';
import {
  hasOriginOfSlot,
  originOfSlot,
  positionBuffer,
  spawnAtOfSlot,
} from './positionBuffer';

// Gesture recording + camera-framing flags live in the dependency-free
// ingestGesture module (entry-chunk budget); re-exported so scene/pipeline
// code keeps importing them from here.
export * from './ingestGesture';

export const MATERIALIZE_MS = 700;
/** 2D ladder: disc pop + short slide, not a 3D flight. */
export const MATERIALIZE_MS_FLAT = 420;
export const EDGE_REVEAL_MS = 380;

export interface CameraPoseInput {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
  fov: number;
  aspect: number;
}

/**
 * Project NDC through a perspective camera onto the graph plane (the plane
 * through the orbit target, facing the camera). Used for drop / Add / center.
 */
export function projectNdcToGraphPlane(
  ndcX: number,
  ndcY: number,
  pose: CameraPoseInput,
): Vec3 {
  const fx = pose.tx - pose.px;
  const fy = pose.ty - pose.py;
  const fz = pose.tz - pose.pz;
  const fl = Math.hypot(fx, fy, fz) || 1;
  const forwardX = fx / fl;
  const forwardY = fy / fl;
  const forwardZ = fz / fl;

  // right = forward × worldUp, with a fallback if looking along Y
  let rightX = forwardY * 0 - forwardZ * 1;
  let rightY = forwardZ * 0 - forwardX * 0;
  let rightZ = forwardX * 1 - forwardY * 0;
  let rl = Math.hypot(rightX, rightY, rightZ);
  if (rl < 1e-6) {
    rightX = 1;
    rightY = 0;
    rightZ = 0;
    rl = 1;
  } else {
    rightX /= rl;
    rightY /= rl;
    rightZ /= rl;
  }
  const upX = rightY * forwardZ - rightZ * forwardY;
  const upY = rightZ * forwardX - rightX * forwardZ;
  const upZ = rightX * forwardY - rightY * forwardX;

  const tanHalf = Math.tan((pose.fov * Math.PI) / 360);
  const dirX = forwardX + rightX * ndcX * tanHalf * pose.aspect + upX * ndcY * tanHalf;
  const dirY = forwardY + rightY * ndcX * tanHalf * pose.aspect + upY * ndcY * tanHalf;
  const dirZ = forwardZ + rightZ * ndcX * tanHalf * pose.aspect + upZ * ndcY * tanHalf;
  const dl = Math.hypot(dirX, dirY, dirZ) || 1;
  const rdx = dirX / dl;
  const rdy = dirY / dl;
  const rdz = dirZ / dl;

  const denom = rdx * forwardX + rdy * forwardY + rdz * forwardZ;
  if (Math.abs(denom) < 1e-6) {
    return [pose.tx, pose.ty, pose.tz];
  }
  const t =
    ((pose.tx - pose.px) * forwardX + (pose.ty - pose.py) * forwardY + (pose.tz - pose.pz) * forwardZ) /
    denom;
  return [pose.px + rdx * t, pose.py + rdy * t, pose.pz + rdz * t];
}

export function clientToNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { ndcX: number; ndcY: number } {
  const w = rect.width || 1;
  const h = rect.height || 1;
  return {
    ndcX: ((clientX - rect.left) / w) * 2 - 1,
    ndcY: -((clientY - rect.top) / h) * 2 + 1,
  };
}

function canvasRect(): { left: number; top: number; width: number; height: number } {
  if (typeof document === 'undefined') {
    return { left: 0, top: 0, width: 1, height: 1 };
  }
  // The scene canvas specifically — a bare 'canvas' query can land on the
  // EmptyState hero constellation (or a PDF preview) and project drop/Add
  // origins through the wrong rect. R3F puts the className on the wrapper div.
  const canvas =
    document.querySelector('.nebula-canvas canvas') ?? document.querySelector('canvas');
  if (canvas) return canvas.getBoundingClientRect();
  return { left: 0, top: 0, width: window.innerWidth || 1, height: window.innerHeight || 1 };
}

function addControlNdc(rect: { left: number; top: number; width: number; height: number }): {
  ndcX: number;
  ndcY: number;
} {
  if (typeof document === 'undefined') return { ndcX: 0, ndcY: 0 };
  const el = document.querySelector('[data-ingest-add]');
  if (!el) return { ndcX: 0, ndcY: 0 };
  const r = el.getBoundingClientRect();
  return clientToNdc(r.left + r.width / 2, r.top + r.height / 2, rect);
}

export function resolveIngestOrigin(opts?: {
  pose?: CameraPoseInput;
  rect?: { left: number; top: number; width: number; height: number };
  flat?: boolean;
  pending?: PendingOrigin | null;
}): Vec3 {
  const pose = opts?.pose ?? cameraPose;
  const rect = opts?.rect ?? canvasRect();
  const src = opts?.pending !== undefined ? opts.pending : pendingIngestOrigin();
  let point: Vec3;
  if (!src || src.kind === 'center') {
    point = projectNdcToGraphPlane(0, 0, pose);
  } else if (src.kind === 'world') {
    point = src.point;
  } else if (src.kind === 'add') {
    const { ndcX, ndcY } = addControlNdc(rect);
    point = projectNdcToGraphPlane(ndcX, ndcY, pose);
  } else {
    const { ndcX, ndcY } = clientToNdc(src.clientX, src.clientY, rect);
    point = projectNdcToGraphPlane(ndcX, ndcY, pose);
  }
  if (opts?.flat) return [point[0], point[1], 0];
  return point;
}

/** Capture and consume the pending origin for this ingest run. */
export function snapshotIngestOrigin(opts?: {
  flat?: boolean;
  pose?: CameraPoseInput;
  rect?: { left: number; top: number; width: number; height: number };
}): Vec3 {
  const origin = resolveIngestOrigin(opts);
  clearPendingOrigin();
  return origin;
}

// ---------------------------------------------------------------------------
// Travel: origin → current force-layout home
// ---------------------------------------------------------------------------

/** easeOutBack: small overshoot for the materialize pop (shared with Nodes). */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

export function materializeDuration(flat: boolean): number {
  return flat ? MATERIALIZE_MS_FLAT : MATERIALIZE_MS;
}

export function travelProgress(now: number, spawnAt: number, duration: number): number {
  if (spawnAt < 0) return 1;
  return Math.min(1, Math.max(0, (now - spawnAt) / duration));
}

export function interpolateTravel(
  origin: Vec3,
  home: Vec3,
  t: number,
  flat: boolean,
): Vec3 {
  const f = easeOutBack(t);
  return [
    origin[0] + (home[0] - origin[0]) * f,
    origin[1] + (home[1] - origin[1]) * f,
    flat ? 0 : origin[2] + (home[2] - origin[2]) * f,
  ];
}

/**
 * Reduced-motion / finished / no-origin → home (at rest). Otherwise lerp
 * origin → home with easeOutBack. `t < 0` (stagger wait) stays at origin.
 *
 * Pure reference implementation of the travel rule (tests lock it here);
 * writeSlotTravelPosition below is its allocation-free hot-path twin.
 */
export function displayTravelPosition(input: {
  origin: Vec3 | null;
  home: Vec3;
  spawnAt: number;
  now: number;
  reducedMotion: boolean;
  flat: boolean;
}): Vec3 {
  const home: Vec3 = input.flat ? [input.home[0], input.home[1], 0] : input.home;
  if (input.reducedMotion || !input.origin || input.spawnAt < 0) return home;
  const duration = materializeDuration(input.flat);
  const raw = (input.now - input.spawnAt) / duration;
  if (raw >= 1) return home;
  if (raw <= 0) {
    return input.flat ? [input.origin[0], input.origin[1], 0] : input.origin;
  }
  return interpolateTravel(input.origin, home, raw, input.flat);
}

/** Allocation-free write of the visual position for a layout slot
 * (same rule as displayTravelPosition, inlined for the per-frame loops). */
export function writeSlotTravelPosition(
  out: { x: number; y: number; z: number },
  slot: number,
  now: number,
  opts: { reducedMotion: boolean; flat: boolean },
): boolean {
  const arr = positionBuffer.array;
  const o = slot * 3;
  if (o + 2 >= arr.length) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return false;
  }
  const hx = arr[o];
  const hy = arr[o + 1];
  const hz = opts.flat ? 0 : arr[o + 2];
  const spawn = spawnAtOfSlot[slot] ?? -1;
  if (opts.reducedMotion || spawn < 0 || !hasOriginOfSlot[slot]) {
    out.x = hx;
    out.y = hy;
    out.z = hz;
    return false;
  }
  const raw = (now - spawn) / materializeDuration(opts.flat);
  if (raw >= 1) {
    out.x = hx;
    out.y = hy;
    out.z = hz;
    return false;
  }
  const ox = originOfSlot[o];
  const oy = originOfSlot[o + 1];
  const oz = opts.flat ? 0 : originOfSlot[o + 2];
  if (raw <= 0) {
    out.x = ox;
    out.y = oy;
    out.z = oz;
    return true;
  }
  const f = easeOutBack(raw);
  out.x = ox + (hx - ox) * f;
  out.y = oy + (hy - oy) * f;
  out.z = opts.flat ? 0 : oz + (hz - oz) * f;
  return true;
}

/**
 * A slot has visually arrived once its materialize pop has begun (or it never
 * had one — restore / reduced motion / finished). Pre-spawn slots sit at the
 * drop origin at scale 0, so they must not anchor edges, take raycast hits,
 * or earn labels.
 */
export function slotHasMaterialized(slot: number, now: number): boolean {
  const spawn = spawnAtOfSlot[slot] ?? -1;
  return spawn < 0 || now >= spawn;
}

// ---------------------------------------------------------------------------
// Camera fit (the follow/snap/leave decision lives in ingestGesture)
// ---------------------------------------------------------------------------

export function computeFitAllPose(input: {
  array: ArrayLike<number>;
  count: number;
  viewDir: Vec3;
  fovDeg: number;
  /** Restrict the bounding sphere to these slots (frameSet); default all < count. */
  slots?: ArrayLike<number>;
}): { target: Vec3; position: Vec3; radius: number } {
  const slots = input.slots;
  const n = slots ? slots.length : input.count;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    const slot = slots ? slots[i] : i;
    cx += input.array[slot * 3] ?? 0;
    cy += input.array[slot * 3 + 1] ?? 0;
    cz += input.array[slot * 3 + 2] ?? 0;
  }
  if (n === 0) {
    return { target: [0, 0, 0], position: [0, 0, 40], radius: 0 };
  }
  cx /= n;
  cy /= n;
  cz /= n;
  let maxDistSq = 0;
  for (let i = 0; i < n; i++) {
    const slot = slots ? slots[i] : i;
    const dx = (input.array[slot * 3] ?? 0) - cx;
    const dy = (input.array[slot * 3 + 1] ?? 0) - cy;
    const dz = (input.array[slot * 3 + 2] ?? 0) - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > maxDistSq) maxDistSq = d;
  }
  const radius = Math.sqrt(maxDistSq);
  const dist = Math.max(40, (radius / Math.tan(((input.fovDeg || 55) * Math.PI) / 360)) * 1.18);
  const vl = Math.hypot(input.viewDir[0], input.viewDir[1], input.viewDir[2]) || 1;
  const vx = input.viewDir[0] / vl;
  const vy = input.viewDir[1] / vl;
  const vz = input.viewDir[2] / vl;
  return {
    target: [cx, cy, cz],
    position: [cx + vx * dist, cy + vy * dist, cz + vz * dist],
    radius,
  };
}

// ---------------------------------------------------------------------------
// Edges: invisible until both endpoints exist, then fade in
// ---------------------------------------------------------------------------

export function edgeRevealFactor(input: {
  bothEndpointsExist: boolean;
  appearAt: number | undefined;
  now: number;
  reducedMotion: boolean;
  duration?: number;
}): { factor: number; appearAt: number | undefined } {
  if (!input.bothEndpointsExist) return { factor: 0, appearAt: undefined };
  if (input.reducedMotion) return { factor: 1, appearAt: input.appearAt ?? input.now };
  const appearAt = input.appearAt ?? input.now;
  const duration = input.duration ?? EDGE_REVEAL_MS;
  const factor = Math.min(1, Math.max(0, (input.now - appearAt) / duration));
  return { factor, appearAt };
}

export function edgeKey(source: string, target: string, kind: string): string {
  return source < target ? `${source}\0${target}\0${kind}` : `${target}\0${source}\0${kind}`;
}
