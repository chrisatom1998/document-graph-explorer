/**
 * All edges in a single LineSegments buffer (spec §7.1), drawn as CURVED
 * polylines: each edge is a quadratic bezier (EDGE_SEGMENTS segments) bowing
 * away from the nebula core — see edgeCurve.ts for why that doubles as a
 * cheap edge-bundling stand-in. EdgePulses shares the same curve math so
 * packets ride the visible filament, not the invisible chord.
 *
 * - Geometry attributes are rebuilt when the edge list (or curve quality)
 *   changes; endpoint positions are streamed from positionBuffer each layout
 *   tick and the bezier is re-evaluated per point.
 * - Vertex colors encode kind tint x weight, fade with edge density (additive
 *   lines stack, so dense graphs would wash out the nodes otherwise), taper
 *   slightly toward mid-curve (endpoints anchor to their nodes, the long arc
 *   stays gossamer), dim to 8% when a hover/selection/search/filter emphasis
 *   is active, and brighten on edges incident to the hovered/selected node
 *   (those skip the density fade).
 * - Clicking an edge selects it for the evidence popover (uiStore
 *   .setSelectedEdge). Node spheres naturally win overlapping picks: they
 *   intersect closer and stop propagation.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { positionBuffer, slotOfId } from './positionBuffer';
import { EDGE_TINTS } from './palette';
import { computeEmphasis } from './Nodes';
import {
  EDGE_SEGMENTS,
  EDGE_SEGMENTS_DEGRADED,
  edgeControlPoint,
  evalEdgePoint,
} from './edgeCurve';

const DIM_FACTOR = 0.08;
const FOCUS_BOOST = 2.0;
// Mid-curve brightness relative to the endpoints: the arc thins out where it
// is farthest from either node, reading as a faint gradient filament.
const MID_TAPER = 0.68;

// Additive edges sum brightness where they overlap, so a fixed per-edge
// opacity turns dense graphs into a glowing hairball that hides the nodes.
// Fade per-edge brightness as the count grows (sqrt keeps the aggregate
// roughly level); the floor keeps single filaments from vanishing entirely.
const FADE_START_EDGES = 400;
const FADE_FLOOR = 0.35;

function densityFade(edgeCount: number): number {
  if (edgeCount <= FADE_START_EDGES) return 1;
  return Math.max(FADE_FLOOR, Math.sqrt(FADE_START_EDGES / edgeCount));
}

const tmpColor = new THREE.Color();
const ctrl = new Float32Array(3);
const pt = new Float32Array(3);

export default function Edges() {
  const edges = useGraphStore((s) => s.edges);
  // Bezier resolution follows the auto-quality ladder (spec §7.4): degraded
  // tiers drop to coarser arcs. Selector collapses to a boolean so the
  // component only re-renders (and rebuilds buffers) when crossing the line.
  const segments = useUiStore((s) =>
    s.qualityTier >= 3 ? EDGE_SEGMENTS_DEGRADED : EDGE_SEGMENTS,
  );
  const raycaster = useThree((s) => s.raycaster);

  const colorsDirty = useRef(true);
  const forcePositions = useRef(true);
  const lastVersion = useRef(-1);

  // Line picking tolerance (world units). Points threshold is irrelevant here.
  useEffect(() => {
    raycaster.params.Line.threshold = 1.2;
  }, [raycaster]);

  // Fresh attribute pair per edge-list / curve-resolution identity. Each edge
  // owns `segments` line segments = 2*segments vertices. positions fill per
  // frame; colors fill on edges/hover/selection/search/filter changes.
  const attrs = useMemo(() => {
    const floats = edges.length * segments * 6;
    const positions = new THREE.BufferAttribute(new Float32Array(floats), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    const colors = new THREE.BufferAttribute(new Float32Array(floats), 3);
    colors.setUsage(THREE.DynamicDrawUsage);
    return { positions, colors };
  }, [edges, segments]);

  // The default bounding sphere would be computed from the initial all-zero
  // positions and then never track the moving layout, which breaks raycast
  // culling — make it permissive instead (we already skip frustum culling).
  const geomRef = useRef<THREE.BufferGeometry>(null);
  useEffect(() => {
    forcePositions.current = true;
    colorsDirty.current = true;
    const geom = geomRef.current;
    if (geom) geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  }, [attrs]);

  useEffect(() => {
    const offUi = useUiStore.subscribe((s, prev) => {
      if (
        s.hoveredId !== prev.hoveredId ||
        s.selectedId !== prev.selectedId ||
        s.searchResults !== prev.searchResults ||
        s.filter !== prev.filter ||
        s.clusterCollapsed !== prev.clusterCollapsed ||
        s.topicNodesEnabled !== prev.topicNodesEnabled
      ) {
        colorsDirty.current = true;
      }
    });
    return offUi;
  }, []);

  /**
   * An edge the scene is currently NOT drawing. Topic edges are hidden with
   * their hubs (the octahedra only render when topicNodesEnabled) — otherwise
   * lines converge on invisible nodes in blank space. Shared by the color
   * pass and the click handler so hidden edges are also unclickable.
   */
  const isEdgeHidden = (
    e: (typeof edges)[number],
    ui: ReturnType<typeof useUiStore.getState>,
  ): boolean =>
    ui.clusterCollapsed ||
    e.weight < ui.filter.minEdgeWeight ||
    (e.kind === 'topic' && !ui.topicNodesEnabled);

  const recomputeColors = (): void => {
    const { nodes } = useGraphStore.getState();
    const ui = useUiStore.getState();
    const { hoveredId, selectedId, searchResults, filter } = ui;
    const emphasis = computeEmphasis(
      nodes,
      edges,
      hoveredId,
      selectedId,
      searchResults,
      filter,
    );
    const focusId = hoveredId ?? selectedId;
    // Count visible edges for density fade (hidden edges shouldn't dim the rest)
    let visibleCount = 0;
    for (const e of edges) if (!isEdgeHidden(e, ui)) visibleCount++;
    const fade = densityFade(visibleCount);
    const col = attrs.colors.array as Float32Array;
    const vertsPerEdge = segments * 2;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const base = i * vertsPerEdge * 3;
      // Hidden: weight below the hairball slider, collapse mode, or a topic
      // edge whose hub octahedron isn't rendered (toggle off).
      if (isEdgeHidden(e, ui)) {
        col.fill(0, base, base + vertsPerEdge * 3);
        continue;
      }
      // base: kind tint scaled by weight (opacity/brightness = weight, §7.1)
      // and by density; kept delicate so links read as fine filaments
      tmpColor.copy(EDGE_TINTS[e.kind]).multiplyScalar((0.16 + 0.55 * e.weight) * fade);
      if (emphasis && !(emphasis.has(e.source) && emphasis.has(e.target))) {
        tmpColor.multiplyScalar(DIM_FACTOR);
      }
      if (focusId && (e.source === focusId || e.target === focusId)) {
        // undo the density fade: the edges you're inspecting must stay vivid
        // precisely when the rest of the graph is at its faintest
        tmpColor.multiplyScalar(FOCUS_BOOST / fade);
        tmpColor.r = Math.min(tmpColor.r, 1);
        tmpColor.g = Math.min(tmpColor.g, 1);
        tmpColor.b = Math.min(tmpColor.b, 1);
      }
      // Vertex k of the polyline sits at curve parameter t=k/segments; taper
      // brightness toward the middle of the arc. Segment pair layout: vertex
      // 2j is point j, vertex 2j+1 is point j+1.
      for (let v = 0; v < vertsPerEdge; v++) {
        const k = (v >> 1) + (v & 1); // point index this vertex represents
        const t = k / segments;
        const taper = 1 - (1 - MID_TAPER) * 4 * t * (1 - t); // 1 at ends, MID_TAPER at t=.5
        const o = base + v * 3;
        col[o] = tmpColor.r * taper;
        col[o + 1] = tmpColor.g * taper;
        col[o + 2] = tmpColor.b * taper;
      }
    }
    attrs.colors.needsUpdate = true;
  };

  useFrame(() => {
    if (edges.length === 0) return;
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
    const pos = attrs.positions.array as Float32Array;
    const floatsPerEdge = segments * 6;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const s = slotOfId.get(e.source);
      const t = slotOfId.get(e.target);
      if (s === undefined || t === undefined || s >= count || t >= count) {
        continue; // endpoint not placed yet: keep previous (zeros collapse to a point)
      }
      const so = s * 3;
      const to = t * 3;
      const ax = arr[so];
      const ay = arr[so + 1];
      const az = arr[so + 2];
      const bx = arr[to];
      const by = arr[to + 1];
      const bz = arr[to + 2];
      edgeControlPoint(ax, ay, az, bx, by, bz, ctrl, 0);
      const base = i * floatsPerEdge;
      // Point k closes segment k-1 and opens segment k: evaluate once, write
      // to both vertex slots.
      for (let k = 0; k <= segments; k++) {
        evalEdgePoint(ax, ay, az, ctrl[0], ctrl[1], ctrl[2], bx, by, bz, k / segments, pt, 0);
        if (k > 0) {
          const o = base + ((k - 1) * 2 + 1) * 3;
          pos[o] = pt[0];
          pos[o + 1] = pt[1];
          pos[o + 2] = pt[2];
        }
        if (k < segments) {
          const o = base + k * 6;
          pos[o] = pt[0];
          pos[o + 1] = pt[1];
          pos[o + 2] = pt[2];
        }
      }
    }
    attrs.positions.needsUpdate = true;
  });

  /** Segment vertex index -> owning edge (each edge spans `segments` pairs). */
  const edgeAtIndex = (index: number): (typeof edges)[number] | undefined =>
    edges[Math.floor(index / (segments * 2))];

  const handleClick = (e: ThreeEvent<MouseEvent>): void => {
    if (e.index === undefined) return;
    const edge = edgeAtIndex(e.index);
    if (!edge) return;
    // Hidden edges (zeroed color, still in the picking geometry) must not be
    // clickable — a popover opening from apparently-empty space is a ghost UI.
    if (isEdgeHidden(edge, useUiStore.getState())) return;
    e.stopPropagation();
    useUiStore.getState().setSelectedEdge(edge.id);
  };

  // Edges are clickable (evidence popover) but nothing signalled it — show the
  // pointer cursor on hover so the affordance is discoverable. Hidden edges
  // (still present in the picking geometry) don't get the cursor either.
  const handlePointerOver = (e: ThreeEvent<PointerEvent>): void => {
    if (e.index === undefined) return;
    const edge = edgeAtIndex(e.index);
    if (!edge || isEdgeHidden(edge, useUiStore.getState())) return;
    document.body.style.cursor = 'pointer';
  };
  const handlePointerOut = (): void => {
    document.body.style.cursor = '';
  };

  if (edges.length === 0) return null;

  return (
    <lineSegments
      frustumCulled={false}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <bufferGeometry ref={geomRef}>
        <primitive object={attrs.positions} attach="attributes-position" />
        <primitive object={attrs.colors} attach="attributes-color" />
      </bufferGeometry>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={0.25}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}
