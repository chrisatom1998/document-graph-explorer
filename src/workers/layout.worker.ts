/// <reference lib="webworker" />
/**
 * d3-force-3d layout simulation worker (spec §7.2, §7.4).
 *
 * Speaks the LayoutRequest/LayoutResponse protocol from src/model/types.ts.
 * Positions travel to the main thread as transferable Float32Arrays indexed
 * by slot (slot assignment is owned by layoutBridge); the bridge sends spent
 * buffers back via 'returnBuffer' so steady-state ticking allocates nothing.
 *
 * Implementation notes:
 * - 'pin' uses d3's intended drag idiom: the first pin of a drag raises
 *   sim.alphaTarget (and restarts a stopped sim) so the drag renders;
 *   subsequent pins only move fx/fy/fz. The drag is considered over when
 *   pins stop arriving for DRAG_IDLE_END_MS (or an explicit 'unpin' lands),
 *   at which point alphaTarget returns to 0 and the sim cools normally.
 *   Re-flooring alpha on every pin message (~30/s) kept the WHOLE graph
 *   drifting for the entire drag.
 * - After numDimensions(2), d3-force-3d simply stops integrating z, so we
 *   explicitly zero z/vz to flatten the buffer. Switching back to 3 seeds a
 *   tiny z jitter; per-axis jiggle in the forces would recover eventually,
 *   but seeding makes the re-inflation immediate.
 */

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
} from 'd3-force-3d';
import type { Force, SimLink } from 'd3-force-3d';
import type { LayoutRequest, LayoutResponse } from '../model/types';
import { randomSpherePoint } from '../pipeline/spawnPosition';

declare const self: DedicatedWorkerGlobalScope;

interface LayoutNode {
  id: string;
  slot: number;
  cluster: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
  index?: number;
  [key: string]: unknown;
}

interface LayoutLink {
  source: string | LayoutNode;
  target: string | LayoutNode;
  weight: number;
  index?: number;
  [key: string]: unknown;
}

const SETTLE_ALPHA = 0.005; // below this we declare the layout settled
const POST_INTERVAL_MS = 16; // ~one position post per 60Hz frame (33ms aliased against 16.7ms frames)
/** With the pool empty and this many posts unreturned, the main thread is
 * behind — skip the post instead of allocating fresh buffers it can't keep
 * up with (dropping a tick is free; the next one carries newer positions). */
const MAX_IN_FLIGHT_POSTS = 2;
/** alphaTarget held while a node drag is live (d3 drag idiom). */
const DRAG_ALPHA_TARGET = 0.05;
/** No pin message for this long = the drag ended (release keeps the node
 * pinned, so no protocol message marks the end of the gesture). */
const DRAG_IDLE_END_MS = 300;
const CLUSTER_PULL = 0.05;
const SPAWN_JITTER = 4;
/** Nodes settle ON this sphere shell (spec §7: "orbiting" arrangement).
 * Grows with node count so surface density — and thus label legibility —
 * stays roughly constant. The collide radius drives the shell radius
 * (updateShellRadius), so it is the master spacing knob: raising it grows
 * per-node breathing room across the whole nebula. */
const SHELL_MIN_RADIUS = 72;
const NODE_COLLIDE_RADIUS = 5;
// Must dominate the link force: a dense corpus (avg degree ~10) otherwise
// drags the whole shell inward into a ball.
const SHELL_STRENGTH = 0.9;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const nodes: LayoutNode[] = [];
const nodeById = new Map<string, LayoutNode>();
/** Desired link set as raw ids; re-filtered against sim membership on apply. */
let rawLinks: { source: string; target: string; weight: number }[] = [];
let maxSlot = -1;
let dims: 2 | 3 = 3;
let paused = false;
let settledSent = false;
let lastPost = 0;
/** Mirrors the main-thread setDims epoch so settled messages can be matched
 * to the dims change that caused that reheat. */
let epoch = 0;
/** Node id of the live drag (null when no drag is in progress). */
let dragId: string | null = null;
let dragEndTimer: ReturnType<typeof setTimeout> | null = null;

/** The drag gesture is over (pins stopped, or explicit unpin): let the sim
 * cool naturally instead of holding alpha at the drag floor. */
function endDrag(): void {
  if (dragEndTimer !== null) {
    clearTimeout(dragEndTimer);
    dragEndTimer = null;
  }
  if (dragId === null) return;
  dragId = null;
  sim.alphaTarget(0);
}

// --- transferable buffer pool (grow 1.5x, drop undersized returns) ---------
const pool: ArrayBuffer[] = [];
let capacityFloats = 0;
/** Tick posts not yet returned via 'returnBuffer' (main-thread backpressure). */
let inFlight = 0;

function acquireBuffer(neededFloats: number): ArrayBuffer {
  while (pool.length > 0) {
    const buf = pool.pop()!;
    if (buf.byteLength >= neededFloats * 4) return buf;
    // undersized (node count outgrew it) -> drop and let GC take it
  }
  // Grow capacity only when the corpus outgrew it (with 1.5x headroom). An
  // ordinary pool miss — the main thread simply hasn't returned the previous
  // buffer yet, routine whenever render frames run slower than sim ticks —
  // must NOT compound capacity: doing so grew the allocation exponentially
  // per miss until `new ArrayBuffer` threw RangeError on every tick.
  if (neededFloats > capacityFloats) {
    capacityFloats = Math.max(neededFloats, Math.ceil(capacityFloats * 1.5), 96);
  }
  return new ArrayBuffer(capacityFloats * 4);
}

// ---------------------------------------------------------------------------
// Sphere shell: nodes are pulled onto a sphere whose radius grows with node
// count; cluster anchors sit ON that same shell (fibonacci-distributed), so
// clusters form "continents" instead of collapsing into a central blob.
// ---------------------------------------------------------------------------

let shellRadius = SHELL_MIN_RADIUS;

function updateShellRadius(): void {
  const r = Math.max(
    SHELL_MIN_RADIUS,
    NODE_COLLIDE_RADIUS * 2.2 * Math.sqrt(nodes.length),
  );
  if (r === shellRadius) return;
  shellRadius = r;
  radialForce.radius(r);
  rebuildAnchors();
}

const anchors = new Map<number, [number, number, number]>();

/** Anchor placement is a pure function of the cluster ID via the golden-ratio
 * Weyl sequence on the sphere — never of which clusters currently exist or
 * how many. Deriving the anchor from a cluster's index in the sorted
 * present-cluster list meant any cluster appearing/disappearing (Louvain
 * re-clusters repeatedly during ingest) moved EVERY anchor. Hashing into a
 * fixed 32-seat domain avoided that shuffle but collided once Louvain (or
 * the empty-edge singleton path) produced more than 32 communities. */
const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function rebuildAnchors(): void {
  anchors.clear();
  const seen = new Set<number>();
  for (const n of nodes) if (n.cluster >= 0) seen.add(n.cluster);
  for (const id of seen) {
    const y = 1 - 2 * (((id + 0.5) * GOLDEN_RATIO) % 1);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN_ANGLE * id;
    anchors.set(id, [
      Math.cos(theta) * r * shellRadius,
      y * shellRadius,
      Math.sin(theta) * r * shellRadius,
    ]);
  }
}

function makeClusterForce(): Force<LayoutNode> {
  let simNodes: LayoutNode[] = [];
  const apply = (alpha: number): void => {
    const k = CLUSTER_PULL * alpha;
    for (let i = 0; i < simNodes.length; i++) {
      const n = simNodes[i];
      const anchor = anchors.get(n.cluster); // cluster -1 / unknown -> none (strength 0)
      if (!anchor) continue;
      n.vx += (anchor[0] - n.x) * k;
      n.vy += (anchor[1] - n.y) * k;
      n.vz += (anchor[2] - n.z) * k;
    }
  };
  return Object.assign(apply, {
    initialize(ns: LayoutNode[]): void {
      simNodes = ns;
    },
  });
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function linkWeight(l: SimLink<LayoutNode>): number {
  const w = (l as LayoutLink).weight;
  return typeof w === 'number' ? w : 0.5;
}

// Links shape neighborhoods ON the shell; kept weak so a dense corpus can't
// drag the sphere inward (the radial force owns the global radius).
const linkForce = forceLink<LayoutNode>([])
  .id((d) => d.id)
  .strength((l) => 0.01 + 0.09 * linkWeight(l))
  .distance((l) => 18 + 38 * (1 - linkWeight(l)));

const radialForce = forceRadial<LayoutNode>(SHELL_MIN_RADIUS, 0, 0, 0).strength(
  SHELL_STRENGTH,
);

const sim = forceSimulation<LayoutNode>(nodes, 3)
  .force('link', linkForce)
  .force('charge', forceManyBody<LayoutNode>().strength(-55).distanceMax(450))
  .force('center', forceCenter<LayoutNode>(0, 0, 0).strength(0.02))
  .force('shell', radialForce)
  .force('collide', forceCollide<LayoutNode>(NODE_COLLIDE_RADIUS).strength(0.85))
  .force('cluster', makeClusterForce());

// d3 starts its internal timer on construction; don't burn cycles on an
// empty graph — the first 'add' restarts it.
sim.stop();

/** Re-set the link force from rawLinks, dropping links whose endpoints are
 * not in the sim yet (forceLink throws on unknown ids). Called after every
 * nodes() change too, because forceLink re-initializes then — this also
 * revives links that were dropped while an endpoint hadn't arrived. */
function applyLinks(): void {
  const live: LayoutLink[] = [];
  for (const l of rawLinks) {
    if (nodeById.has(l.source) && nodeById.has(l.target)) {
      live.push({ source: l.source, target: l.target, weight: l.weight });
    }
  }
  linkForce.links(live);
}

function reheat(alpha: number): void {
  sim.alpha(Math.max(sim.alpha(), alpha));
  settledSent = false;
  if (!paused) sim.restart();
}

function postPositions(alpha: number, force = false): void {
  const count = maxSlot + 1;
  if (count <= 0) return;
  // Backpressure: an empty pool with posts still unreturned means the main
  // thread is not keeping up — allocating a fresh buffer per tick only piles
  // garbage (~48KB each) onto its queue. Skip the post; forced posts (final
  // settle flush) always go through so positions land current.
  if (!force && pool.length === 0 && inFlight >= MAX_IN_FLIGHT_POSTS) return;
  const needed = count * 3;
  const buffer = acquireBuffer(needed);
  const arr = new Float32Array(buffer);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const o = n.slot * 3;
    arr[o] = n.x;
    arr[o + 1] = n.y;
    arr[o + 2] = n.z;
  }
  inFlight++;
  self.postMessage({ type: 'tick', buffer, count, alpha } satisfies LayoutResponse, [buffer]);
}

function settle(alpha: number): void {
  // Final tick post first so main-thread positions are current, then settle.
  postPositions(alpha, true);
  settledSent = true;
  self.postMessage({ type: 'settled', epoch } satisfies LayoutResponse);
  sim.stop();
}

sim.on('tick', () => {
  if (nodes.length === 0) return;
  const alpha = sim.alpha();
  if (alpha < SETTLE_ALPHA) {
    // Never settle mid-drag: alphaTarget is raised, so alpha is climbing —
    // stopping here would freeze the drag render.
    if (!settledSent && dragId === null) settle(alpha);
    return;
  }
  const now = performance.now();
  if (now - lastPost < POST_INTERVAL_MS) return;
  lastPost = now;
  postPositions(alpha);
});

// Safety net: if the sim cools past d3's own alphaMin (0.001) without our
// settle firing, flush once here.
sim.on('end', () => {
  if (nodes.length === 0 || settledSent) return;
  settle(sim.alpha());
});

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

/** Fly in from outside the settled shell, around its *current* (runtime,
 * node-count-dependent) radius — shares the sphere-sampling math in
 * pipeline/spawnPosition.ts, but that radius is only known here. */
function randomShellPoint(): [number, number, number] {
  return randomSpherePoint(shellRadius * 1.8);
}

self.onmessage = (ev: MessageEvent<LayoutRequest>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'add': {
      let gentle = true; // stays true only when every added node came with `initial`
      let added = 0;
      for (const spec of msg.nodes) {
        if (nodeById.has(spec.id)) continue;
        let x: number;
        let y: number;
        let z: number;
        if (spec.initial) {
          // exact restore position, zero velocity
          [x, y, z] = spec.initial;
        } else if (spec.spawn) {
          x = spec.spawn[0] + (Math.random() - 0.5) * SPAWN_JITTER;
          y = spec.spawn[1] + (Math.random() - 0.5) * SPAWN_JITTER;
          z = spec.spawn[2] + (Math.random() - 0.5) * SPAWN_JITTER;
          gentle = false;
        } else {
          [x, y, z] = randomShellPoint();
          gentle = false;
        }
        // A persisted NaN/Infinity (corrupt cache read) propagates through
        // forceManyBody to EVERY node within one tick and blanks the graph —
        // and then self-perpetuates via the position cache. Fall back to the
        // random spawn the node would otherwise get.
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          [x, y, z] = randomShellPoint();
          gentle = false;
        }
        if (dims === 2) z = 0;
        const node: LayoutNode = {
          id: spec.id,
          slot: spec.slot,
          cluster: spec.cluster,
          x,
          y,
          z,
          vx: 0,
          vy: 0,
          vz: 0,
        };
        nodes.push(node);
        nodeById.set(spec.id, node);
        if (spec.slot > maxSlot) maxSlot = spec.slot;
        added += 1;
      }
      if (added === 0) break;
      sim.nodes(nodes); // re-initializes every force
      applyLinks(); // forceLink resets on nodes(); re-set (and revive) links
      updateShellRadius(); // shell grows with the corpus
      rebuildAnchors(); // restore path can introduce clusters via 'add'
      // Scale the reheat with the FRACTION of new nodes: adding 1 node to a
      // settled 500-node graph barely warms the sim, while a fresh corpus
      // still gets the full hot start. A flat 0.9 per message meant a large
      // ingest violently re-threw every already-placed node on every batch.
      reheat(gentle ? 0.05 : Math.min(0.9, 0.15 + (0.75 * added) / nodes.length));
      break;
    }

    case 'remove': {
      const gone = new Set(msg.ids);
      let removed = false;
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (gone.has(nodes[i].id)) {
          nodeById.delete(nodes[i].id);
          nodes.splice(i, 1);
          removed = true;
        }
      }
      if (!removed) break;
      // Freed slots keep stale values in the position buffer; the render side
      // skips them via its own slot bookkeeping. Recompute maxSlot so the
      // posted buffer can shrink when the tail slots were freed.
      maxSlot = -1;
      for (const n of nodes) if (n.slot > maxSlot) maxSlot = n.slot;
      sim.nodes(nodes); // re-initializes every force
      applyLinks(); // drops links whose endpoint just left the sim
      updateShellRadius();
      rebuildAnchors();
      reheat(0.1); // gentle: neighbors reflow into the gap without a jolt
      break;
    }

    case 'links': {
      rawLinks = msg.links;
      applyLinks();
      reheat(0.3);
      break;
    }

    case 'clusters': {
      for (const n of nodes) {
        const c = msg.clusterOf[n.id];
        if (c !== undefined) n.cluster = c;
      }
      rebuildAnchors();
      reheat(0.3);
      break;
    }

    case 'reheat': {
      reheat(msg.alpha);
      break;
    }

    case 'pin': {
      const n = nodeById.get(msg.id);
      if (n) {
        n.fx = msg.x;
        n.fy = msg.y;
        n.fz = dims === 2 ? 0 : msg.z;
        // d3's drag idiom: raise alphaTarget once at drag start (restarting a
        // stopped sim so the drag renders); later pins only move the fixed
        // point. See the header note — reheating per pin message re-floored
        // alpha ~30x/s and kept the whole graph drifting.
        if (dragId !== msg.id) {
          dragId = msg.id;
          sim.alphaTarget(DRAG_ALPHA_TARGET);
          sim.alpha(Math.max(sim.alpha(), DRAG_ALPHA_TARGET));
          settledSent = false;
          if (!paused) sim.restart();
        }
        if (dragEndTimer !== null) clearTimeout(dragEndTimer);
        dragEndTimer = setTimeout(endDrag, DRAG_IDLE_END_MS);
      }
      break;
    }

    case 'unpin': {
      endDrag();
      const n = nodeById.get(msg.id);
      if (n) {
        n.fx = null;
        n.fy = null;
        n.fz = null;
        reheat(0.3);
      }
      break;
    }

    case 'setDims': {
      epoch = typeof msg.epoch === 'number' ? msg.epoch : epoch + 1;
      dims = msg.dims;
      sim.numDimensions(dims);
      if (dims === 2) {
        // numDimensions(2) merely stops integrating z — flatten explicitly.
        for (const n of nodes) {
          n.z = 0;
          n.vz = 0;
          if (n.fz != null) n.fz = 0;
        }
      } else {
        // seed a little z so the graph re-inflates immediately
        for (const n of nodes) {
          if (n.fz == null) n.z += (Math.random() - 0.5) * 2;
        }
      }
      reheat(0.5);
      break;
    }

    case 'pause': {
      paused = true;
      sim.stop();
      break;
    }

    case 'resume': {
      paused = false;
      if (!settledSent) sim.restart();
      break;
    }

    case 'returnBuffer': {
      pool.push(msg.buffer);
      if (inFlight > 0) inFlight -= 1;
      break;
    }
  }
};
