/**
 * Main-thread wrapper around the layout worker. Owns slot assignment
 * (the layout <-> render contract) and buffer recycling.
 *
 * This file is a shared contract: the pipeline calls layoutAddNodes /
 * layoutSetLinks / layoutSetClusters as docs stream in; the scene reads
 * positions from positionBuffer.
 */

import { MAX_NODES } from '../config';
import type { LayoutNodeInput, LayoutRequest, LayoutResponse } from '../model/types';
import { useUiStore } from '../store/uiStore';
import {
  getNodePosition,
  ghostOfSlot,
  idOfSlot,
  kindOfSlot,
  positionBuffer,
  resetPositionBuffer,
  scaleOfSlot,
  slotOfId,
  spawnAtOfSlot,
} from '../scene/positionBuffer';

let worker: Worker | null = null;
let nextSlot = 0;
/** Slots freed by layoutRemoveNodes, reused before nextSlot grows — without
 * recycling, per-ingest node churn (topic re-synthesis) marches nextSlot
 * toward MAX_NODES until real documents get dropped as invisible. */
const freeSlots: number[] = [];
const settledListeners = new Set<() => void>();
/** One capacity toast per corpus — every over-cap add repeats the console line. */
let warnedCapacity = false;

// ---------------------------------------------------------------------------
// Crash recovery
//
// The layout worker is long-lived and stateful (it owns the running force
// simulation), unlike the request/response pipeline pool or aggregator — so
// recovering from a crash means more than freeing an in-flight request: a
// freshly spawned worker starts with an empty scene and has to be re-seeded
// with the graph it lost. `lastLinks`/`lastClusterOf`/`lastDims`/`paused`
// mirror the last state we told the worker to hold, purely so a respawn can
// replay it (the same add/links/clusters seeding sequence this file's own
// callers already use to build a worker up from scratch — see `reseed`).
// Node pins are NOT restored: they're rare, low-stakes (worst case a drag
// needs re-doing), and keeping their tracking out of this file's normal
// call paths keeps the crash-recovery diff to the state already flowing
// through layoutSetLinks/layoutSetClusters/layoutSetDims/layoutPause.
// ---------------------------------------------------------------------------

let lastLinks: { source: string; target: string; weight: number }[] = [];
let lastClusterOf: Record<string, number> = {};
let lastDims: 2 | 3 = 3;
let paused = false;

/** Crashes counted since the last one outside CRASH_WINDOW_MS; a crash that
 * follows a healthy stretch longer than the window is treated as a fresh
 * incident (worth one more respawn), not a continuation of a repeat failure. */
let crashCount = 0;
let lastCrashAt = 0;
/** A second crash this soon after a respawn means the worker (or whatever
 * input triggers it) is fundamentally broken, not a one-off — stop retrying
 * rather than spawn/crash in a loop. */
const CRASH_WINDOW_MS = 10_000;
/** Set once we give up respawning. post() becomes a silent no-op so a later
 * layoutPin/layoutSetLinks/etc. call doesn't resurrect a worker we've
 * decided is unhealthy. Only a page reload clears this (per the toast). */
let layoutDisabled = false;

function wireWorker(w: Worker): void {
  w.onmessage = (ev: MessageEvent<LayoutResponse>) => {
    const msg = ev.data;
    if (msg.type === 'tick') {
      const prev = positionBuffer.array;
      positionBuffer.array = new Float32Array(msg.buffer);
      positionBuffer.count = msg.count;
      positionBuffer.alpha = msg.alpha;
      positionBuffer.version++;
      // recycle the previous buffer back to the worker (zero-GC steady state)
      if (prev.length > 0 && prev.buffer.byteLength > 0) {
        w.postMessage(
          { type: 'returnBuffer', buffer: prev.buffer } satisfies LayoutRequest,
          [prev.buffer],
        );
      }
    } else if (msg.type === 'settled') {
      settledListeners.forEach((fn) => fn());
    }
  };
  w.onerror = (ev: ErrorEvent) => {
    handleWorkerFailure(ev.message || 'layout worker crashed');
  };
  w.onmessageerror = () => {
    handleWorkerFailure('layout worker message could not be decoded');
  };
}

function spawn(): Worker {
  const w = new Worker(new URL('../workers/layout.worker.ts', import.meta.url), {
    type: 'module',
  });
  wireWorker(w);
  return w;
}

/** Re-sends the live graph to a freshly spawned worker: every node still
 * assigned a slot (with its last known position as an exact `initial`, so
 * it doesn't fly in again), the current link set, dims, and pause state.
 * Bypasses layoutAddNodes's own dedup (it skips ids already in slotOfId,
 * which is exactly every node here — that guard exists for the normal
 * "only send genuinely new nodes" path, not this one). */
function reseed(w: Worker): void {
  const nodes: LayoutNodeInput[] = [];
  for (let slot = 0; slot < idOfSlot.length; slot++) {
    const id = idOfSlot[slot];
    if (!id) continue; // freed/never-assigned slot
    nodes.push({ id, slot, cluster: lastClusterOf[id] ?? -1, initial: getNodePosition(id) ?? undefined });
  }
  if (nodes.length > 0) w.postMessage({ type: 'add', nodes } satisfies LayoutRequest);
  if (lastLinks.length > 0) {
    w.postMessage({ type: 'links', links: lastLinks } satisfies LayoutRequest);
  }
  if (lastDims !== 3) w.postMessage({ type: 'setDims', dims: lastDims } satisfies LayoutRequest);
  if (paused) w.postMessage({ type: 'pause' } satisfies LayoutRequest);
}

function handleWorkerFailure(reason: string): void {
  if (layoutDisabled) return; // already gave up; the dying worker's last echoes don't matter
  worker?.terminate();
  worker = null;
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  crashCount = now - lastCrashAt < CRASH_WINDOW_MS ? crashCount + 1 : 1;
  lastCrashAt = now;
  console.error(`Layout worker failure: ${reason}`);
  if (crashCount > 1) {
    layoutDisabled = true;
    useUiStore
      .getState()
      .pushToast('Layout engine failed — positions frozen; reload to retry.', 'error', {
        label: 'Reload',
        run: () => window.location.reload(),
      });
    return;
  }
  useUiStore.getState().pushToast('Layout engine crashed — restarting the simulation.', 'warning');
  worker = spawn();
  reseed(worker);
}

export function ensureLayout(): Worker {
  if (worker) return worker;
  worker = spawn();
  return worker;
}

function post(msg: LayoutRequest): void {
  if (layoutDisabled) return; // no worker left, and we've decided not to respawn again
  ensureLayout().postMessage(msg);
}

/** Fires whenever the simulation cools below its alpha floor. */
export function onLayoutSettled(fn: () => void): () => void {
  settledListeners.add(fn);
  return () => settledListeners.delete(fn);
}

export interface AddNodeSpec {
  id: string;
  cluster: number;
  /** fly-in origin for live ingestion */
  spawn?: [number, number, number];
  /** exact position (cache/import restore) */
  initial?: [number, number, number];
}

/**
 * Places nodes into layout slots up to MAX_NODES. Returns the ids that
 * couldn't be placed (capacity reached) — callers must not leave those
 * nodes in the graph store, or they become invisible, unselectable
 * phantoms (present in counts, absent from the scene).
 */
export function layoutAddNodes(nodes: AddNodeSpec[]): string[] {
  const payload: LayoutNodeInput[] = [];
  const dropped: string[] = [];
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  for (const n of nodes) {
    if (slotOfId.has(n.id)) continue;
    let slot: number;
    if (freeSlots.length > 0) {
      slot = freeSlots.pop()!; // recycle before growing
    } else if (nextSlot < MAX_NODES) {
      slot = nextSlot++;
    } else {
      dropped.push(n.id);
      continue;
    }
    slotOfId.set(n.id, slot);
    idOfSlot[slot] = n.id;
    spawnAtOfSlot[slot] = n.initial ? -1 : now; // -1 = no materialize animation
    lastClusterOf[n.id] = n.cluster; // seed cache — survives a later worker respawn
    payload.push({ id: n.id, slot, cluster: n.cluster, spawn: n.spawn, initial: n.initial });
  }
  if (payload.length) post({ type: 'add', nodes: payload });
  if (dropped.length > 0) {
    console.warn(`Node capacity (${MAX_NODES}) reached; ignoring ${dropped.length} node(s)`);
    if (!warnedCapacity) {
      warnedCapacity = true;
      useUiStore
        .getState()
        .pushToast(
          `Graph is at its ${MAX_NODES.toLocaleString()}-node capacity — some items were left out (see the ignored list).`,
          'warning',
        );
    }
  }
  return dropped;
}

/**
 * Removes nodes from the layout and frees their slots for reuse. Clears every
 * per-slot metadata entry so the render loop, raycaster, and labels treat the
 * slot as empty until it's reassigned (a stale kind/scale would otherwise
 * render a ghost node at the last simulated position).
 */
export function layoutRemoveNodes(ids: string[]): void {
  const removed: string[] = [];
  for (const id of ids) {
    const slot = slotOfId.get(id);
    if (slot === undefined) continue;
    slotOfId.delete(id);
    idOfSlot[slot] = '';
    scaleOfSlot[slot] = 0;
    spawnAtOfSlot[slot] = -1;
    kindOfSlot[slot] = 0;
    ghostOfSlot[slot] = 0;
    freeSlots.push(slot);
    delete lastClusterOf[id];
    removed.push(id);
  }
  if (removed.length) post({ type: 'remove', ids: removed });
}

export function layoutSetLinks(
  links: { source: string; target: string; weight: number }[],
): void {
  lastLinks = links; // full replacement, same as what the worker holds — cache for reseed
  post({ type: 'links', links });
}

export function layoutSetClusters(clusterOf: Record<string, number>): void {
  lastClusterOf = { ...lastClusterOf, ...clusterOf };
  post({ type: 'clusters', clusterOf });
}

export function layoutReheat(alpha: number): void {
  post({ type: 'reheat', alpha });
}

export function layoutPin(id: string, x: number, y: number, z: number): void {
  post({ type: 'pin', id, x, y, z });
}

export function layoutUnpin(id: string): void {
  post({ type: 'unpin', id });
}

export function layoutSetDims(dims: 2 | 3): void {
  lastDims = dims;
  post({ type: 'setDims', dims });
}

export function layoutPause(): void {
  paused = true;
  if (worker) post({ type: 'pause' });
}

export function layoutResume(): void {
  paused = false;
  if (worker) post({ type: 'resume' });
}

/** Full teardown (new corpus / reset). */
export function layoutReset(): void {
  worker?.terminate();
  worker = null;
  nextSlot = 0;
  freeSlots.length = 0;
  warnedCapacity = false;
  lastLinks = [];
  lastClusterOf = {};
  // lastDims/paused are NOT cleared here — they track global display/runtime
  // preferences (2D lock, tab visibility), not this corpus's graph, and stay
  // correct across a reset. crashCount/lastCrashAt/layoutDisabled are also
  // left alone: once the layout engine has given up this session, a soft
  // reset shouldn't quietly try spawning a worker again — the toast already
  // told the user the recovery path is a reload.
  // NOTE: settledListeners is intentionally NOT cleared. These are long-lived
  // subscriptions (App auto-frame, session restore) registered once via effects;
  // clearing them here silently drops them across a partial removal/reset, since
  // the subscriber effects don't re-run when `hasNodes` stays true.
  resetPositionBuffer();
}
