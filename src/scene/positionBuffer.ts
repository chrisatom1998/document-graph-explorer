/**
 * Per-frame layout positions, kept out of React entirely.
 * The layout worker posts a transferable Float32Array; the bridge points
 * `array` at it. Scene components read it inside useFrame.
 */

import { INITIAL_NODE_CAPACITY, MAX_NODES } from '../config';

export const positionBuffer = {
  array: new Float32Array(0), // [slot*3 + i]
  count: 0, // active node count
  alpha: 1,
  version: 0, // bumped on every tick received
};

/** slot assignment is owned by layoutBridge; render uses these lookups */
export const slotOfId = new Map<string, number>();
export const idOfSlot: string[] = [];

/** per-slot visual scale (from degree), maintained by the Nodes component */
export const scaleOfSlot: number[] = [];

/** per-slot spawn timestamp for the materialize animation */
export const spawnAtOfSlot: number[] = [];

/**
 * Fixed-stride per-slot metadata, grown on demand by ensureSlotCapacity (up to
 * MAX_NODES). A holder mutated in place — not reassigned `let` exports — so no
 * module can go stale holding a pre-growth reference to the holder itself; the
 * arrays INSIDE are replaced on growth, so always read them through `slotMeta.`
 * at use time instead of caching one in a long-lived local or closure.
 *
 * - origin/hasOrigin: world-space fly-in origin (drop / Add / canvas center).
 * - kind: 1 = topic-kind node at this slot. Maintained by <Nodes/>; lives here
 *   (with the other slot metadata) so layoutBridge can clear freed slots
 *   without a bridge → scene-component import cycle.
 * - ghost: 1 = partial/unreadable ("ghosted") node. Maintained by <Nodes/>.
 */
export const slotMeta = {
  capacity: INITIAL_NODE_CAPACITY,
  origin: new Float32Array(INITIAL_NODE_CAPACITY * 3),
  hasOrigin: new Uint8Array(INITIAL_NODE_CAPACITY),
  kind: new Uint8Array(INITIAL_NODE_CAPACITY),
  ghost: new Uint8Array(INITIAL_NODE_CAPACITY),
};

const capacityListeners = new Set<() => void>();

/** Current slot capacity — the useSyncExternalStore snapshot for <Nodes/>. */
export function slotCapacity(): number {
  return slotMeta.capacity;
}

/** Fires after slotMeta's arrays have been swapped for a new capacity. */
export function subscribeSlotCapacity(fn: () => void): () => void {
  capacityListeners.add(fn);
  return () => capacityListeners.delete(fn);
}

/**
 * Grow the slot-metadata arrays (copy-on-grow) so every slot < n is
 * addressable. Clamped to the MAX_NODES hard ceiling — layoutAddNodes drops
 * nodes past it. Typed-array writes past the end are SILENT no-ops, so growth
 * must happen before a new slot is written; layoutAddNodes is the single
 * allocation choke point and the only intended caller outside tests.
 */
export function ensureSlotCapacity(n: number): void {
  const target = Math.min(Math.ceil(n), MAX_NODES);
  if (target <= slotMeta.capacity) return;
  const origin = new Float32Array(target * 3);
  origin.set(slotMeta.origin);
  const hasOrigin = new Uint8Array(target);
  hasOrigin.set(slotMeta.hasOrigin);
  const kind = new Uint8Array(target);
  kind.set(slotMeta.kind);
  const ghost = new Uint8Array(target);
  ghost.set(slotMeta.ghost);
  slotMeta.origin = origin;
  slotMeta.hasOrigin = hasOrigin;
  slotMeta.kind = kind;
  slotMeta.ghost = ghost;
  slotMeta.capacity = target;
  capacityListeners.forEach((fn) => fn());
}

export function resetPositionBuffer(): void {
  positionBuffer.array = new Float32Array(0);
  positionBuffer.count = 0;
  positionBuffer.alpha = 1;
  positionBuffer.version = 0;
  slotOfId.clear();
  idOfSlot.length = 0;
  scaleOfSlot.length = 0;
  spawnAtOfSlot.length = 0;
  if (slotMeta.capacity > INITIAL_NODE_CAPACITY) {
    // A new corpus starts small again — release the grown arrays.
    slotMeta.origin = new Float32Array(INITIAL_NODE_CAPACITY * 3);
    slotMeta.hasOrigin = new Uint8Array(INITIAL_NODE_CAPACITY);
    slotMeta.kind = new Uint8Array(INITIAL_NODE_CAPACITY);
    slotMeta.ghost = new Uint8Array(INITIAL_NODE_CAPACITY);
    slotMeta.capacity = INITIAL_NODE_CAPACITY;
    capacityListeners.forEach((fn) => fn());
  } else {
    slotMeta.origin.fill(0);
    slotMeta.hasOrigin.fill(0);
    slotMeta.kind.fill(0);
    slotMeta.ghost.fill(0);
  }
}

export function getNodePosition(id: string): [number, number, number] | null {
  const slot = slotOfId.get(id);
  if (slot === undefined || slot * 3 + 2 >= positionBuffer.array.length) return null;
  const a = positionBuffer.array;
  return [a[slot * 3], a[slot * 3 + 1], a[slot * 3 + 2]];
}
