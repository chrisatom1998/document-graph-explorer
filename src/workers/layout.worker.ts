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
 * - 'pin' bumps alpha to 0.12 and restarts the sim. The protocol doesn't
 *   mandate it, but without a restart a drag on a settled (stopped) graph
 *   would not render until some other reheat arrived.
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
const POST_INTERVAL_MS = 33; // ~30 position posts per second
const CLUSTER_PULL = 0.05;
const SPAWN_JITTER = 4;
/** Nodes settle ON this sphere shell (spec §7: "orbiting" arrangement).
 * Grows with node count so surface density — and thus label legibility —
 * stays roughly constant. */
const SHELL_MIN_RADIUS = 60;
const NODE_COLLIDE_RADIUS = 4;
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

// --- transferable buffer pool (grow 1.5x, drop undersized returns) ---------
const pool: ArrayBuffer[] = [];
let capacityFloats = 0;

function acquireBuffer(neededFloats: number): ArrayBuffer {
  while (pool.length > 0) {
    const buf = pool.pop()!;
    if (buf.byteLength >= neededFloats * 4) return buf;
    // undersized (node count outgrew it) -> drop and let GC take it
  }
  capacityFloats = Math.max(neededFloats, Math.ceil(capacityFloats * 1.5), 96);
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

function rebuildAnchors(): void {
  anchors.clear();
  const seen = new Set<number>();
  for (const n of nodes) if (n.cluster >= 0) seen.add(n.cluster);
  const ids = Array.from(seen).sort((a, b) => a - b);
  const count = Math.max(ids.length, 2);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let j = 0; j < ids.length; j++) {
    const y = 1 - (2 * (j + 0.5)) / count;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * j;
    anchors.set(ids[j], [
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
  .distance((l) => 14 + 30 * (1 - linkWeight(l)));

const radialForce = forceRadial<LayoutNode>(SHELL_MIN_RADIUS, 0, 0, 0).strength(
  SHELL_STRENGTH,
);

const sim = forceSimulation<LayoutNode>(nodes, 3)
  .force('link', linkForce)
  .force('charge', forceManyBody<LayoutNode>().strength(-40).distanceMax(400))
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

function postPositions(alpha: number): void {
  const count = maxSlot + 1;
  if (count <= 0) return;
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
  self.postMessage({ type: 'tick', buffer, count, alpha } satisfies LayoutResponse, [buffer]);
}

function settle(alpha: number): void {
  // Final tick post first so main-thread positions are current, then settle.
  postPositions(alpha);
  settledSent = true;
  self.postMessage({ type: 'settled' } satisfies LayoutResponse);
  sim.stop();
}

sim.on('tick', () => {
  if (nodes.length === 0) return;
  const alpha = sim.alpha();
  if (alpha < SETTLE_ALPHA) {
    if (!settledSent) settle(alpha);
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

function randomShellPoint(): [number, number, number] {
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - u * u));
  const spawnR = shellRadius * 1.8; // fly in from outside the settled shell
  return [
    spawnR * r * Math.cos(theta),
    spawnR * u,
    spawnR * r * Math.sin(theta),
  ];
}

self.onmessage = (ev: MessageEvent<LayoutRequest>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'add': {
      let gentle = true; // stays true only when every added node came with `initial`
      let added = false;
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
        added = true;
      }
      if (!added) break;
      sim.nodes(nodes); // re-initializes every force
      applyLinks(); // forceLink resets on nodes(); re-set (and revive) links
      updateShellRadius(); // shell grows with the corpus
      rebuildAnchors(); // restore path can introduce clusters via 'add'
      reheat(gentle ? 0.05 : 0.9);
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
        reheat(0.12); // keep the sim live so the drag renders (see header note)
      }
      break;
    }

    case 'unpin': {
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
      break;
    }
  }
};
