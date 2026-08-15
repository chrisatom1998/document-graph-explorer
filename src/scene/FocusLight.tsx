/**
 * Local illumination that makes the active node affect the scene around it.
 *
 * Transient-subscription pattern (see Nodes.tsx): focus id and the id ->
 * cluster map live in refs fed by store subscriptions — the map rebuilds only
 * when the nodes array identity changes — and all positioning/intensity work
 * happens in useFrame, so a pointermove never re-renders this component.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { clusterColor } from './palette';
import { positionBuffer, slotOfId } from './positionBuffer';
import { VISUAL_DENSITY_SOFTEN_FULL, VISUAL_DENSITY_SOFTEN_START } from '../config';

const targetPosition = new THREE.Vector3();
const white = new THREE.Color('white');

function densitySoftening(nodeCount: number): number {
  return Math.min(
    1,
    Math.max(0, (nodeCount - VISUAL_DENSITY_SOFTEN_START) /
      (VISUAL_DENSITY_SOFTEN_FULL - VISUAL_DENSITY_SOFTEN_START)),
  );
}

export default function FocusLight() {
  const lightRef = useRef<THREE.PointLight>(null);
  const clusterById = useRef(new Map<string, number>());
  const hoveredIdRef = useRef<string | null>(null);
  const focusIdRef = useRef<string | null>(null);
  const softeningRef = useRef(0);

  useEffect(() => {
    const applyColor = (): void => {
      const light = lightRef.current;
      const focusId = focusIdRef.current;
      if (!light || !focusId) return;
      light.color
        .copy(clusterColor(clusterById.current.get(focusId) ?? -1))
        .lerp(white, 0.2);
    };
    const rebuildClusterMap = (nodes: DocNode[]): void => {
      clusterById.current = new Map(nodes.map((node) => [node.id, node.cluster]));
      softeningRef.current = densitySoftening(nodes.length);
      applyColor(); // the focused node's cluster may have changed
    };
    const syncFocus = (hoveredId: string | null, selectedId: string | null): void => {
      hoveredIdRef.current = hoveredId;
      focusIdRef.current = hoveredId ?? selectedId;
      applyColor();
    };

    rebuildClusterMap(useGraphStore.getState().nodes);
    const uiState = useUiStore.getState();
    syncFocus(uiState.hoveredId, uiState.selectedId);

    const offGraph = useGraphStore.subscribe((s, prev) => {
      if (s.nodes !== prev.nodes) rebuildClusterMap(s.nodes);
    });
    const offUi = useUiStore.subscribe((s, prev) => {
      if (s.hoveredId !== prev.hoveredId || s.selectedId !== prev.selectedId) {
        syncFocus(s.hoveredId, s.selectedId);
      }
    });
    return () => {
      offGraph();
      offUi();
    };
  }, []);

  useFrame((_, delta) => {
    const light = lightRef.current;
    if (!light) return;
    const flat = useUiStore.getState().dims === 2;
    const focusId = focusIdRef.current;
    const slot = focusId ? slotOfId.get(focusId) : undefined;
    const arr = positionBuffer.array;
    // Guard the read range too: the array can be detached/swapped mid-frame
    // during worker respawn (see ingestBirth.ts writeSlotTravelPosition).
    const hasTarget =
      !flat &&
      slot !== undefined &&
      slot < positionBuffer.count &&
      slot * 3 + 2 < arr.length;
    if (hasTarget) {
      const offset = slot * 3;
      targetPosition.set(arr[offset], arr[offset + 1], arr[offset + 2] + 4);
      light.position.x = THREE.MathUtils.damp(light.position.x, targetPosition.x, 12, delta);
      light.position.y = THREE.MathUtils.damp(light.position.y, targetPosition.y, 12, delta);
      light.position.z = THREE.MathUtils.damp(light.position.z, targetPosition.z, 12, delta);
    }
    const targetIntensity = hasTarget
      ? (hoveredIdRef.current ? 8.2 : 6.4) * (1 - softeningRef.current * 0.18)
      : 0;
    light.intensity = THREE.MathUtils.damp(light.intensity, targetIntensity, 8, delta);
  });

  return <pointLight ref={lightRef} intensity={0} distance={58} decay={2} />;
}
