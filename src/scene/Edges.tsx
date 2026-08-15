/**
 * All edges in a single batched buffer (spec §7.1), drawn as CURVED
 * polylines: each edge is a quadratic bezier (EDGE_SEGMENTS segments) bowing
 * away from the nebula core — see edgeCurve.ts for why that doubles as a
 * cheap edge-bundling stand-in. EdgePulses shares the same curve math so
 * packets ride the visible filament, not the invisible chord.
 *
 * Two render paths over the SAME position/color arrays (identical segment-
 * pair layout, so the fill code below serves both):
 * - Fat lines (tiers 0-1, 3D): LineSegments2 ribbons with a constant CSS-px
 *   width. GL_LINES hairlines are 1 device px everywhere (linewidth is
 *   ignored), which reads as thread-thin wireframe on retina next to the
 *   glossy nodes; the ribbons let edges participate in the bloom aesthetic.
 * - Hairlines (tier >= 2, and always in the 2D star chart, whose delicate
 *   hairline look is intentional): the original LineSegments path.
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
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { useFrame, useThree } from '@react-three/fiber';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { positionBuffer, slotOfId, spawnAtOfSlot } from './positionBuffer';
import { clusterColor, EDGE_TINTS, FLAT_EDGE, FLAT_EDGE_FOCUS } from './palette';
import { computeEmphasis } from './emphasis';
import { prefersReducedMotion } from '../util/motion';
import {
  edgeKey,
  edgeRevealFactor,
  slotHasMaterialized,
  writeSlotTravelPosition,
} from './ingestBirth';
import { isPathHop, pathHopSet } from './pathRoute';
import {
  EDGE_SEGMENTS,
  EDGE_SEGMENTS_DEGRADED,
  edgeControlPoint,
  evalEdgePoint,
} from './edgeCurve';

const FOCUS_BOOST = 2.5;
// Mid-curve brightness relative to the endpoints: the arc thins out where it
// is farthest from either node, reading as a faint gradient filament.
const MID_TAPER = 0.68;
// 2D star chart: hairlines are fainter than the nebula filaments and carry a
// single uniform tint (weight still maps to brightness; kind moves to the
// popover/legend and the pulse colors).
const FLAT_BRIGHT_BASE = 0.14;
const FLAT_BRIGHT_WEIGHT = 0.34;

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
const edgeSrc = { x: 0, y: 0, z: 0 };
const edgeDst = { x: 0, y: 0, z: 0 };
const edgeAppearAt = new Map<string, number>();

// Aerial perspective for the filaments: brightness eases toward uFadeMin as
// view distance runs uFadeNear -> uFadeFar, so near edges read crisper and the
// far side of a big nebula recedes instead of stacking additively at full
// strength. GPU-side (vViewZ varying) — zero per-frame CPU cost.
const FADE_NEAR = 150;
const FADE_FAR = 600;
const FADE_MIN = 0.45;

/** Inputs shared by every edge of one color pass (see colorCtx below). */
interface EdgeColorCtx {
  emphasis: ReturnType<typeof computeEmphasis>;
  focusId: string | null;
  flat: boolean;
  fade: number;
  clusterOf: Map<string, number>;
  pathHops: ReturnType<typeof pathHopSet> | null;
}

// Fragment half of the fade is identical for both materials; the vertex-side
// vViewZ write differs per material (different shader anchors), so each
// onBeforeCompile patches that itself.
function injectFadeFragment(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uFadeNear = { value: FADE_NEAR };
  shader.uniforms.uFadeFar = { value: FADE_FAR };
  shader.uniforms.uFadeMin = { value: FADE_MIN };
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nvarying float vViewZ;\nuniform float uFadeNear;\nuniform float uFadeFar;\nuniform float uFadeMin;',
    )
    .replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n\tdiffuseColor.rgb *= mix(1.0, uFadeMin, smoothstep(uFadeNear, uFadeFar, vViewZ));',
    );
}

const lineMaterial = new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.25,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
});
lineMaterial.onBeforeCompile = (shader) => {
  injectFadeFragment(shader);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying float vViewZ;')
    .replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n\tvViewZ = -mvPosition.z;',
    );
};

// Fat-line pass: width in CSS px (constant across the dpr ladder — degraded
// resolutions must not thin the filaments). Opacity sits well below the
// hairline's 0.25: a ~1.6px ribbon covers roughly 3x the pixels of a
// 1-device-px hairline, and with additive blending coverage reads as
// brightness. fog matches the hairline (ShaderMaterial defaults it off).
const FAT_WIDTH_PX = 1.6;
const FAT_OPACITY = 0.14;

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
fatMaterial.onBeforeCompile = (shader) => {
  injectFadeFragment(shader);
  // LineMaterial has its own vertex shader (no project_vertex include); its
  // per-vertex view-space position is the `mvPosition` approximation near the
  // end of main(). Anchor checked against the installed three@0.185 source.
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying float vViewZ;')
    .replace(
      'vec4 mvPosition = ( position.y < 0.5 ) ? start : end;',
      'vec4 mvPosition = ( position.y < 0.5 ) ? start : end;\n\tvViewZ = -mvPosition.z;',
    );
};

export default function Edges() {
  const edges = useGraphStore((s) => s.edges);
  const dims = useUiStore((s) => s.dims);
  const qualityTier = useUiStore((s) => s.qualityTier);
  // Bezier resolution follows the auto-quality ladder (spec §7.4): degraded
  // tiers drop to coarser arcs. Selector collapses to a boolean so the
  // component only re-renders (and rebuilds buffers) when crossing the line.
  const segments = useUiStore((s) =>
    s.qualityTier >= 3 ? EDGE_SEGMENTS_DEGRADED : EDGE_SEGMENTS,
  );
  // Ribbons cost ~4x the vertices of GL_LINES, so they ride the top of the
  // quality ladder only; the 2D star chart keeps hairlines by design.
  const fat = useUiStore((s) => s.dims === 3 && s.qualityTier < 2);
  // Effective cap computed OUTSIDE the memo: tier changes that land on the
  // same cap (tier 0 vs 1, or any tier while edges.length <= 1800) must keep
  // the array identity — a new identity reallocates both ~430KB attribute
  // buffers, rebuilds/disposes the fat-line geometry, and blanks edges for a
  // frame. dims/qualityTier feed the memo only through the cap.
  const edgeCap =
    edges.length <= 1800 ? Infinity : dims === 2 ? 900 : qualityTier >= 2 ? 1200 : 1500;
  const renderEdges = useMemo(() => {
    if (edgeCap === Infinity) return edges;
    const ranked = [...edges].sort((a, b) => b.weight - a.weight);
    return ranked.slice(0, Math.max(edgeCap, 1));
  }, [edges, edgeCap]);
  const raycaster = useThree((s) => s.raycaster);

  // LineMaterial needs the viewport size to convert linewidth px -> clip
  // units. CSS size (not drawing-buffer size) so width survives dpr changes.
  const size = useThree((s) => s.size);
  useEffect(() => {
    fatMaterial.resolution.set(size.width, size.height);
  }, [size]);

  const colorsDirty = useRef(true);
  const forcePositions = useRef(true);
  const lastVersion = useRef(-1);
  /** positionBuffer.count at the last color pass — a worker tick that registers
   * new slots can un-hide edges, so a count change re-dirties colors. */
  const lastColorCount = useRef(-1);
  /** Shared inputs of the last full color pass, reused by the incremental
   * reveal pass (any ui/graph change that would invalidate them re-dirties). */
  const colorCtx = useRef<EdgeColorCtx | null>(null);
  /** Edge indices whose endpoints have slots but haven't begun materializing. */
  const waitingEdges = useRef<number[]>([]);
  /** Edge indices mid fade-in (reveal factor < 1). */
  const revealingEdges = useRef<number[]>([]);

  // Line picking tolerance (world units). Points threshold is irrelevant here.
  useEffect(() => {
    raycaster.params.Line.threshold = 1.2;
  }, [raycaster]);

  // Fresh attribute pair per edge-list / curve-resolution identity. Each edge
  // owns `segments` line segments = 2*segments vertices. positions fill per
  // frame; colors fill on edges/hover/selection/search/filter changes.
  const attrs = useMemo(() => {
    const floats = renderEdges.length * segments * 6;
    const positions = new THREE.BufferAttribute(new Float32Array(floats), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    const colors = new THREE.BufferAttribute(new Float32Array(floats), 3);
    colors.setUsage(THREE.DynamicDrawUsage);
    return { positions, colors };
  }, [renderEdges, segments]);

  // Fat path wraps the SAME arrays in instanced interleaved buffers
  // (setPositions/setColors keep a Float32Array by reference, no copy), so
  // the per-frame fill below feeds both paths; only the needsUpdate flags
  // differ. Rebuilt with attrs identity; disposed below.
  const fatGeom = useMemo(() => {
    if (!fat || renderEdges.length === 0) return null;
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
  }, [attrs, fat, renderEdges.length]);

  const fatLine = useMemo(() => {
    if (!fatGeom) return null;
    const obj = new LineSegments2(fatGeom, fatMaterial);
    obj.frustumCulled = false; // same reasoning as the hairline path
    return obj;
  }, [fatGeom]);

  useEffect(() => {
    if (!fatGeom) return;
    return () => fatGeom.dispose();
  }, [fatGeom]);

  // The default bounding sphere would be computed from the initial all-zero
  // positions and then never track the moving layout, which breaks raycast
  // culling — make it permissive instead (we already skip frustum culling).
  const geomRef = useRef<THREE.BufferGeometry>(null);
  useEffect(() => {
    const live = new Set(renderEdges.map((e) => edgeKey(e.source, e.target, e.kind)));
    for (const key of edgeAppearAt.keys()) {
      if (!live.has(key)) edgeAppearAt.delete(key);
    }
    forcePositions.current = true;
    colorsDirty.current = true;
    const geom = geomRef.current;
    if (geom) {
      // The <bufferGeometry> below persists while its attributes are swapped,
      // so the superseded pair's GPU buffers are only released if we say so —
      // and these are the largest buffers in the scene, rebuilt on every
      // setEdges during ingest. Same reasoning as ClusterCollapse.
      geom.dispose();
      geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    }
  }, [attrs]);

  useEffect(() => {
    const offUi = useUiStore.subscribe((s, prev) => {
      if (
        s.hoveredId !== prev.hoveredId ||
        s.selectedId !== prev.selectedId ||
        s.searchResults !== prev.searchResults ||
        s.highlightOwner !== prev.highlightOwner ||
        s.filter !== prev.filter ||
        s.clusterCollapsed !== prev.clusterCollapsed ||
        s.topicNodesEnabled !== prev.topicNodesEnabled
      ) {
        colorsDirty.current = true;
      }
      // 2D/3D toggle: tints change AND curves straighten/bow (positions)
      if (s.dims !== prev.dims) {
        colorsDirty.current = true;
        forcePositions.current = true;
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
    (e.kind === 'topic' && !ui.topicNodesEnabled) ||
    (e.kind !== 'topic' &&
      ui.filter.edgeKinds !== null &&
      ui.filter.edgeKinds.length > 0 &&
      !ui.filter.edgeKinds.includes(e.kind));

  /** Write one edge's vertex colors at the given reveal factor. */
  const fillEdgeColor = (
    i: number,
    e: (typeof edges)[number],
    revealFactor: number,
    ctx: EdgeColorCtx,
  ): void => {
    const col = attrs.colors.array as Float32Array;
    const vertsPerEdge = segments * 2;
    const base = i * vertsPerEdge * 3;
    const { emphasis, focusId, flat, fade, clusterOf, pathHops } = ctx;
    // base: kind tint scaled by weight (opacity/brightness = weight, §7.1)
    // and by density; kept delicate so links read as fine filaments. Each
    // end leans toward its node's cluster hue so filaments visibly belong
    // to the communities they join (gradient across the arc).
    if (flat) {
      // star chart: one uniform slate hairline tint, no cluster bleed
      srcColor.copy(FLAT_EDGE);
      dstColor.copy(FLAT_EDGE);
    } else {
      srcColor.copy(EDGE_TINTS[e.kind]);
      dstColor.copy(EDGE_TINTS[e.kind]);
      if (e.kind !== 'reference') {
        srcColor.lerp(clusterColor(clusterOf.get(e.source) ?? -1), CLUSTER_BLEND);
        dstColor.lerp(clusterColor(clusterOf.get(e.target) ?? -1), CLUSTER_BLEND);
      }
    }
    let brightness =
      (flat ? FLAT_BRIGHT_BASE + FLAT_BRIGHT_WEIGHT * e.weight : 0.16 + 0.55 * e.weight) *
      fade *
      revealFactor;
    if (emphasis && !(emphasis.has(e.source) && emphasis.has(e.target))) {
      brightness *= 0.05;
    }
    if (pathHops && isPathHop(e.source, e.target, pathHops)) {
      brightness *= FOCUS_BOOST / fade;
      srcColor.set('#77e5ff');
      dstColor.set('#b4a8ff');
    } else if (focusId && (e.source === focusId || e.target === focusId)) {
      // undo the density fade: the edges you're inspecting must stay vivid
      // precisely when the rest of the graph is at its faintest
      brightness *= FOCUS_BOOST / fade;
      if (flat) {
        srcColor.set(FLAT_EDGE_FOCUS);
        dstColor.set(FLAT_EDGE_FOCUS);
      }
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
      // 1 at ends, MID_TAPER at t=.5 — straight 2D hairlines stay uniform
      const taper = flat ? 1 : 1 - (1 - MID_TAPER) * 4 * t * (1 - t);
      const o = base + v * 3;
      col[o] = (srcColor.r + (dstColor.r - srcColor.r) * t) * taper;
      col[o + 1] = (srcColor.g + (dstColor.g - srcColor.g) * t) * taper;
      col[o + 2] = (srcColor.b + (dstColor.b - srcColor.b) * t) * taper;
    }
  };

  const recomputeColors = (): void => {
    const { nodes, edges: allEdges } = useGraphStore.getState();
    const ui = useUiStore.getState();
    const { hoveredId, selectedId, searchResults, highlightOwner, filter } = ui;
    const pathHops =
      highlightOwner === 'path' && searchResults && searchResults.length >= 2
        ? pathHopSet(searchResults)
        : null;
    // Full edge list, NOT renderEdges: emphasis is about node neighborhoods
    // (the result is keyed by node id), and passing the same array as
    // Nodes/EdgePulses/ClusterBridges shares one adjacency build per hover
    // instead of rebuilding it for the capped-array identity.
    const emphasis = computeEmphasis(
      nodes,
      allEdges,
      hoveredId,
      selectedId,
      searchResults,
      filter,
    );
    const flat = ui.dims === 2;
    const clusterOf = new Map<string, number>();
    for (const n of nodes) clusterOf.set(n.id, n.cluster);
    // Count visible edges for density fade (hidden edges shouldn't dim the rest)
    let visibleCount = 0;
    for (const e of renderEdges) if (!isEdgeHidden(e, ui)) visibleCount++;
    const ctx: EdgeColorCtx = {
      emphasis,
      focusId: hoveredId ?? selectedId ?? null,
      flat,
      fade: densityFade(visibleCount),
      clusterOf,
      pathHops,
    };
    colorCtx.current = ctx;
    waitingEdges.current.length = 0;
    revealingEdges.current.length = 0;
    const col = attrs.colors.array as Float32Array;
    const vertsPerEdge = segments * 2;
    const now = performance.now();
    const reducedMotion = prefersReducedMotion();
    const count = positionBuffer.count;
    for (let i = 0; i < renderEdges.length; i++) {
      const e = renderEdges[i];
      const base = i * vertsPerEdge * 3;
      // Hidden: weight below the hairball slider, collapse mode, or a topic
      // edge whose hub octahedron isn't rendered (toggle off).
      if (isEdgeHidden(e, ui)) {
        col.fill(0, base, base + vertsPerEdge * 3);
        continue;
      }
      const srcSlot = slotOfId.get(e.source);
      const dstSlot = slotOfId.get(e.target);
      const slotsExist =
        srcSlot !== undefined && dstSlot !== undefined && srcSlot < count && dstSlot < count;
      // "exists" means visually arrived: slot registered AND the materialize
      // pop begun — otherwise edges fade in converging on the invisible
      // pre-spawn clump at the drop origin.
      const bothArrived =
        slotsExist && slotHasMaterialized(srcSlot, now) && slotHasMaterialized(dstSlot, now);
      const key = edgeKey(e.source, e.target, e.kind);
      const reveal = edgeRevealFactor({
        bothEndpointsExist: bothArrived,
        appearAt: edgeAppearAt.get(key),
        now,
        reducedMotion,
      });
      if (reveal.appearAt !== undefined) edgeAppearAt.set(key, reveal.appearAt);
      else edgeAppearAt.delete(key);
      if (!bothArrived) {
        // Slots assigned but a spawn still pending: the incremental pass
        // promotes it. Slots missing entirely: the count-change re-dirty
        // in useFrame recomputes when the worker tick registers them.
        if (slotsExist) waitingEdges.current.push(i);
        col.fill(0, base, base + vertsPerEdge * 3);
        continue;
      }
      if (reveal.factor < 1) revealingEdges.current.push(i);
      fillEdgeColor(i, e, reveal.factor, ctx);
    }
    attrs.colors.needsUpdate = true;
    if (fatGeom) {
      (fatGeom.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data.needsUpdate =
        true;
    }
  };

  /**
   * Per-frame reveal advance: touches ONLY edges still fading in (or waiting
   * for a pre-spawn endpoint), so a long staggered ingest doesn't rerun the
   * full O(edges*segments) color pass at 60fps. Returns true when any vertex
   * colors changed.
   */
  const advanceEdgeReveals = (): boolean => {
    const ctx = colorCtx.current;
    if (!ctx) return false;
    const waiting = waitingEdges.current;
    const revealing = revealingEdges.current;
    if (waiting.length === 0 && revealing.length === 0) return false;
    const now = performance.now();
    const reducedMotion = prefersReducedMotion();
    // Promote waiting edges whose endpoints have now begun materializing
    // (compact in place — no per-frame array allocations).
    let w = 0;
    for (let k = 0; k < waiting.length; k++) {
      const i = waiting[k];
      const e = renderEdges[i];
      const s = slotOfId.get(e.source);
      const t = slotOfId.get(e.target);
      if (
        s !== undefined &&
        t !== undefined &&
        slotHasMaterialized(s, now) &&
        slotHasMaterialized(t, now)
      ) {
        revealing.push(i);
      } else {
        waiting[w++] = i;
      }
    }
    waiting.length = w;
    let touched = false;
    let r = 0;
    for (let k = 0; k < revealing.length; k++) {
      const i = revealing[k];
      const e = renderEdges[i];
      const key = edgeKey(e.source, e.target, e.kind);
      const reveal = edgeRevealFactor({
        bothEndpointsExist: true,
        appearAt: edgeAppearAt.get(key),
        now,
        reducedMotion,
      });
      edgeAppearAt.set(key, reveal.appearAt ?? now);
      fillEdgeColor(i, e, reveal.factor, ctx);
      touched = true;
      if (reveal.factor < 1) revealing[r++] = i;
    }
    revealing.length = r;
    return touched;
  };

  useFrame(() => {
    if (renderEdges.length === 0) return;
    const countNow = positionBuffer.count;
    // A worker tick that registers new slots can un-hide edges whose colors
    // were computed while an endpoint was still missing — without this,
    // those edges would stay at brightness 0 until an unrelated ui change.
    if (countNow !== lastColorCount.current) {
      lastColorCount.current = countNow;
      colorsDirty.current = true;
    }
    if (colorsDirty.current) {
      colorsDirty.current = false;
      recomputeColors();
    } else if (advanceEdgeReveals()) {
      attrs.colors.needsUpdate = true;
      if (fatGeom) {
        (
          fatGeom.attributes.instanceColorStart as THREE.InterleavedBufferAttribute
        ).data.needsUpdate = true;
      }
    }
    const version = positionBuffer.version;
    let liveTravel = false;
    for (let i = 0; i < countNow; i++) {
      if ((spawnAtOfSlot[i] ?? -1) >= 0) {
        liveTravel = true;
        break;
      }
    }
    if (version === lastVersion.current && !forcePositions.current && !liveTravel) return;
    lastVersion.current = version;
    forcePositions.current = false;

    const count = positionBuffer.count;
    const pos = attrs.positions.array as Float32Array;
    const floatsPerEdge = segments * 6;
    // 2D star chart: control point at the chord midpoint degenerates the
    // bezier to a straight line — same buffers, no bow.
    const flat = useUiStore.getState().dims === 2;
    const now = performance.now();
    const reducedMotion = prefersReducedMotion();
    const travelOpts = { reducedMotion, flat };
    for (let i = 0; i < renderEdges.length; i++) {
      const e = renderEdges[i];
      const s = slotOfId.get(e.source);
      const t = slotOfId.get(e.target);
      if (s === undefined || t === undefined || s >= count || t >= count) {
        continue; // endpoint not placed yet: keep previous (zeros collapse to a point)
      }
      writeSlotTravelPosition(edgeSrc, s, now, travelOpts);
      writeSlotTravelPosition(edgeDst, t, now, travelOpts);
      const ax = edgeSrc.x;
      const ay = edgeSrc.y;
      const az = edgeSrc.z;
      const bx = edgeDst.x;
      const by = edgeDst.y;
      const bz = edgeDst.z;
      if (flat) {
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
    if (fatGeom) {
      (fatGeom.attributes.instanceStart as THREE.InterleavedBufferAttribute).data.needsUpdate =
        true;
    }
  });

  if (renderEdges.length === 0) return null;

  if (fatLine) return <primitive object={fatLine} />;

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
