/**
 * Quiet 2D community labels. The map layout already separates clusters into
 * readable islands, so labels add orientation without colored atmosphere,
 * hulls, rings, or any other backdrop mark that could be mistaken for data.
 */

import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';
import Text from './SceneText';
import { useFrame } from '@react-three/fiber';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { computeClusterFields, type ClusterPoint } from './clusterFields';
import { positionBuffer, slotOfId } from './positionBuffer';
import { labelWorldScale } from './labelLayout';
import { syncSceneLabel } from './systemLabel';

const FLAT_CLUSTER_LABEL_Z = -3;
const FLAT_CLUSTER_LABEL_RENDER_ORDER = -3;
const MAX_LABELS = 24;
const UPDATE_INTERVAL_SECONDS = 0.12;
const LABEL_FONT = '/fonts/Inter-Regular.woff';
const FONT_SIZE = 3.35;
const viewPosition = new THREE.Vector3();

type TroikaLabel = import('./systemLabel').SceneLabel;

function shortClusterName(name: string): string {
  return name.length > 28 ? `${name.slice(0, 27)}…` : name;
}

export default function FlatClusterLabels() {
  const nodes = useGraphStore((state) => state.nodes);
  const clusterNames = useGraphStore((state) => state.clusterNames);
  const localClusterNames = useGraphStore((state) => state.localClusterNames);
  const flat = useUiStore((state) => state.dims === 2);
  const collapsed = useUiStore((state) => state.clusterCollapsed);
  const qualityTier = useUiStore((state) => state.qualityTier);
  const labelRefs = useRef<(TroikaLabel | null)[]>(Array(MAX_LABELS).fill(null));
  const lastVersion = useRef(-1);
  const lastUpdate = useRef(-Infinity);
  const visible = flat && !collapsed && nodes.length >= 2;

  useEffect(() => {
    lastVersion.current = -1;
  }, [clusterNames, localClusterNames, nodes, qualityTier, visible]);

  useFrame(({ clock, camera, size }) => {
    if (!visible) {
      for (const label of labelRefs.current) if (label) label.visible = false;
      return;
    }
    // Camera motion does not change the layout version; resize labels even
    // while the graph is settled so community names never dwarf document text.
    const scaleLabel = (label: TroikaLabel): void => {
      viewPosition.copy(label.position).applyMatrix4(camera.matrixWorldInverse);
      label.scale.setScalar(labelWorldScale(
        FONT_SIZE, 11, -viewPosition.z, camera.projectionMatrix.elements[5], size.height,
      ));
    };
    for (const label of labelRefs.current) if (label?.visible) scaleLabel(label);
    if (
      positionBuffer.version === lastVersion.current ||
      clock.elapsedTime - lastUpdate.current < UPDATE_INTERVAL_SECONDS
    ) return;
    lastVersion.current = positionBuffer.version;
    lastUpdate.current = clock.elapsedTime;

    const samples: ClusterPoint[] = [];
    const arr = positionBuffer.array;
    for (const node of nodes) {
      if (node.kind !== 'document' || node.cluster < 0) continue;
      const slot = slotOfId.get(node.id);
      if (slot === undefined || slot >= positionBuffer.count) continue;
      const offset = slot * 3;
      samples.push({
        cluster: node.cluster,
        x: arr[offset],
        y: arr[offset + 1],
        z: FLAT_CLUSTER_LABEL_Z,
      });
    }

    const fields = computeClusterFields(samples, MAX_LABELS);
    for (let index = 0; index < MAX_LABELS; index += 1) {
      const label = labelRefs.current[index];
      if (!label || index >= fields.length || qualityTier >= 3) {
        if (label) label.visible = false;
        continue;
      }
      const field = fields[index];
      const name =
        clusterNames[field.cluster] ??
        localClusterNames[field.cluster] ??
        `Cluster ${field.cluster}`;
      const text = `${shortClusterName(name)}  ·  ${field.count}`;
      syncSceneLabel(label, text);
      label.position.set(field.x, field.y, FLAT_CLUSTER_LABEL_Z);
      scaleLabel(label);
      label.visible = true;
    }
  });

  if (!visible) return null;

  return (
    <Suspense fallback={null}>
      {Array.from({ length: MAX_LABELS }, (_, index) => (
        <Text
          key={index}
          ref={(label: TroikaLabel | null) => {
            labelRefs.current[index] = label;
          }}
          font={LABEL_FONT}
          fontSize={FONT_SIZE}
          color="#8ea6ba"
          fillOpacity={0.65}
          letterSpacing={0.04}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.1}
          outlineColor="#06101a"
          outlineOpacity={1}
          renderOrder={FLAT_CLUSTER_LABEL_RENDER_ORDER}
          material-toneMapped={false}
          material-depthWrite={false}
          material-depthTest={true}
          visible={false}
        >
          {''}
        </Text>
      ))}
    </Suspense>
  );
}
