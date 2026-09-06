/**
 * Instanced document/topic nodes (spec §7.1).
 *
 * - Core spheres + additive halo shells share one matrix pass driven by
 *   positionBuffer; topic nodes render as octahedra on a third instanced
 *   mesh (mutually exclusive with the sphere at the same slot).
 * - Per-instance colors encode cluster hue, hover/selection/search/filter emphasis
 *   (non-emphasized dims to 12%), ghosting for partial/unreadable docs, and
 *   hover/selection brightening.
 * - Picking uses an analytic ray-sphere raycast over positionBuffer instead
 *   of THREE's per-instance triangle raycast (thousands of instances x
 *   hundreds of tris would jank every pointermove).
 * - Dragging projects the pointer onto the camera-facing plane through the
 *   node and pins it via layoutPin; drag fixes, double-click releases.
 *
 * This file also owns the per-slot visual metadata (scaleOfSlot from degree,
 * kind/ghost lookups). The emphasis helpers shared by Edges/EdgePulses/Labels
 * live in ./emphasis so those components don't need to import this one.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { layoutPin, layoutUnpin } from '../layout/layoutBridge';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { applyComparePick } from '../ui/openCompare';
import { computeEmphasis } from './emphasis';
import { cameraPose } from './cameraPose';
import { viewDistanceFade } from './viewDistance';
import {
  idOfSlot,
  positionBuffer,
  scaleOfSlot,
  slotCapacity,
  slotMeta,
  slotOfId,
  spawnAtOfSlot,
  subscribeSlotCapacity,
} from './positionBuffer';
import {
  clusterColor,
  FLAT_NODE,
  FLAT_NODE_CLUSTER_BLEND,
  FLAT_NODE_OUTER,
  FLAT_NODE_RING,
} from './palette';
import { prefersReducedMotion } from '../util/motion';
import { startNodeDragLifecycle } from './nodeDragLifecycle';
import { VISUAL_DENSITY_SOFTEN_FULL, VISUAL_DENSITY_SOFTEN_START } from '../config';
import {
  easeOutBack,
  materializeDuration,
  slotHasMaterialized,
  writeSlotTravelPosition,
} from './ingestBirth';

// ---------------------------------------------------------------------------
// Shared slot metadata (imported by Edges/EdgePulses/Labels)
// ---------------------------------------------------------------------------

// slotMeta (kind/ghost) now lives in positionBuffer (so layoutBridge can clear
// freed slots without an import cycle); re-exported here for the components
// that import it from './Nodes'.
export { slotMeta } from './positionBuffer';

// ---------------------------------------------------------------------------
// Module-level temps (zero per-frame allocations)
// ---------------------------------------------------------------------------

const HALO_SCALE = 2.2;
const HALO_INTENSITY = 0.7;
// Additive halos stack like the edges do: in crowded graphs the overlapping
// shells (and the bloom they feed) wash out the core spheres, so halo
// intensity eases down with node count. Floor keeps sparse regions of a big
// graph lit.
const HALO_FADE_START = 500;
const HALO_FADE_FLOOR = 0.5;

/**
 * Fresnel corona halo: glow concentrates at the sphere's limb (view-grazing
 * normals) and stays faint face-on, so each node reads as a bright core inside
 * a luminous atmosphere instead of a flat additive ball — and overlapping
 * halos in crowded regions stack far less. three defines USE_INSTANCING /
 * USE_INSTANCING_COLOR (and declares those attributes) for ShaderMaterial on
 * an InstancedMesh, so the per-instance cluster hue flows straight through.
 * Additive output is encoded in RGB (alpha 1): SrcAlpha·One blending adds
 * exactly what the fragment computes. No tone mapping, matching the old
 * toneMapped={false} — authored brightness must reach the bloom pass.
 */
const haloMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uIntensity: { value: HALO_INTENSITY } },
  vertexShader: /* glsl */ `
    varying vec3 vColor;
    varying float vRim;
    void main() {
      vColor = vec3(1.0);
      #ifdef USE_INSTANCING_COLOR
        vColor = instanceColor;
      #endif
      vec4 mvPosition = vec4(position, 1.0);
      vec3 nrm = normal;
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        nrm = mat3(instanceMatrix) * nrm; // uniform per-instance scale only
      #endif
      mvPosition = modelViewMatrix * mvPosition;
      vec3 viewNormal = normalize(normalMatrix * nrm);
      float facing = abs(dot(viewNormal, normalize(-mvPosition.xyz)));
      vRim = pow(1.0 - facing, 2.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uIntensity;
    varying vec3 vColor;
    varying float vRim;
    void main() {
      // faint face-on fill + hot limb ring that feeds the bloom pass
      vec3 glow = vColor * uIntensity * (0.18 + 2.4 * vRim);
      gl_FragColor = vec4(glow, 1.0);
    }
  `,
});
const GHOST_COLOR_FACTOR = 0.35;
const GHOST_SCALE_FACTOR = 0.8;
// Above this many live nodes, spheres mount with coarser segment counts —
// vertex shading (frustumCulled=false, so every instance shades every frame)
// is the large-corpus cliff, not instance-attribute memory.
const COARSE_GEOMETRY_NODES = 5000;
const PIN_THROTTLE_MS = 33;
const SHOW_ME_PULSE_PERIOD_MS = 1050;

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();
const tmpOuterColor = new THREE.Color();
const tmpRingColor = new THREE.Color(FLAT_NODE_RING);
const rayToCenter = new THREE.Vector3();
const dragOrigin = new THREE.Vector3();
const dragNormal = new THREE.Vector3();
const dragPoint = new THREE.Vector3();
const dragPlane = new THREE.Plane();
const dragRaycaster = new THREE.Raycaster();
const dragNdc = new THREE.Vector2();
const travelPick = { x: 0, y: 0, z: 0 };

function densitySoftening(nodeCount: number): number {
  if (nodeCount <= VISUAL_DENSITY_SOFTEN_START) return 0;
  return Math.min(
    1,
    (nodeCount - VISUAL_DENSITY_SOFTEN_START) /
      (VISUAL_DENSITY_SOFTEN_FULL - VISUAL_DENSITY_SOFTEN_START),
  );
}

const NO_RAYCAST = (): void => {
  /* halo / topic meshes are not pickable; the core mesh picks all slots */
};

/**
 * Analytic ray-sphere picking over positionBuffer. Pushed intersections
 * carry instanceId so handlers can map slot -> node id. Covers topic slots
 * too (their sphere is zero-scaled but the pick radius comes from
 * scaleOfSlot), so hover/click works for octahedra as well.
 */
function instancedSphereRaycast(
  this: THREE.InstancedMesh,
  raycaster: THREE.Raycaster,
  intersects: THREE.Intersection[],
): void {
  // Also clamp to the mesh's own instance count: slotMeta.capacity is bumped
  // when the allocator grows, one render before the mesh remounts at the new
  // capacity, and an intersection carrying an instanceId past this.count
  // refers to an instance that is not being drawn yet.
  const count = Math.min(positionBuffer.count, slotMeta.capacity, this.count);
  const topicsOn = useUiStore.getState().topicNodesEnabled;
  const reducedMotion = prefersReducedMotion();
  const isFlat = useUiStore.getState().dims === 2;
  const now = performance.now();
  const ray = raycaster.ray;
  for (let i = 0; i < count; i++) {
    if (!idOfSlot[i]) continue; // freed slot (removed node) -> unpickable
    if (slotMeta.kind[i] === 1 && !topicsOn) continue; // invisible -> unpickable
    if (!slotHasMaterialized(i, now)) continue; // pre-spawn (scale 0) -> unpickable
    const radius = (scaleOfSlot[i] || 1.1) * 1.15; // slight grace margin
    writeSlotTravelPosition(travelPick, i, now, { reducedMotion, flat: isFlat });
    rayToCenter.set(travelPick.x, travelPick.y, travelPick.z).sub(ray.origin);
    const tca = rayToCenter.dot(ray.direction);
    if (tca < 0) continue;
    const d2 = rayToCenter.lengthSq() - tca * tca;
    const r2 = radius * radius;
    if (d2 > r2) continue;
    const thc = Math.sqrt(r2 - d2);
    const t = tca - thc >= 0 ? tca - thc : tca + thc;
    if (t < raycaster.near || t > raycaster.far) continue;
    intersects.push({
      distance: t,
      point: ray.direction.clone().multiplyScalar(t).add(ray.origin),
      object: this,
      instanceId: i,
    });
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DragState {
  id: string;
  lastPin: number;
  /** Pointer position at pointerdown, for the drag-vs-click distinction. */
  startX: number;
  startY: number;
  /** Set once travel passes DRAG_THRESHOLD_PX; only then may the node pin. */
  engaged: boolean;
}

/**
 * Pointer travel that separates a click from a drag. Ordinary clicks carry a
 * pixel or two of jitter, so pinning on the first pointermove froze nodes that
 * the user only meant to select — with no visual cue and only an undiscoverable
 * double-click to undo. Shared with handleClick so both read the same boundary.
 */
const DRAG_THRESHOLD_PX = 4;

export default function Nodes() {
  const topicNodesEnabled = useUiStore((s) => s.topicNodesEnabled);
  // 2D constellation mode: flat unlit dual discs instead of glossy marbles
  // (the material swap below) and smaller near-uniform sizing.
  const flat = useUiStore((s) => s.dims === 2);
  // Slot capacity grows on demand (layoutAddNodes); InstancedMesh capacity is
  // fixed at construction, so a growth step remounts the meshes via key/args.
  const capacity = useSyncExternalStore(subscribeSlotCapacity, slotCapacity);
  const coarseGeometry = useGraphStore((s) => s.nodes.length > COARSE_GEOMETRY_NODES);
  const rootGet = useThree((s) => s.get);

  const coreRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);
  const topicRef = useRef<THREE.InstancedMesh>(null);

  const metaDirty = useRef(true); // scaleOfSlot / kind / ghost need refresh
  const colorsDirty = useRef(true); // instance colors need recompute
  const matricesDirty = useRef(true); // matrix pass forced (scale/count/mount changes)
  const animating = useRef(false); // a materialize tween was live last pass
  const showMePulsing = useRef(false);
  const lastVersion = useRef(-1);
  const lastCount = useRef(-1);
  const lastCam = useRef({ x: 0, y: 0, z: 160 });
  const dragRef = useRef<DragState | null>(null);
  const engageDragRef = useRef<(() => void) | null>(null);
  const finishDragRef = useRef<(() => void) | null>(null);

  // ---- per-slot metadata from the graph store --------------------------------
  const refreshSlotMeta = (): void => {
    const { nodes } = useGraphStore.getState();
    const isFlat = useUiStore.getState().dims === 2;
    for (const n of nodes) {
      const slot = slotOfId.get(n.id);
      if (slot === undefined || slot >= slotMeta.capacity) continue;
      slotMeta.kind[slot] = n.kind === 'topic' ? 1 : 0;
      const ghost = n.status !== 'ok';
      slotMeta.ghost[slot] = ghost ? 1 : 0;
      // size = f(degree), log-scaled so hubs are visibly hubs (spec §5.4).
      // 2D star chart compresses the band — small, near-uniform dots.
      let s = isFlat
        ? 0.72 * (1 + 0.28 * Math.log2(1 + n.degree))
        : 0.7 * (1 + 0.5 * Math.log2(1 + n.degree));
      if (ghost) s *= GHOST_SCALE_FACTOR; // ghosted, never a silent gap (spec §9)
      scaleOfSlot[slot] = Math.min(s, isFlat ? 1.75 : 2.6);
    }
  };

  // ---- instance colors --------------------------------------------------------
  /** @returns false while instance color attributes aren't mounted yet. */
  const recomputeColors = (): boolean => {
    const core = coreRef.current;
    const halo = haloRef.current;
    if (!core?.instanceColor || !halo?.instanceColor) return false;
    const topic = topicRef.current;
    const { nodes, edges } = useGraphStore.getState();
    const { hoveredId, selectedId, searchResults, highlightOwner, filter, dims, snapshotOverlay } =
      useUiStore.getState();
    const isFlat = dims === 2;
    const soften = densitySoftening(nodes.length);
    const showMeIds = highlightOwner === 'showMe' && searchResults ? new Set(searchResults) : null;
    const emphasis = computeEmphasis(
      nodes,
      edges,
      hoveredId,
      selectedId,
      searchResults,
      filter,
    );
    for (const n of nodes) {
      const slot = slotOfId.get(n.id);
      if (slot === undefined || slot >= slotMeta.capacity) continue;
      if (isFlat) {
        // star chart: bright technical-map core plus a darker outer disc for
        // hierarchy; cluster hue only nudges the color so the map stays clean.
        tmpColor.copy(FLAT_NODE).lerp(clusterColor(n.cluster), FLAT_NODE_CLUSTER_BLEND);
        tmpOuterColor
          .copy(FLAT_NODE_OUTER)
          .lerp(clusterColor(n.cluster), FLAT_NODE_CLUSTER_BLEND * 0.65);
      } else {
        tmpColor.copy(clusterColor(n.cluster));
        tmpOuterColor.copy(tmpColor);
      }
      if (n.kind === 'topic') {
        tmpColor.multiplyScalar(1.28);
        tmpOuterColor.multiplyScalar(1.16);
      }
      if (slotMeta.ghost[slot]) {
        tmpColor.multiplyScalar(GHOST_COLOR_FACTOR);
        tmpOuterColor.multiplyScalar(GHOST_COLOR_FACTOR);
      }
      if (emphasis && !emphasis.has(n.id)) {
        tmpColor.multiplyScalar(isFlat ? 0.12 : 0.05);
        tmpOuterColor.multiplyScalar(isFlat ? 0.16 : 0.09);
      }
      // Core and outer disc must move together, so each state is ONE branch
      // that sets both. (Interleaving separate `else if` chains for the two
      // colors silently made the outer-disc branches unreachable.)
      if (n.id === hoveredId) {
        tmpColor.multiplyScalar(isFlat ? 2.15 - soften * 0.12 : 2.65 - soften * 0.18);
        tmpOuterColor.multiplyScalar(isFlat ? 2.1 - soften * 0.08 : 1.8 - soften * 0.12);
      } else if (n.id === selectedId) {
        tmpColor.multiplyScalar(isFlat ? 2.0 - soften * 0.1 : 2.45 - soften * 0.16);
        tmpOuterColor.multiplyScalar(isFlat ? 1.92 - soften * 0.08 : 1.7 - soften * 0.1);
      } else if (emphasis && emphasis.has(n.id)) {
        tmpColor.multiplyScalar(isFlat ? 1.4 : 1.22);
        tmpOuterColor.multiplyScalar(isFlat ? 1.34 : 1.16);
      }
      if (isFlat && n.kind !== 'topic') {
        tmpColor.lerp(tmpRingColor, 0.1);
      }
      if (showMeIds?.has(n.id)) {
        tmpColor.setRGB(1, 0.96, 0.62);
        tmpOuterColor.setRGB(0.9, 0.82, 0.42);
      }
      if (highlightOwner === 'snapshot' && snapshotOverlay) {
        if (snapshotOverlay.addedIds.includes(n.id)) {
          tmpColor.setRGB(0.35, 0.95, 0.55);
          tmpOuterColor.setRGB(0.18, 0.62, 0.34);
        } else if (snapshotOverlay.updatedIds.includes(n.id)) {
          tmpColor.setRGB(1, 0.78, 0.28);
          tmpOuterColor.setRGB(0.65, 0.38, 0.1);
        }
      }
      const keepBright =
        n.id === hoveredId ||
        n.id === selectedId ||
        showMeIds?.has(n.id) ||
        Boolean(emphasis?.has(n.id));
      if (!isFlat && !keepBright) {
        const o = slot * 3;
        const arr = positionBuffer.array;
        const dist = Math.hypot(
          arr[o] - cameraPose.px,
          arr[o + 1] - cameraPose.py,
          arr[o + 2] - cameraPose.pz,
        );
        const fade = viewDistanceFade(dist);
        tmpColor.multiplyScalar(fade);
        tmpOuterColor.multiplyScalar(Math.min(1, fade + 0.08));
      }
      tmpColor.r = Math.min(tmpColor.r, 1);
      tmpColor.g = Math.min(tmpColor.g, 1);
      tmpColor.b = Math.min(tmpColor.b, 1);
      tmpOuterColor.r = Math.min(tmpOuterColor.r, 1);
      tmpOuterColor.g = Math.min(tmpOuterColor.g, 1);
      tmpOuterColor.b = Math.min(tmpOuterColor.b, 1);
      core.setColorAt(slot, isFlat ? tmpOuterColor : tmpColor);
      halo.setColorAt(slot, tmpColor);
      if (topic?.instanceColor) topic.setColorAt(slot, tmpColor);
    }
    core.instanceColor.needsUpdate = true;
    halo.instanceColor.needsUpdate = true;
    if (topic?.instanceColor) topic.instanceColor.needsUpdate = true;
    return true;
  };

  // Pre-create instance color attributes at full capacity. setColorAt would
  // otherwise size the buffer from the CURRENT count and break when it grows.
  // Layout effect (not useEffect): a capacity growth remounts all three
  // meshes with zeroed matrices and no colors, so the attributes and dirty
  // flags must exist before the next R3F frame or that frame draws the graph
  // uncolored/blank.
  useLayoutEffect(() => {
    const meshes = [coreRef.current, haloRef.current, topicRef.current].filter(
      (m): m is THREE.InstancedMesh => m !== null,
    );
    for (const mesh of meshes) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (!mesh.instanceColor) {
        const attr = new THREE.InstancedBufferAttribute(
          new Float32Array(capacity * 3).fill(1),
          3,
        );
        attr.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = attr;
      }
    }
    metaDirty.current = true; // freshly remounted meshes repaint from scratch
    colorsDirty.current = true;
    matricesDirty.current = true; // topic mesh may have just (un)mounted

    // Only the topic mesh remounts with the topic-toggle dependency. Disposing
    // core/halo here would tear down live GPU color buffers that stay mounted
    // across the toggle; on a capacity remount R3F disposes the old meshes
    // (and their instance attributes) itself.
    const topic = topicRef.current;
    return () => {
      if (topic?.instanceColor) {
        topic.instanceColor.dispose();
        topic.instanceColor = null;
      }
    };
  }, [topicNodesEnabled, capacity]);

  // Core/halo stay mounted across the topic toggle; release them only on unmount.
  useEffect(
    () => () => {
      for (const mesh of [coreRef.current, haloRef.current]) {
        if (mesh?.instanceColor) {
          mesh.instanceColor.dispose();
          mesh.instanceColor = null;
        }
      }
    },
    [],
  );

  // Store subscriptions -> dirty flags (no hooks-per-frame, no re-renders).
  useEffect(() => {
    const offGraph = useGraphStore.subscribe((s, prev) => {
      if (s.nodes !== prev.nodes || s.edges !== prev.edges) {
        metaDirty.current = true;
        colorsDirty.current = true;
      }
    });
    const offUi = useUiStore.subscribe((s, prev) => {
      if (
        s.hoveredId !== prev.hoveredId ||
        s.selectedId !== prev.selectedId ||
        s.searchResults !== prev.searchResults ||
        s.highlightOwner !== prev.highlightOwner ||
        s.filter !== prev.filter ||
        s.snapshotOverlay !== prev.snapshotOverlay ||
        s.clusterCollapsed !== prev.clusterCollapsed
      ) {
        colorsDirty.current = true;
        matricesDirty.current = true;
      }
      // 2D/3D toggle reshapes sizes AND recolors (flat cyan vs cluster hues)
      if (s.dims !== prev.dims) {
        metaDirty.current = true;
        colorsDirty.current = true;
        matricesDirty.current = true;
      }
    });
    metaDirty.current = true;
    colorsDirty.current = true;
    return () => {
      offGraph();
      offUi();
    };
  }, []);

  // ---- drag-to-pin ------------------------------------------------------------
  const drag = useMemo(() => {
    const onMove = (ev: PointerEvent): void => {
      const state = dragRef.current;
      if (!state) return;
      if (!state.engaged) {
        const travel = Math.hypot(ev.clientX - state.startX, ev.clientY - state.startY);
        if (travel <= DRAG_THRESHOLD_PX) return; // still a click, not a drag
        state.engaged = true;
        engageDragRef.current?.();
        document.body.style.cursor = 'grabbing';
      }
      const now = performance.now();
      if (now - state.lastPin < PIN_THROTTLE_MS) return; // ~30 pins/s
      state.lastPin = now;
      const { camera, gl } = rootGet();
      const rect = gl.domElement.getBoundingClientRect();
      dragNdc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      dragRaycaster.setFromCamera(dragNdc, camera);
      if (dragRaycaster.ray.intersectPlane(dragPlane, dragPoint)) {
        layoutPin(state.id, dragPoint.x, dragPoint.y, dragPoint.z);
      }
    };
    const onUp = (): void => {
      finishDragRef.current?.();
    };
    const start = (id: string, startX: number, startY: number): void => {
      const slot = slotOfId.get(id);
      if (slot === undefined) return;
      // Defensive reset in case a second pointer begins before the browser
      // delivered the first pointer's end signal.
      finishDragRef.current?.();
      const arr = positionBuffer.array;
      dragOrigin.set(arr[slot * 3], arr[slot * 3 + 1], arr[slot * 3 + 2]);
      rootGet().camera.getWorldDirection(dragNormal);
      dragPlane.setFromNormalAndCoplanarPoint(dragNormal, dragOrigin);
      dragRef.current = { id, lastPin: 0, startX, startY, engaged: false };
      const controls = rootGet().controls as unknown as OrbitControlsImpl | null;
      // A plain selection must never disable camera input. The shared lifecycle
      // begins listening now, but OrbitControls are locked only if pointer
      // movement crosses the drag threshold in onMove above.
      let engage = (): void => {};
      let finish = (): void => {};
      const lifecycle = startNodeDragLifecycle({
        target: window,
        controls,
        onMove,
        onFinish: () => {
          dragRef.current = null; // node STAYS pinned (drag fixes; dblclick releases)
          document.body.style.cursor = '';
          if (engageDragRef.current === engage) engageDragRef.current = null;
          if (finishDragRef.current === finish) finishDragRef.current = null;
        },
      });
      engage = lifecycle.engage;
      finish = lifecycle.finish;
      engageDragRef.current = engage;
      finishDragRef.current = finish;
    };
    return { start, onMove, onUp };
  }, [rootGet]);

  // Safety: never leave OrbitControls disabled / listeners attached on unmount.
  useEffect(() => () => drag.onUp(), [drag]);

  // ---- pointer handlers ---------------------------------------------------------
  const idOf = (e: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>): string | null =>
    e.instanceId !== undefined ? (idOfSlot[e.instanceId] ?? null) : null;

  const handlePointerMove = (e: ThreeEvent<PointerEvent>): void => {
    if (dragRef.current) return;
    const id = idOf(e);
    if (!id) return;
    e.stopPropagation();
    const ui = useUiStore.getState();
    if (ui.hoveredId !== id) ui.setHovered(id);
    document.body.style.cursor = 'pointer';
  };

  const handlePointerOut = (): void => {
    if (dragRef.current) return;
    useUiStore.getState().setHovered(null);
    document.body.style.cursor = '';
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>): void => {
    if (e.nativeEvent.button !== 0) return;
    const id = idOf(e);
    if (!id) return;
    // Path mode: clicks pick endpoints, so dragging a node has no meaning here.
    if (useUiStore.getState().pathMode || useUiStore.getState().comparePick) return;
    e.stopPropagation();
    drag.start(id, e.nativeEvent.clientX, e.nativeEvent.clientY);
  };

  const handleClick = (e: ThreeEvent<MouseEvent>): void => {
    if (e.delta > DRAG_THRESHOLD_PX) return; // pointer travelled: a drag, not a click
    const id = idOf(e);
    if (!id) return;
    e.stopPropagation();
    // Selection opens UI and ends the pointer gesture. Explicitly finish here
    // as a final invariant even if an embedded browser failed to deliver the
    // normal pointerup to window.
    drag.onUp();
    const ui = useUiStore.getState();
    if (ui.comparePick) {
      // Topic hubs have no reader — compare is document-to-document only.
      if (e.instanceId !== undefined && slotMeta.kind[e.instanceId] === 1) return;
      applyComparePick(id);
      return;
    }
    if (ui.pathMode) {
      // Topic hubs can't be endpoints: pathfinding skips 'topic' edges, so a
      // topic pick would always dead-end in "no connection found".
      if (e.instanceId !== undefined && slotMeta.kind[e.instanceId] === 1) return;
      ui.addPathEndpoint(id); // path mode: clicks pick endpoints, not selection
      return;
    }
    // Select only — opens the side panel without moving the camera or
    // surfacing any other popover.
    ui.setSelected(id);
  };

  const handleDoubleClick = (e: ThreeEvent<MouseEvent>): void => {
    const id = idOf(e);
    if (!id) return;
    e.stopPropagation();
    layoutUnpin(id); // double-click releases a pinned node (spec §7.2)
  };

  // ---- per-frame matrix pass ------------------------------------------------
  useFrame(() => {
    const core = coreRef.current;
    const halo = haloRef.current;
    if (!core || !halo) return;
    const topic = topicRef.current;

    // Clamp to the capacity of the meshes mounted THIS render — during the
    // brief window between a growth step and the key-driven remount, the
    // buffer count can already exceed the old meshes' instance capacity.
    const count = Math.min(positionBuffer.count, capacity);
    if (count !== lastCount.current) {
      lastCount.current = count;
      metaDirty.current = true;
      colorsDirty.current = true;
      matricesDirty.current = true;
      const haloFade =
        count <= HALO_FADE_START
          ? 1
          : Math.max(HALO_FADE_FLOOR, Math.sqrt(HALO_FADE_START / count));
      haloMaterial.uniforms.uIntensity.value = HALO_INTENSITY * haloFade;
    }
    if (metaDirty.current) {
      refreshSlotMeta();
      metaDirty.current = false;
      matricesDirty.current = true; // scales may have changed
    }
    const camDx = cameraPose.px - lastCam.current.x;
    const camDy = cameraPose.py - lastCam.current.y;
    const camDz = cameraPose.pz - lastCam.current.z;
    if (camDx * camDx + camDy * camDy + camDz * camDz > 144) {
      lastCam.current = { x: cameraPose.px, y: cameraPose.py, z: cameraPose.pz };
      colorsDirty.current = true;
    }
    if (colorsDirty.current && recomputeColors()) {
      colorsDirty.current = false;
    }

    core.count = count;
    // In 2D the "halo" mesh is repurposed into the bright inner map core, so
    // it must stay enabled. Only the 3D path uses the large additive shell.
    halo.count = count;
    if (topic) topic.count = count;

    // Dirty heuristic: skip the matrix loop when nothing moved or animates.
    const version = positionBuffer.version;
    if (version === lastVersion.current && !animating.current && !matricesDirty.current) {
      return;
    }
    lastVersion.current = version;
    matricesDirty.current = false;

    const now = performance.now();
    let stillAnimating = false;
    const ui = useUiStore.getState();
    const isFlat = ui.dims === 2;
    const collapsed = ui.clusterCollapsed;
    // Once the user has picked a node out of the Show-me set (selectedId
    // set), settle down — the pulse is a "look here" cue for an undecided
    // choice, not something that should keep animating once one is picked.
    const showMeIds =
      ui.highlightOwner === 'showMe' && ui.searchResults && !ui.selectedId
        ? new Set(ui.searchResults)
        : null;
    const reducedMotion = prefersReducedMotion();
    showMePulsing.current = !!showMeIds && !collapsed && !reducedMotion;

    for (let i = 0; i < count; i++) {
      if (
        writeSlotTravelPosition(dummy.position, i, now, { reducedMotion, flat: isFlat })
      ) {
        stillAnimating = true;
      }

      // Freed slot (node removed, slot awaiting reuse): render nothing. The
      // `|| 1.1` default below would otherwise resurrect it as a ghost sphere.
      if (!idOfSlot[i]) {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        core.setMatrixAt(i, dummy.matrix);
        halo.setMatrixAt(i, dummy.matrix);
        if (topic) topic.setMatrixAt(i, dummy.matrix);
        continue;
      }

      let scale = scaleOfSlot[i] || 1.1;
      // 2D reuses this mesh as the inner disc (0.58 geometry), so skip HALO_SCALE.
      let haloScale = isFlat ? scale : scale * HALO_SCALE;
      const showMePulse = showMeIds?.has(idOfSlot[i] ?? '') && !reducedMotion;
      if (showMePulse) {
        const wave = (Math.sin((now / SHOW_ME_PULSE_PERIOD_MS) * Math.PI * 2) + 1) * 0.5;
        const pulse = 1.16 + wave * 0.34;
        scale *= pulse;
        haloScale = isFlat ? scale : scale * HALO_SCALE * (1.25 + wave * 1.1);
        stillAnimating = true;
      }

      // Cluster-collapse mode: hide individual nodes (spec §9 super-nodes)
      if (collapsed) {
        scale = 0;
        haloScale = 0;
      }

      // materialize: ease-out-back pop + a brief halo flare (spec §8) —
      // skipped under prefers-reduced-motion (nodes appear at full size).
      // 2D uses a shorter disc-pop; travel lives in writeSlotTravelPosition.
      const spawn = spawnAtOfSlot[i] as number | undefined; // sparse array
      if (spawn !== undefined && spawn >= 0) {
        if (reducedMotion) {
          spawnAtOfSlot[i] = -1;
        } else {
          const t = (now - spawn) / materializeDuration(isFlat);
          if (t < 1) {
            const f = easeOutBack(Math.max(t, 0));
            scale *= f;
            haloScale = isFlat ? scale : scale * HALO_SCALE * (1 + 1.5 * (1 - Math.max(t, 0)));
            stillAnimating = true;
          } else {
            spawnAtOfSlot[i] = -1; // animation done
          }
        }
      }

      const isTopic = slotMeta.kind[i] === 1;

      dummy.scale.setScalar(isTopic ? 0 : scale);
      dummy.updateMatrix();
      core.setMatrixAt(i, dummy.matrix);

      dummy.scale.setScalar(isTopic ? 0 : haloScale);
      dummy.updateMatrix();
      halo.setMatrixAt(i, dummy.matrix);

      if (topic) {
        dummy.scale.setScalar(isTopic ? scale : 0);
        dummy.updateMatrix();
        topic.setMatrixAt(i, dummy.matrix);
      }
    }

    animating.current = stillAnimating || showMePulsing.current;
    core.instanceMatrix.needsUpdate = true;
    halo.instanceMatrix.needsUpdate = true;
    if (topic) topic.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {/* core spheres: the only pickable mesh (analytic raycast covers all slots).
          key remounts each mesh when slot capacity grows (rare: 1.5x steps). */}
      <instancedMesh
        key={`core-${capacity}`}
        ref={coreRef}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
        raycast={instancedSphereRaycast}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <sphereGeometry args={coarseGeometry ? [1, 16, 12] : [1, 32, 24]} />
        {/* 3D: glassy marble — per-instance cluster hue as diffuse under a
            clearcoat, reflecting the procedural Lightformer environment
            (NebulaCanvas) so cores read as polished glass orbs rather than
            plastic. The fresnel halo below supplies the nebula glow that
            feeds bloom.
            2D: outer map disc — the inner highlight is the halo mesh below. */}
        {flat ? (
          <meshBasicMaterial toneMapped={false} depthWrite={false} />
        ) : (
          <meshPhysicalMaterial
            roughness={0.32}
            metalness={0}
            clearcoat={0.9}
            clearcoatRoughness={0.25}
            envMapIntensity={0.7}
          />
        )}
      </instancedMesh>

      {/* fresnel corona halo (limb-brightened, additive) that feeds bloom.
          In 2D this becomes the smaller bright map core above the darker disc. */}
      <instancedMesh
        key={`halo-${capacity}`}
        ref={haloRef}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
        raycast={NO_RAYCAST}
        renderOrder={flat ? 1 : 0}
      >
        <sphereGeometry args={flat ? [0.58, 18, 14] : coarseGeometry ? [1, 16, 12] : [1, 24, 18]} />
        {flat ? (
          <meshBasicMaterial toneMapped={false} depthTest={false} depthWrite={false} />
        ) : (
          <primitive object={haloMaterial} attach="material" />
        )}
      </instancedMesh>

      {/* topic nodes as octahedra (spec §5.4), behind the toggle */}
      {topicNodesEnabled && (
        <instancedMesh
          key={`topic-${capacity}`}
          ref={topicRef}
          args={[undefined, undefined, capacity]}
          frustumCulled={false}
          raycast={NO_RAYCAST}
        >
          <octahedronGeometry args={[1, 0]} />
          {flat ? (
            <meshBasicMaterial toneMapped={false} />
          ) : (
            <meshPhysicalMaterial
              roughness={0.14}
              metalness={0.28}
              clearcoat={1}
              clearcoatRoughness={0.18}
              emissive="#2ad4b8"
              emissiveIntensity={0.32}
              envMapIntensity={0.85}
            />
          )}
        </instancedMesh>
      )}
    </group>
  );
}
