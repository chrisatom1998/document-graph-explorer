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
import {
  idOfSlot,
  positionBuffer,
  resetPositionBuffer,
  slotOfId,
  spawnAtOfSlot,
} from '../scene/positionBuffer';

let worker: Worker | null = null;
let nextSlot = 0;
const settledListeners = new Set<() => void>();

export function ensureLayout(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/layout.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (ev: MessageEvent<LayoutResponse>) => {
    const msg = ev.data;
    if (msg.type === 'tick') {
      const prev = positionBuffer.array;
      positionBuffer.array = new Float32Array(msg.buffer);
      positionBuffer.count = msg.count;
      positionBuffer.alpha = msg.alpha;
      positionBuffer.version++;
      // recycle the previous buffer back to the worker (zero-GC steady state)
      if (prev.length > 0 && prev.buffer.byteLength > 0) {
        worker!.postMessage(
          { type: 'returnBuffer', buffer: prev.buffer } satisfies LayoutRequest,
          [prev.buffer],
        );
      }
    } else if (msg.type === 'settled') {
      settledListeners.forEach((fn) => fn());
    }
  };
  return worker;
}

function post(msg: LayoutRequest): void {
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
    if (nextSlot >= MAX_NODES) {
      dropped.push(n.id);
      continue;
    }
    const slot = nextSlot++;
    slotOfId.set(n.id, slot);
    idOfSlot[slot] = n.id;
    spawnAtOfSlot[slot] = n.initial ? -1 : now; // -1 = no materialize animation
    payload.push({ id: n.id, slot, cluster: n.cluster, spawn: n.spawn, initial: n.initial });
  }
  if (payload.length) post({ type: 'add', nodes: payload });
  if (dropped.length > 0) {
    console.warn(`Node capacity (${MAX_NODES}) reached; ignoring ${dropped.length} node(s)`);
  }
  return dropped;
}

export function layoutSetLinks(
  links: { source: string; target: string; weight: number }[],
): void {
  post({ type: 'links', links });
}

export function layoutSetClusters(clusterOf: Record<string, number>): void {
  post({ type: 'clusters', clusterOf });
}

export function layoutReheat(alpha = 0.6): void {
  post({ type: 'reheat', alpha });
}

export function layoutPin(id: string, x: number, y: number, z: number): void {
  post({ type: 'pin', id, x, y, z });
}

export function layoutUnpin(id: string): void {
  post({ type: 'unpin', id });
}

export function layoutSetDims(dims: 2 | 3): void {
  post({ type: 'setDims', dims });
}

export function layoutPause(): void {
  if (worker) post({ type: 'pause' });
}

export function layoutResume(): void {
  if (worker) post({ type: 'resume' });
}

/** Full teardown (new corpus / reset). */
export function layoutReset(): void {
  worker?.terminate();
  worker = null;
  nextSlot = 0;
  settledListeners.clear();
  resetPositionBuffer();
}
