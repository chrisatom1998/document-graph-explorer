/** Local illumination that makes the active node affect the scene around it. */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { clusterColor } from './palette';
import { positionBuffer, slotOfId } from './positionBuffer';

const targetPosition = new THREE.Vector3();
const white = new THREE.Color('white');

export default function FocusLight() {
  const nodes = useGraphStore((state) => state.nodes);
  const hoveredId = useUiStore((state) => state.hoveredId);
  const selectedId = useUiStore((state) => state.selectedId);
  const flat = useUiStore((state) => state.dims === 2);
  const lightRef = useRef<THREE.PointLight>(null);
  const clusterById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.cluster])),
    [nodes],
  );
  const focusId = hoveredId ?? selectedId;

  useEffect(() => {
    const light = lightRef.current;
    if (!light || !focusId) return;
    light.color.copy(clusterColor(clusterById.get(focusId) ?? -1)).lerp(white, 0.2);
  }, [clusterById, focusId]);

  useFrame((_, delta) => {
    const light = lightRef.current;
    if (!light) return;
    const slot = focusId ? slotOfId.get(focusId) : undefined;
    const hasTarget = !flat && slot !== undefined && slot < positionBuffer.count;
    if (hasTarget) {
      const offset = slot * 3;
      targetPosition.set(
        positionBuffer.array[offset],
        positionBuffer.array[offset + 1],
        positionBuffer.array[offset + 2] + 4,
      );
      light.position.x = THREE.MathUtils.damp(light.position.x, targetPosition.x, 12, delta);
      light.position.y = THREE.MathUtils.damp(light.position.y, targetPosition.y, 12, delta);
      light.position.z = THREE.MathUtils.damp(light.position.z, targetPosition.z, 12, delta);
    }
    const targetIntensity = hasTarget ? (hoveredId ? 7.5 : 5.5) : 0;
    light.intensity = THREE.MathUtils.damp(light.intensity, targetIntensity, 8, delta);
  });

  return <pointLight ref={lightRef} intensity={0} distance={48} decay={2} />;
}
