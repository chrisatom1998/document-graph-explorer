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
 *   of THREE's per-instance triangle raycast (4096 instances x 400 tris
 *   would jank every pointermove).
 * - Dragging projects the pointer onto the camera-facing plane through the
 *   node and pins it via layoutPin; drag fixes, double-click releases.
 *
 * This file also owns the per-slot visual metadata (scaleOfSlot from degree,
 * kind/ghost lookups). The emphasis helpers shared by Edges/EdgePulses/Labels
 * live in ./emphasis so those components don't need to import this one.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { MAX_NODES } from '../config';
import { layoutPin, layoutUnpin } from '../layout/layoutBridge';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { computeEmphasis } from './emphasis';
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
import { prefersReducedMotion } from '../util/motion';

// ---------------------------------------------------------------------------
// Shared slot metadata (imported by Edges/EdgePulses/Labels)
// ---------------------------------------------------------------------------

// kindOfSlot/ghostOfSlot now live in positionBuffer (so layoutBridge can clear
// freed slots without an import cycle); re-exported here for the components
// that import them from './Nodes'.
export { ghostOfSlot, kindOfSlot } from './positionBuffer';

// ---------------------------------------------------------------------------
// Module-level temps (zero per-frame allocations)
// ---------------------------------------------------------------------------

const MATERIALIZE_MS = 700;
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
const DIM_FACTOR = 0.12;
const GHOST_COLOR_FACTOR = 0.35;
const GHOST_SCALE_FACTOR = 0.8;
const PIN_THROTTLE_MS = 33;
const SHOW_ME_PULSE_PERIOD_MS = 1050;
// Flat (2D ambient) styling constants — see the `flat` flag in Nodes().
const FLAT_SCALE_FACTOR = 0.55;
const FLAT_HALO_SCALE = 1.4;
const FLAT_HALO_INTENSITY_FACTOR = 0.5;

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
  // "Ambient" 2D style (spec §7.3 addendum): flat, matte dots instead of
  // glossy lit marbles, a tighter halo, and smaller sizing — the constellation
  // look. Re-renders on toggle (a rare, deliberate user action), which is
  // exactly when the material swap below needs to happen.
  const flat = useUiStore((s) => s.dims === 2);
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
  const haloFadeRef = useRef(1); // density-based halo fade, refreshed on count change
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
      // Flat mode reads as a constellation of small dots, not orbs — the
      // whole size range compresses so hub/leaf stay legible without ever
      // looking like the 3D marbles.
      scaleOfSlot[slot] = Math.min(s, 2.6) * (flat ? FLAT_SCALE_FACTOR : 1);
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
    const { hoveredId, selectedId, searchResults, highlightOwner, filter } = useUiStore.getState();
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
      if (slot === undefined || slot >= MAX_NODES) continue;
      tmpColor.copy(clusterColor(n.cluster));
      if (n.kind === 'topic') tmpColor.multiplyScalar(1.25); // topics slightly brighter
      if (ghostOfSlot[slot]) tmpColor.multiplyScalar(GHOST_COLOR_FACTOR);
      if (emphasis && !emphasis.has(n.id)) tmpColor.multiplyScalar(DIM_FACTOR);
      if (n.id === hoveredId || n.id === selectedId) tmpColor.multiplyScalar(1.9);
      if (showMeIds?.has(n.id)) tmpColor.setRGB(1, 0.96, 0.62);
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
        s.highlightOwner !== prev.highlightOwner ||
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

  // Flipping flat (2D) on/off changes per-slot sizing — rerun the meta pass.
  useEffect(() => {
    metaDirty.current = true;
    matricesDirty.current = true;
  }, [flat]);

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

    const count = Math.min(positionBuffer.count, MAX_NODES);
    if (count !== lastCount.current) {
      lastCount.current = count;
      metaDirty.current = true;
      colorsDirty.current = true;
      matricesDirty.current = true;
      haloFadeRef.current =
        count <= HALO_FADE_START
          ? 1
          : Math.max(HALO_FADE_FLOOR, Math.sqrt(HALO_FADE_START / count));
    }
    // Flat mode dims the corona further, independent of density fade, and
    // must re-apply every frame since it can change without `count` changing.
    haloMaterial.uniforms.uIntensity.value =
      HALO_INTENSITY * haloFadeRef.current * (flat ? FLAT_HALO_INTENSITY_FACTOR : 1);
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
    const ui = useUiStore.getState();
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
      let haloScale = scale * (flat ? FLAT_HALO_SCALE : HALO_SCALE);
      const showMePulse = showMeIds?.has(idOfSlot[i] ?? '') && !reducedMotion;
      if (showMePulse) {
        const wave = (Math.sin((now / SHOW_ME_PULSE_PERIOD_MS) * Math.PI * 2) + 1) * 0.5;
        const pulse = 1.16 + wave * 0.34;
        scale *= pulse;
        haloScale = scale * (flat ? FLAT_HALO_SCALE : HALO_SCALE) * (1.25 + wave * 1.1);
        stillAnimating = true;
      }

      // Cluster-collapse mode: hide individual nodes (spec §9 super-nodes)
      if (collapsed) {
        scale = 0;
        haloScale = 0;
      }

      // materialize: ease-out-back pop + a brief halo flare (spec §8) —
      // skipped under prefers-reduced-motion (nodes appear at full size)
      const spawn = spawnAtOfSlot[i] as number | undefined; // sparse array
      if (spawn !== undefined && spawn >= 0) {
        if (reducedMotion) {
          spawnAtOfSlot[i] = -1;
        } else {
          const t = (now - spawn) / MATERIALIZE_MS;
          if (t < 1) {
            const f = easeOutBack(Math.max(t, 0));
            scale *= f;
            haloScale = scale * (flat ? FLAT_HALO_SCALE : HALO_SCALE) * (1 + 1.5 * (1 - t));
            stillAnimating = true;
          } else {
            spawnAtOfSlot[i] = -1; // animation done
          }
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

    animating.current = stillAnimating || showMePulsing.current;
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
        {flat ? (
          // Flat/ambient 2D style: an unlit matte dot (no specular hotspot,
          // no env reflection) so it reads as a small constellation point
          // rather than a lit 3D marble.
          <meshBasicMaterial toneMapped={false} />
        ) : (
          // glassy marble: per-instance cluster hue as diffuse under a
          // clearcoat, reflecting the procedural Lightformer environment
          // (NebulaCanvas) so cores read as polished glass orbs rather than
          // plastic. The fresnel halo below supplies the nebula glow that
          // feeds bloom.
          <meshPhysicalMaterial
            roughness={0.32}
            metalness={0}
            clearcoat={0.9}
            clearcoatRoughness={0.25}
            envMapIntensity={0.7}
          />
        )}
      </instancedMesh>

      {/* fresnel corona halo (limb-brightened, additive) that feeds bloom */}
      <instancedMesh
        ref={haloRef}
        args={[undefined, undefined, MAX_NODES]}
        frustumCulled={false}
        raycast={NO_RAYCAST}
      >
        <sphereGeometry args={[1, 24, 18]} />
        <primitive object={haloMaterial} attach="material" />
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
