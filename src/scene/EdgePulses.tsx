/**
 * THE signature effect (spec §7.1): packets of light travelling OUTWARD
 * along the edges of the hovered or selected node — information visibly
 * flowing through the corpus. Everything else stays restrained so these land.
 *
 * - Instanced additive spheres; per edge two pulses half a phase apart.
 * - Speed scales with edge weight; pulses swell mid-flight.
 * - qualityTier >= 3 drops hover pulses and keeps selection-only.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { positionBuffer, slotOfId } from './positionBuffer';
import { EDGE_TINTS } from './palette';
import { edgeControlPoint, evalEdgePoint } from './edgeCurve';
import { prefersReducedMotion } from '../util/motion';

const PULSE_CAPACITY = 220;
const MAX_PULSE_EDGES = 70; // 2 pulses each -> 140 instances, headroom below capacity

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();
const ctrl = new Float32Array(3);
const pt = new Float32Array(3);

const NO_RAYCAST = (): void => {
  /* pulses are decoration, never pickable */
};

export default function EdgePulses() {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Active pulse set (rebuilt on focus/edges/tier changes, read per frame).
  const fromSlot = useRef(new Int32Array(MAX_PULSE_EDGES));
  const toSlot = useRef(new Int32Array(MAX_PULSE_EDGES));
  const speeds = useRef(new Float32Array(MAX_PULSE_EDGES));
  const activeEdges = useRef(0);
  const rebuildDirty = useRef(true);

  useEffect(() => {
    const mesh = meshRef.current;
    if (mesh && !mesh.instanceColor) {
      const attr = new THREE.InstancedBufferAttribute(
        new Float32Array(PULSE_CAPACITY * 3).fill(1),
        3,
      );
      attr.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = attr;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    const offUi = useUiStore.subscribe((s, prev) => {
      if (
        s.hoveredId !== prev.hoveredId ||
        s.selectedId !== prev.selectedId ||
        s.qualityTier !== prev.qualityTier ||
        s.filter !== prev.filter ||
        s.clusterCollapsed !== prev.clusterCollapsed ||
        s.topicNodesEnabled !== prev.topicNodesEnabled
      ) {
        rebuildDirty.current = true;
      }
    });
    const offGraph = useGraphStore.subscribe((s, prev) => {
      if (s.edges !== prev.edges) rebuildDirty.current = true;
    });
    return () => {
      offUi();
      offGraph();
    };
  }, []);

  const rebuild = (mesh: THREE.InstancedMesh): void => {
    const { edges } = useGraphStore.getState();
    const { hoveredId, selectedId, qualityTier, filter, clusterCollapsed, topicNodesEnabled } =
      useUiStore.getState();
    // No pulses in cluster-collapsed mode or under prefers-reduced-motion
    if (clusterCollapsed || prefersReducedMotion()) { activeEdges.current = 0; return; }
    // degraded tiers: pulses only for the explicit selection, not hover
    const focus = qualityTier >= 3 ? selectedId : (hoveredId ?? selectedId);
    const minW = filter.minEdgeWeight;
    let k = 0;
    if (focus) {
      for (let i = 0; i < edges.length && k < MAX_PULSE_EDGES; i++) {
        const e = edges[i];
        if (e.source !== focus && e.target !== focus) continue;
        if (e.weight < minW) continue; // respect edge-density slider
        // no pulses along edges the scene isn't drawing (hidden topic hubs)
        if (e.kind === 'topic' && !topicNodesEnabled) continue;
        const from = slotOfId.get(focus);
        const to = slotOfId.get(e.source === focus ? e.target : e.source);
        if (from === undefined || to === undefined) continue;
        fromSlot.current[k] = from; // OUTWARD from the focus node
        toSlot.current[k] = to;
        speeds.current[k] = 0.35 + 0.5 * e.weight;
        tmpColor.copy(EDGE_TINTS[e.kind]).multiplyScalar(1.8); // hot: feeds bloom
        if (mesh.instanceColor) {
          mesh.setColorAt(k * 2, tmpColor);
          mesh.setColorAt(k * 2 + 1, tmpColor);
        }
        k++;
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    activeEdges.current = k;
  };

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (rebuildDirty.current && mesh.instanceColor) {
      rebuild(mesh);
      rebuildDirty.current = false;
    }
    const n = activeEdges.current;
    mesh.count = n * 2; // count=0 hides the whole mesh
    if (n === 0) return;

    const time = state.clock.elapsedTime;
    const arr = positionBuffer.array;
    const count = positionBuffer.count;

    for (let j = 0; j < n; j++) {
      const sa = fromSlot.current[j];
      const sb = toSlot.current[j];
      const speed = speeds.current[j];
      const valid = sa < count && sb < count;
      const ao = sa * 3;
      const bo = sb * 3;
      // Pulses ride the same bezier the edge is drawn with (edgeCurve.ts is
      // symmetric in the endpoints, so travelling focus->neighbor against the
      // edge's stored direction still follows the visible arc).
      if (valid) {
        edgeControlPoint(
          arr[ao], arr[ao + 1], arr[ao + 2],
          arr[bo], arr[bo + 1], arr[bo + 2],
          ctrl, 0,
        );
      }
      for (let p = 0; p < 2; p++) {
        const idx = j * 2 + p;
        if (!valid) {
          dummy.scale.setScalar(0);
          dummy.position.set(0, 0, 0);
        } else {
          const t = (time * speed + p * 0.5) % 1;
          evalEdgePoint(
            arr[ao], arr[ao + 1], arr[ao + 2],
            ctrl[0], ctrl[1], ctrl[2],
            arr[bo], arr[bo + 1], arr[bo + 2],
            t, pt, 0,
          );
          dummy.position.set(pt[0], pt[1], pt[2]);
          // swell mid-flight
          dummy.scale.setScalar(0.5 + 0.5 * Math.sin(Math.PI * t));
        }
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, PULSE_CAPACITY]}
      frustumCulled={false}
      raycast={NO_RAYCAST}
    >
      <sphereGeometry args={[0.45, 8, 8]} />
      <meshBasicMaterial
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}
