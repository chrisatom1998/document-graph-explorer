/**
 * Instanced document/topic nodes (spec §7.1).
 *
 * - Core spheres + additive halo shells share one matrix pass driven by
 *   positionBuffer; topic nodes render as octahedra on a third instanced
 *   mesh (mutually exclusive with the sphere at the same slot).
 * - Per-instance colors encode cluster hue, hover/search/filter emphasis
 *   (non-emphasized dims to 12%), ghosting for partial/unreadable docs, and
 *   hover/selection brightening.
 * - Picking uses an analytic ray-sphere raycast over positionBuffer instead
 *   of THREE's per-instance triangle raycast (4096 instances x 400 tris
 *   would jank every pointermove).
 * - Dragging projects the pointer onto the camera-facing plane through the
 *   node and pins it via layoutPin; drag fixes, double-click releases.
 *
 * This file also owns the per-slot visual metadata (scaleOfSlot from degree,
 * kind/ghost lookups) and exports the emphasis helpers shared by
 * Edges/EdgePulses/Labels so the dimming rules cannot diverge.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { MAX_NODES } from '../config';
import type { DocNode, Edge } from '../model/types';
import { layoutPin, layoutUnpin } from '../layout/layoutBridge';
import { buildAdjacency, useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import type { GraphFilter } from '../store/uiStore';
import {
  ghostOfSlot,
  idOfSlot,
  kindOfSlot,
  positionBuffer,
  scaleOfSlot,
  slotOfId,
  spawnAtOfSlot,
} from './positionBuffer';
import { clusterColor } from './palette';

// ---------------------------------------------------------------------------
// Shared slot metadata + emphasis helpers (imported by Edges/EdgePulses/Labels)
// ---------------------------------------------------------------------------

// kindOfSlot/ghostOfSlot now live in positionBuffer (so layoutBridge can clear
// freed slots without an import cycle); re-exported here for the components
// that import them from './Nodes'.
export { ghostOfSlot, kindOfSlot } from './positionBuffer';

let adjacencySource: Edge[] | null = null;
let adjacencyCache = new Map<string, Set<string>>();

/** buildAdjacency memoized on edges identity (edges array is immutable in the store). */
export function adjacencyFor(edges: Edge[]): Map<string, Set<string>> {
  if (adjacencySource !== edges) {
    adjacencySource = edges;
    adjacencyCache = buildAdjacency(edges);
  }
  return adjacencyCache;
}

/**
 * The emphasis set for the active dim trigger, or null when nothing dims.
 * Precedence: hover > search > filter (spec §7.3).
 *  - hover: node + adjacency neighbors
 *  - search: results + their neighbors
 *  - filter: matching nodes only
 */
export function computeEmphasis(
  nodes: DocNode[],
  edges: Edge[],
  hoveredId: string | null,
  searchResults: string[] | null,
  filter: GraphFilter,
): Set<string> | null {
  if (hoveredId) {
    const set = new Set<string>([hoveredId]);
    const neighbors = adjacencyFor(edges).get(hoveredId);
    if (neighbors) for (const id of neighbors) set.add(id);
    return set;
  }
  if (searchResults) {
    const set = new Set<string>();
    const adjacency = adjacencyFor(edges);
    for (const id of searchResults) {
      set.add(id);
      const neighbors = adjacency.get(id);
      if (neighbors) for (const n of neighbors) set.add(n);
    }
    return set;
  }
  const filterActive =
    filter.fileTypes !== null || filter.clusters !== null || filter.minDegree > 0;
  if (filterActive) {
    const set = new Set<string>();
    for (const n of nodes) {
      if (filter.fileTypes && !filter.fileTypes.includes(n.fileType)) continue;
      if (filter.clusters && !filter.clusters.includes(n.cluster)) continue;
      if (n.degree < filter.minDegree) continue;
      set.add(n.id);
    }
    return set;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Module-level temps (zero per-frame allocations)
// ---------------------------------------------------------------------------

const MATERIALIZE_MS = 700;
const HALO_SCALE = 1.9;
const HALO_OPACITY = 0.2;
// Additive halos stack like the edges do: in crowded graphs the overlapping
// shells (and the bloom they feed) wash out the core spheres, so halo opacity
// eases down with node count. Floor keeps sparse regions of a big graph lit.
const HALO_FADE_START = 500;
const HALO_FADE_FLOOR = 0.5;
const DIM_FACTOR = 0.12;
const GHOST_COLOR_FACTOR = 0.35;
const GHOST_SCALE_FACTOR = 0.8;
const PIN_THROTTLE_MS = 33;

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();
const rayToCenter = new THREE.Vector3();
const dragOrigin = new THREE.Vector3();
const dragNormal = new THREE.Vector3();
const dragPoint = new THREE.Vector3();
const dragPlane = new THREE.Plane();
const dragRaycaster = new THREE.Raycaster();
const dragNdc = new THREE.Vector2();

/** easeOutBack: small overshoot for the materialize pop. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
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
  const count = Math.min(positionBuffer.count, MAX_NODES);
  const arr = positionBuffer.array;
  const topicsOn = useUiStore.getState().topicNodesEnabled;
  const ray = raycaster.ray;
  for (let i = 0; i < count; i++) {
    if (!idOfSlot[i]) continue; // freed slot (removed node) -> unpickable
    if (kindOfSlot[i] === 1 && !topicsOn) continue; // invisible -> unpickable
    const radius = (scaleOfSlot[i] || 1.1) * 1.15; // slight grace margin
    const o = i * 3;
    rayToCenter.set(arr[o], arr[o + 1], arr[o + 2]).sub(ray.origin);
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
}

export default function Nodes() {
  const topicNodesEnabled = useUiStore((s) => s.topicNodesEnabled);
  const rootGet = useThree((s) => s.get);

  const coreRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);
  const topicRef = useRef<THREE.InstancedMesh>(null);

  const metaDirty = useRef(true); // scaleOfSlot / kind / ghost need refresh
  const colorsDirty = useRef(true); // instance colors need recompute
  const matricesDirty = useRef(true); // matrix pass forced (scale/count/mount changes)
  const animating = useRef(false); // a materialize tween was live last pass
  const lastVersion = useRef(-1);
  const lastCount = useRef(-1);
  const dragRef = useRef<DragState | null>(null);

  // ---- per-slot metadata from the graph store --------------------------------
  const refreshSlotMeta = (): void => {
    const { nodes } = useGraphStore.getState();
    for (const n of nodes) {
      const slot = slotOfId.get(n.id);
      if (slot === undefined || slot >= MAX_NODES) continue;
      kindOfSlot[slot] = n.kind === 'topic' ? 1 : 0;
      const ghost = n.status !== 'ok';
      ghostOfSlot[slot] = ghost ? 1 : 0;
      // size = f(degree), log-scaled so hubs are visibly hubs (spec §5.4)
      let s = 0.7 * (1 + 0.5 * Math.log2(1 + n.degree));
      if (ghost) s *= GHOST_SCALE_FACTOR; // ghosted, never a silent gap (spec §9)
      scaleOfSlot[slot] = Math.min(s, 2.6);
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
    const { hoveredId, selectedId, searchResults, filter } = useUiStore.getState();
    const emphasis = computeEmphasis(nodes, edges, hoveredId, searchResults, filter);
    for (const n of nodes) {
      const slot = slotOfId.get(n.id);
      if (slot === undefined || slot >= MAX_NODES) continue;
      tmpColor.copy(clusterColor(n.cluster));
      if (n.kind === 'topic') tmpColor.multiplyScalar(1.25); // topics slightly brighter
      if (ghostOfSlot[slot]) tmpColor.multiplyScalar(GHOST_COLOR_FACTOR);
      if (emphasis && !emphasis.has(n.id)) tmpColor.multiplyScalar(DIM_FACTOR);
      if (n.id === hoveredId || n.id === selectedId) tmpColor.multiplyScalar(1.7);
      tmpColor.r = Math.min(tmpColor.r, 1);
      tmpColor.g = Math.min(tmpColor.g, 1);
      tmpColor.b = Math.min(tmpColor.b, 1);
      core.setColorAt(slot, tmpColor);
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
  useEffect(() => {
    for (const mesh of [coreRef.current, haloRef.current, topicRef.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (!mesh.instanceColor) {
        const attr = new THREE.InstancedBufferAttribute(
          new Float32Array(MAX_NODES * 3).fill(1),
          3,
        );
        attr.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = attr;
      }
    }
    colorsDirty.current = true;
    matricesDirty.current = true; // topic mesh may have just (un)mounted
  }, [topicNodesEnabled]);

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
        s.filter !== prev.filter ||
        s.clusterCollapsed !== prev.clusterCollapsed
      ) {
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
      if (!dragRef.current) return;
      dragRef.current = null; // node STAYS pinned (drag fixes; dblclick releases)
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const controls = rootGet().controls as unknown as OrbitControlsImpl | null;
      if (controls) controls.enabled = true;
      document.body.style.cursor = '';
    };
    const start = (id: string): void => {
      const slot = slotOfId.get(id);
      if (slot === undefined) return;
      const arr = positionBuffer.array;
      dragOrigin.set(arr[slot * 3], arr[slot * 3 + 1], arr[slot * 3 + 2]);
      rootGet().camera.getWorldDirection(dragNormal);
      dragPlane.setFromNormalAndCoplanarPoint(dragNormal, dragOrigin);
      dragRef.current = { id, lastPin: 0 };
      const controls = rootGet().controls as unknown as OrbitControlsImpl | null;
      if (controls) controls.enabled = false; // orbit off while dragging
      document.body.style.cursor = 'grabbing';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
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
    // Path mode: clicks pick endpoints — starting a drag here would pin the
    // node on 1-4px of pointer jitter (drag fixes; only dblclick releases).
    if (useUiStore.getState().pathMode) return;
    e.stopPropagation();
    drag.start(id);
  };

  const handleClick = (e: ThreeEvent<MouseEvent>): void => {
    if (e.delta > 4) return; // pointer travelled: that was a drag, not a click
    const id = idOf(e);
    if (!id) return;
    e.stopPropagation();
    const ui = useUiStore.getState();
    if (ui.pathMode) {
      // Topic hubs can't be endpoints: pathfinding skips 'topic' edges, so a
      // topic pick would always dead-end in "no connection found".
      if (e.instanceId !== undefined && kindOfSlot[e.instanceId] === 1) return;
      ui.addPathEndpoint(id); // path mode: clicks pick endpoints, not selection
      return;
    }
    ui.setSelected(id);
    ui.sendCamera('frameNode', [id]);
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

    const count = Math.min(positionBuffer.count, MAX_NODES);
    if (count !== lastCount.current) {
      lastCount.current = count;
      metaDirty.current = true;
      colorsDirty.current = true;
      matricesDirty.current = true;
      const haloFade =
        count <= HALO_FADE_START
          ? 1
          : Math.max(HALO_FADE_FLOOR, Math.sqrt(HALO_FADE_START / count));
      (halo.material as THREE.MeshBasicMaterial).opacity = HALO_OPACITY * haloFade;
    }
    if (metaDirty.current) {
      refreshSlotMeta();
      metaDirty.current = false;
      matricesDirty.current = true; // scales may have changed
    }
    if (colorsDirty.current && recomputeColors()) {
      colorsDirty.current = false;
    }

    core.count = count;
    halo.count = count;
    if (topic) topic.count = count;

    // Dirty heuristic: skip the matrix loop when nothing moved or animates.
    const version = positionBuffer.version;
    if (version === lastVersion.current && !animating.current && !matricesDirty.current) {
      return;
    }
    lastVersion.current = version;
    matricesDirty.current = false;

    const arr = positionBuffer.array;
    const now = performance.now();
    let stillAnimating = false;
    const collapsed = useUiStore.getState().clusterCollapsed;

    for (let i = 0; i < count; i++) {
      const o = i * 3;
      dummy.position.set(arr[o], arr[o + 1], arr[o + 2]);

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
      let haloScale = scale * HALO_SCALE;

      // Cluster-collapse mode: hide individual nodes (spec §9 super-nodes)
      if (collapsed) {
        scale = 0;
        haloScale = 0;
      }

      // materialize: ease-out-back pop + a brief halo flare (spec §8)
      const spawn = spawnAtOfSlot[i] as number | undefined; // sparse array
      if (spawn !== undefined && spawn >= 0) {
        const t = (now - spawn) / MATERIALIZE_MS;
        if (t < 1) {
          const f = easeOutBack(Math.max(t, 0));
          scale *= f;
          haloScale = scale * HALO_SCALE * (1 + 1.5 * (1 - t));
          stillAnimating = true;
        } else {
          spawnAtOfSlot[i] = -1; // animation done
        }
      }

      const isTopic = kindOfSlot[i] === 1;

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

    animating.current = stillAnimating;
    core.instanceMatrix.needsUpdate = true;
    halo.instanceMatrix.needsUpdate = true;
    if (topic) topic.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {/* core spheres: the only pickable mesh (analytic raycast covers all slots) */}
      <instancedMesh
        ref={coreRef}
        args={[undefined, undefined, MAX_NODES]}
        frustumCulled={false}
        raycast={instancedSphereRaycast}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <sphereGeometry args={[1, 32, 24]} />
        {/* glossy marble: per-instance cluster hue as diffuse, lit by the
            scene key light for a specular hotspot. The additive halo below
            supplies the nebula glow that feeds bloom. */}
        <meshPhongMaterial specular="#6a6a82" shininess={58} />
      </instancedMesh>

      {/* soft additive halo shell that feeds the bloom pass */}
      <instancedMesh
        ref={haloRef}
        args={[undefined, undefined, MAX_NODES]}
        frustumCulled={false}
        raycast={NO_RAYCAST}
      >
        <sphereGeometry args={[1, 24, 18]} />
        <meshBasicMaterial
          transparent
          opacity={HALO_OPACITY}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>

      {/* topic nodes as octahedra (spec §5.4), behind the toggle */}
      {topicNodesEnabled && (
        <instancedMesh
          ref={topicRef}
          args={[undefined, undefined, MAX_NODES]}
          frustumCulled={false}
          raycast={NO_RAYCAST}
        >
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      )}
    </group>
  );
}
