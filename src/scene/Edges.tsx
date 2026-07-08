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
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { positionBuffer, slotOfId } from './positionBuffer';
import { clusterColor, EDGE_TINTS } from './palette';
import { computeEmphasis } from './emphasis';
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

// How much of each endpoint's cluster hue bleeds into the edge gradient.
// Kind tint stays dominant (it is information — legend/popover encode it);
// reference edges are exempt so their warm amber keeps popping (spec §7.1).
const CLUSTER_BLEND = 0.35;

const srcColor = new THREE.Color();
const dstColor = new THREE.Color();
const ctrl = new Float32Array(3);
const pt = new Float32Array(3);

// Aerial perspective for the filaments: brightness eases toward uFadeMin as
// view distance runs uFadeNear -> uFadeFar, so near edges read crisper and the
// far side of a big nebula recedes instead of stacking additively at full
// strength. GPU-side (vViewZ varying) — zero per-frame CPU cost.
const FADE_NEAR = 150;
const FADE_FAR = 600;
const FADE_MIN = 0.45;

const lineMaterial = new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.25,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
});
lineMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uFadeNear = { value: FADE_NEAR };
  shader.uniforms.uFadeFar = { value: FADE_FAR };
  shader.uniforms.uFadeMin = { value: FADE_MIN };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying float vViewZ;')
    .replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n\tvViewZ = -mvPosition.z;',
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nvarying float vViewZ;\nuniform float uFadeNear;\nuniform float uFadeFar;\nuniform float uFadeMin;',
    )
    .replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n\tdiffuseColor.rgb *= mix(1.0, uFadeMin, smoothstep(uFadeNear, uFadeFar, vViewZ));',
    );
};

export default function Edges() {
  const edges = useGraphStore((s) => s.edges);
  // Bezier resolution follows the auto-quality ladder (spec §7.4): degraded
  // tiers drop to coarser arcs. Selector collapses to a boolean so the
  // component only re-renders (and rebuilds buffers) when crossing the line.
  const segments = useUiStore((s) =>
    s.qualityTier >= 3 ? EDGE_SEGMENTS_DEGRADED : EDGE_SEGMENTS,
  );
  // Ambient 2D style: straight constellation lines instead of bowed arcs
  // (the "bow away from the core" trick only earns its keep in a 3D volume).
  const flat = useUiStore((s) => s.dims === 2);
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

  // Straight vs. bowed geometry depends on `flat` — force a position rebuild
  // (and recolor, since line opacity below also reacts to it) when it flips.
  useEffect(() => {
    forcePositions.current = true;
    colorsDirty.current = true;
  }, [flat]);

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
    const clusterOf = new Map<string, number>();
    for (const n of nodes) clusterOf.set(n.id, n.cluster);
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
      // and by density; kept delicate so links read as fine filaments. Each
      // end leans toward its node's cluster hue so filaments visibly belong
      // to the communities they join (gradient across the arc).
      srcColor.copy(EDGE_TINTS[e.kind]);
      dstColor.copy(EDGE_TINTS[e.kind]);
      if (e.kind !== 'reference') {
        srcColor.lerp(clusterColor(clusterOf.get(e.source) ?? -1), CLUSTER_BLEND);
        dstColor.lerp(clusterColor(clusterOf.get(e.target) ?? -1), CLUSTER_BLEND);
      }
      let brightness = (0.16 + 0.55 * e.weight) * fade;
      // Flat mode drops the additive stacking down to a gossamer web —
      // legible constellation lines instead of a glowing hairball.
      if (flat) brightness *= 0.6;
      if (emphasis && !(emphasis.has(e.source) && emphasis.has(e.target))) {
        brightness *= DIM_FACTOR;
      }
      if (focusId && (e.source === focusId || e.target === focusId)) {
        // undo the density fade: the edges you're inspecting must stay vivid
        // precisely when the rest of the graph is at its faintest
        brightness *= FOCUS_BOOST / fade;
      }
      srcColor.multiplyScalar(brightness);
      dstColor.multiplyScalar(brightness);
      srcColor.r = Math.min(srcColor.r, 1);
      srcColor.g = Math.min(srcColor.g, 1);
      srcColor.b = Math.min(srcColor.b, 1);
      dstColor.r = Math.min(dstColor.r, 1);
      dstColor.g = Math.min(dstColor.g, 1);
      dstColor.b = Math.min(dstColor.b, 1);
      // Vertex k of the polyline sits at curve parameter t=k/segments; blend
      // src -> dst cluster-leaning tints along the arc and taper brightness
      // toward the middle. Segment pair layout: vertex 2j is point j, vertex
      // 2j+1 is point j+1.
      for (let v = 0; v < vertsPerEdge; v++) {
        const k = (v >> 1) + (v & 1); // point index this vertex represents
        const t = k / segments;
        const taper = 1 - (1 - MID_TAPER) * 4 * t * (1 - t); // 1 at ends, MID_TAPER at t=.5
        const o = base + v * 3;
        col[o] = (srcColor.r + (dstColor.r - srcColor.r) * t) * taper;
        col[o + 1] = (srcColor.g + (dstColor.g - srcColor.g) * t) * taper;
        col[o + 2] = (srcColor.b + (dstColor.b - srcColor.b) * t) * taper;
      }
    }
    attrs.colors.needsUpdate = true;
  };

  useFrame(() => {
    if (edges.length === 0) return;
    // Flat lines get zero bloom help, so the base opacity nudges up to stay
    // legible as thin constellation threads.
    lineMaterial.opacity = flat ? 0.45 : 0.25;
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
      if (flat) {
        // Control point ON the chord (exact midpoint) degenerates the
        // quadratic bezier into a straight segment — no bow.
        ctrl[0] = (ax + bx) * 0.5;
        ctrl[1] = (ay + by) * 0.5;
        ctrl[2] = (az + bz) * 0.5;
      } else {
        edgeControlPoint(ax, ay, az, bx, by, bz, ctrl, 0);
      }
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

  if (edges.length === 0) return null;

  return (
    <lineSegments frustumCulled={false}>
      <bufferGeometry ref={geomRef}>
        <primitive object={attrs.positions} attach="attributes-position" />
        <primitive object={attrs.colors} attach="attributes-color" />
      </bufferGeometry>
      <primitive object={lineMaterial} attach="material" />
    </lineSegments>
  );
}
