/**
 * Inter-cluster trunk filaments: one curved line per community pair that
 * shares at least one edge, running live-centroid to live-centroid, so the
 * corpus reads as connected islands instead of disconnected ones. The
 * individual cross-cluster edges stay exactly as faint as Edges.tsx renders
 * them — bridges ADD an aggregate layer, they don't re-brighten the hairball.
 *
 * - Structure comes from bridgeAggregation.ts (pure, tested, capped at
 *   MAX_BRIDGES); geometry is a quadratic bezier per bridge through
 *   edgeCurve.ts so trunks bow away from the core like every other filament.
 * - Endpoints follow the live cluster centroids, recomputed per layout tick
 *   from positionBuffer (same accumulate-into-reused-scratch pattern as
 *   ClusterCollapse; skipped entirely on frames where the simulation
 *   hasn't ticked).
 * - LineMaterial has ONE linewidth for the whole batch, so per-bridge width
 *   can't encode strength without a draw call per bucket; strength maps to
 *   brightness instead (additive blending makes that read as thickness) on a
 *   sqrt scale (bridge.norm). Color is a gradient between the two cluster
 *   hues, authored below the bloom threshold — context, not spectacle.
 * - Emphasis (hover/selection/search/filter) dims bridges hard, except the
 *   bridges touching the focused node's own cluster, which keep a readable
 *   fraction so "where does this island connect" survives selection.
 * - Fat ribbons at tiers 0-1, hairlines at tier >= 2 (mirrors Edges); hidden
 *   in cluster-collapse mode (ClusterCollapse draws its own inter-cluster
 *   edges) and never mounted in the 2D star chart (NebulaCanvas).
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { useFrame, useThree } from '@react-three/fiber';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { positionBuffer, slotOfId } from './positionBuffer';
import { clusterColor } from './palette';
import { computeEmphasis } from './emphasis';
import { edgeControlPoint, evalEdgePoint } from './edgeCurve';
import { aggregateBridges } from './bridgeAggregation';

// Segments per trunk: longer arcs than node edges, so a little smoother.
const BRIDGE_SEGMENTS = 12;
// Wider than Edges' 1.6px filaments — a trunk, not a highway.
const FAT_WIDTH_PX = 3.0;
const FAT_OPACITY = 0.22;
const HAIR_OPACITY = 0.4;
// Brightness ramp over bridge.norm; ceiling stays under the bloom threshold
// after the material opacity so trunks glow without bloom-flaring (Effects'
// label contract).
const BRIGHT_BASE = 0.16;
const BRIGHT_SPAN = 0.5;
// Under active emphasis bridges drop harder than edges' 8% — they're bigger.
const DIM_FACTOR = 0.06;
// ...except bridges touching the focused node's cluster, which keep this
// fraction of their brightness so the selected island's connections read.
const FOCUS_CLUSTER_KEEP = 0.6;

const NO_RAYCAST = (): void => {
  /* decoration — must never intercept node picking */
};

const srcColor = new THREE.Color();
const dstColor = new THREE.Color();
const ctrl = new Float32Array(3);
const pt = new Float32Array(3);

const hairMaterial = new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: HAIR_OPACITY,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
});

const fatMaterial = new LineMaterial({
  vertexColors: true,
  transparent: true,
  opacity: FAT_OPACITY,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
  linewidth: FAT_WIDTH_PX,
  worldUnits: false,
  alphaToCoverage: false,
  fog: true,
});

export default function ClusterBridges() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const collapsed = useUiStore((s) => s.clusterCollapsed);
  // Ribbons ride the top of the quality ladder only, mirroring Edges. The
  // dims check is defensive — NebulaCanvas doesn't mount us in 2D.
  const fat = useUiStore((s) => s.dims === 3 && s.qualityTier < 2);

  // LineMaterial converts linewidth px -> clip units via the viewport size
  // (CSS size, not drawing-buffer size — width must survive dpr changes).
  const size = useThree((s) => s.size);
  useEffect(() => {
    fatMaterial.resolution.set(size.width, size.height);
  }, [size]);

  const bridges = useMemo(() => aggregateBridges(nodes, edges), [nodes, edges]);
  const clusterOfNode = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) m.set(n.id, n.cluster);
    return m;
  }, [nodes]);

  const colorsDirty = useRef(true);
  const forcePositions = useRef(true);
  const lastVersion = useRef(-1);

  // Same segment-pair layout as Edges: per bridge, BRIDGE_SEGMENTS segments =
  // 2*segments vertices of 3 floats. Positions stream per layout tick; colors
  // refill on structure/emphasis changes.
  const attrs = useMemo(() => {
    const floats = bridges.length * BRIDGE_SEGMENTS * 6;
    const positions = new THREE.BufferAttribute(new Float32Array(floats), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    const colors = new THREE.BufferAttribute(new Float32Array(floats), 3);
    colors.setUsage(THREE.DynamicDrawUsage);
    return { positions, colors };
  }, [bridges]);

  // Fat path wraps the SAME arrays (setPositions/setColors keep the
  // Float32Array by reference), so the fill code feeds both render paths.
  const fatGeom = useMemo(() => {
    if (!fat || bridges.length === 0) return null;
    const g = new LineSegmentsGeometry();
    g.setPositions(attrs.positions.array as Float32Array);
    g.setColors(attrs.colors.array as Float32Array);
    (g.attributes.instanceStart as THREE.InterleavedBufferAttribute).data.setUsage(
      THREE.DynamicDrawUsage,
    );
    (g.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data.setUsage(
      THREE.DynamicDrawUsage,
    );
    return g;
  }, [attrs, fat, bridges.length]);

  const fatLine = useMemo(() => {
    if (!fatGeom) return null;
    const obj = new LineSegments2(fatGeom, fatMaterial);
    obj.frustumCulled = false; // endpoints move every tick; culling volume would lag
    obj.raycast = NO_RAYCAST;
    return obj;
  }, [fatGeom]);

  useEffect(() => {
    if (!fatGeom) return;
    return () => fatGeom.dispose();
  }, [fatGeom]);

  // Hairline geometry persists across attrs swaps — release superseded GPU
  // buffers and keep the bounding sphere permissive (same as Edges).
  const geomRef = useRef<THREE.BufferGeometry>(null);
  useEffect(() => {
    forcePositions.current = true;
    colorsDirty.current = true;
    const geom = geomRef.current;
    if (geom) {
      geom.dispose();
      geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    }
  }, [attrs]);

  useEffect(() => {
    return useUiStore.subscribe((s, prev) => {
      if (
        s.hoveredId !== prev.hoveredId ||
        s.selectedId !== prev.selectedId ||
        s.searchResults !== prev.searchResults ||
        s.filter !== prev.filter
      ) {
        colorsDirty.current = true;
      }
      // Un-collapsing: positions went stale while the layer was frozen.
      if (s.clusterCollapsed !== prev.clusterCollapsed) {
        colorsDirty.current = true;
        forcePositions.current = true;
      }
    });
  }, []);

  const recomputeColors = (): void => {
    const ui = useUiStore.getState();
    const emphasis = computeEmphasis(
      nodes,
      edges,
      ui.hoveredId,
      ui.selectedId,
      ui.searchResults,
      ui.filter,
    );
    const focusId = ui.hoveredId ?? ui.selectedId;
    const focusCluster = focusId ? (clusterOfNode.get(focusId) ?? -1) : -1;
    const col = attrs.colors.array as Float32Array;
    const vertsPerBridge = BRIDGE_SEGMENTS * 2;
    for (let i = 0; i < bridges.length; i++) {
      const bridge = bridges[i];
      let brightness = BRIGHT_BASE + BRIGHT_SPAN * bridge.norm;
      if (emphasis) {
        brightness *=
          focusCluster >= 0 && (bridge.a === focusCluster || bridge.b === focusCluster)
            ? FOCUS_CLUSTER_KEEP
            : DIM_FACTOR;
      }
      srcColor.copy(clusterColor(bridge.a)).multiplyScalar(brightness);
      dstColor.copy(clusterColor(bridge.b)).multiplyScalar(brightness);
      const base = i * vertsPerBridge * 3;
      // Uniform along the arc (no mid-taper): trunks read as solid conduits,
      // the gradient alone marks which end is which.
      for (let v = 0; v < vertsPerBridge; v++) {
        const k = (v >> 1) + (v & 1); // point index this vertex represents
        const t = k / BRIDGE_SEGMENTS;
        const o = base + v * 3;
        col[o] = srcColor.r + (dstColor.r - srcColor.r) * t;
        col[o + 1] = srcColor.g + (dstColor.g - srcColor.g) * t;
        col[o + 2] = srcColor.b + (dstColor.b - srcColor.b) * t;
      }
    }
    attrs.colors.needsUpdate = true;
    if (fatGeom) {
      (fatGeom.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data.needsUpdate =
        true;
    }
  };

  // Reused per-frame centroid scratch (zero-GC steady state, see
  // ClusterCollapse for the pattern rationale).
  const sumsRef = useRef(new Map<number, { x: number; y: number; z: number; n: number }>());

  useFrame(() => {
    if (bridges.length === 0 || collapsed) return;
    if (colorsDirty.current) {
      recomputeColors();
      colorsDirty.current = false;
    }
    const version = positionBuffer.version;
    if (version === lastVersion.current && !forcePositions.current) return;
    lastVersion.current = version;
    forcePositions.current = false;

    const arr = positionBuffer.array;
    const count = positionBuffer.count;
    const sums = sumsRef.current;
    for (const s of sums.values()) {
      s.x = 0;
      s.y = 0;
      s.z = 0;
      s.n = 0;
    }
    for (const n of nodes) {
      if (n.cluster < 0) continue;
      const slot = slotOfId.get(n.id);
      if (slot === undefined || slot >= count) continue;
      const o = slot * 3;
      let s = sums.get(n.cluster);
      if (!s) {
        s = { x: 0, y: 0, z: 0, n: 0 };
        sums.set(n.cluster, s);
      }
      s.x += arr[o];
      s.y += arr[o + 1];
      s.z += arr[o + 2];
      s.n++;
    }

    const pos = attrs.positions.array as Float32Array;
    const floatsPerBridge = BRIDGE_SEGMENTS * 6;
    for (let i = 0; i < bridges.length; i++) {
      const bridge = bridges[i];
      const sa = sums.get(bridge.a);
      const sb = sums.get(bridge.b);
      if (!sa || !sb || sa.n === 0 || sb.n === 0) {
        continue; // cluster not placed yet: keep previous (zeros collapse to a point)
      }
      const ax = sa.x / sa.n;
      const ay = sa.y / sa.n;
      const az = sa.z / sa.n;
      const bx = sb.x / sb.n;
      const by = sb.y / sb.n;
      const bz = sb.z / sb.n;
      edgeControlPoint(ax, ay, az, bx, by, bz, ctrl, 0);
      const base = i * floatsPerBridge;
      // Point k closes segment k-1 and opens segment k (same as Edges).
      for (let k = 0; k <= BRIDGE_SEGMENTS; k++) {
        evalEdgePoint(
          ax, ay, az, ctrl[0], ctrl[1], ctrl[2], bx, by, bz,
          k / BRIDGE_SEGMENTS, pt, 0,
        );
        if (k > 0) {
          const o = base + ((k - 1) * 2 + 1) * 3;
          pos[o] = pt[0];
          pos[o + 1] = pt[1];
          pos[o + 2] = pt[2];
        }
        if (k < BRIDGE_SEGMENTS) {
          const o = base + k * 6;
          pos[o] = pt[0];
          pos[o + 1] = pt[1];
          pos[o + 2] = pt[2];
        }
      }
    }
    attrs.positions.needsUpdate = true;
    if (fatGeom) {
      (fatGeom.attributes.instanceStart as THREE.InterleavedBufferAttribute).data.needsUpdate =
        true;
    }
  });

  if (bridges.length === 0 || collapsed) return null;

  if (fatLine) return <primitive object={fatLine} />;

  return (
    <lineSegments frustumCulled={false} raycast={NO_RAYCAST}>
      <bufferGeometry ref={geomRef}>
        <primitive object={attrs.positions} attach="attributes-position" />
        <primitive object={attrs.colors} attach="attributes-color" />
      </bufferGeometry>
      <primitive object={hairMaterial} attach="material" />
    </lineSegments>
  );
}
