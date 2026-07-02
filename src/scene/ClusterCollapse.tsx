/**
 * Cluster super-node collapse view (spec §9: hairball mitigation).
 *
 * When uiStore.clusterCollapsed is true, replaces the individual-node graph
 * with one large sphere per community positioned at the cluster centroid,
 * plus inter-cluster edges. Individual nodes/edges/labels are hidden by their
 * respective components (Nodes/Edges/EdgePulses/Labels check the flag).
 *
 * Super-nodes are sized by log(memberCount) and colored with the cluster's
 * golden-angle hue. Clicking a super-node selects all its members and frames
 * them (with cluster collapse deactivated so you can explore inside).
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { positionBuffer, slotOfId } from './positionBuffer';
import { clusterColor } from './palette';

const MAX_CLUSTERS = 64;
const SUPER_NODE_BASE = 4.0;
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

function InterClusterEdges({ clusterIds, centroids }: {
  clusterIds: number[];
  centroids: Map<number, THREE.Vector3>;
}) {
  const edges = useGraphStore((s) => s.edges);
  const nodes = useGraphStore((s) => s.nodes);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);

  // Build cluster of each node ID for fast lookup
  const nodeCluster = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) m.set(n.id, n.cluster);
    return m;
  }, [nodes]);

  // Aggregate inter-cluster edge weights
  const interEdges = useMemo(() => {
    const map = new Map<string, { from: number; to: number; weight: number; count: number }>();
    for (const e of edges) {
      const ca = nodeCluster.get(e.source);
      const cb = nodeCluster.get(e.target);
      if (ca === undefined || cb === undefined || ca === cb || ca < 0 || cb < 0) continue;
      const [lo, hi] = ca < cb ? [ca, cb] : [cb, ca];
      const key = `${lo}-${hi}`;
      const existing = map.get(key);
      if (existing) {
        existing.weight = Math.max(existing.weight, e.weight);
        existing.count++;
      } else {
        map.set(key, { from: lo, to: hi, weight: e.weight, count: 1 });
      }
    }
    return [...map.values()];
  }, [edges, nodeCluster]);

  // Build geometry
  const geom = useMemo(() => {
    const positions = new Float32Array(interEdges.length * 6);
    const colors = new Float32Array(interEdges.length * 6);
    for (let i = 0; i < interEdges.length; i++) {
      const ie = interEdges[i];
      const cFrom = centroids.get(ie.from);
      const cTo = centroids.get(ie.to);
      if (!cFrom || !cTo) continue;
      const o = i * 6;
      positions[o] = cFrom.x;
      positions[o + 1] = cFrom.y;
      positions[o + 2] = cFrom.z;
      positions[o + 3] = cTo.x;
      positions[o + 4] = cTo.y;
      positions[o + 5] = cTo.z;
      const alpha = 0.2 + 0.6 * ie.weight;
      colors[o] = colors[o + 3] = 0.5 * alpha;
      colors[o + 1] = colors[o + 4] = 0.6 * alpha;
      colors[o + 2] = colors[o + 5] = 0.9 * alpha;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return g;
  }, [interEdges, centroids]);

  if (interEdges.length === 0) return null;

  return (
    <lineSegments geometry={geom} frustumCulled={false}>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={0.6}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
        linewidth={2}
      />
    </lineSegments>
  );
}

export default function ClusterCollapse() {
  const clusterCollapsed = useUiStore((s) => s.clusterCollapsed);
  const nodes = useGraphStore((s) => s.nodes);
  const clusterNames = useGraphStore((s) => s.clusterNames);
  const clusterCount = useGraphStore((s) => s.clusterCount);
  const setClusterCollapsed = useUiStore((s) => s.setClusterCollapsed);
  const sendCamera = useUiStore((s) => s.sendCamera);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);

  // Compute cluster metadata
  const clusterMeta = useMemo(() => {
    const memberCount = new Map<number, number>();
    const memberIds = new Map<number, string[]>();
    for (const n of nodes) {
      if (n.cluster < 0) continue;
      memberCount.set(n.cluster, (memberCount.get(n.cluster) ?? 0) + 1);
      const existing = memberIds.get(n.cluster);
      if (existing) existing.push(n.id);
      else memberIds.set(n.cluster, [n.id]);
    }
    return { memberCount, memberIds };
  }, [nodes]);

  const clusterIds = useMemo(
    () => [...clusterMeta.memberCount.keys()].sort((a, b) => a - b),
    [clusterMeta],
  );

  // Centroids recomputed each frame from position buffer
  const centroidsRef = useRef(new Map<number, THREE.Vector3>());

  // Pre-create instance colors at full capacity
  useEffect(() => {
    for (const mesh of [meshRef.current, haloRef.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (!mesh.instanceColor) {
        const attr = new THREE.InstancedBufferAttribute(
          new Float32Array(MAX_CLUSTERS * 3).fill(1), 3,
        );
        attr.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = attr;
      }
      // Set colors per cluster
      for (let i = 0; i < clusterIds.length && i < MAX_CLUSTERS; i++) {
        tmpColor.copy(clusterColor(clusterIds[i]));
        mesh.setColorAt(i, tmpColor);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [clusterIds]);

  // Per-frame: recompute centroids and update instance matrices
  useFrame(() => {
    const mesh = meshRef.current;
    const halo = haloRef.current;
    if (!mesh || !halo || !clusterCollapsed) {
      if (mesh) mesh.count = 0;
      if (halo) halo.count = 0;
      return;
    }

    const count = positionBuffer.count;
    const arr = positionBuffer.array;
    const centroids = centroidsRef.current;
    centroids.clear();

    // Accumulate positions per cluster
    const sums = new Map<number, { x: number; y: number; z: number; n: number }>();
    for (const n of nodes) {
      if (n.cluster < 0) continue;
      const slot = slotOfId.get(n.id);
      if (slot === undefined || slot >= count) continue;
      const o = slot * 3;
      const s = sums.get(n.cluster);
      if (s) {
        s.x += arr[o]; s.y += arr[o + 1]; s.z += arr[o + 2]; s.n++;
      } else {
        sums.set(n.cluster, { x: arr[o], y: arr[o + 1], z: arr[o + 2], n: 1 });
      }
    }

    const numClusters = Math.min(clusterIds.length, MAX_CLUSTERS);
    mesh.count = numClusters;
    halo.count = numClusters;

    for (let i = 0; i < numClusters; i++) {
      const c = clusterIds[i];
      const s = sums.get(c);
      if (!s || s.n === 0) {
        dummy.scale.setScalar(0);
        dummy.position.set(0, 0, 0);
      } else {
        const cx = s.x / s.n;
        const cy = s.y / s.n;
        const cz = s.z / s.n;
        dummy.position.set(cx, cy, cz);
        centroids.set(c, new THREE.Vector3(cx, cy, cz));
        const memberN = clusterMeta.memberCount.get(c) ?? 1;
        const scale = SUPER_NODE_BASE * (1 + 0.6 * Math.log2(memberN));
        dummy.scale.setScalar(scale);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Halo: larger and more visible
      if (s && s.n > 0) {
        dummy.scale.multiplyScalar(1.8);
      }
      dummy.updateMatrix();
      halo.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    halo.instanceMatrix.needsUpdate = true;
  });

  const handleClick = (e: THREE.Event) => {
    // @ts-expect-error — ThreeEvent typing
    const instanceId = e.instanceId as number | undefined;
    if (instanceId === undefined || instanceId >= clusterIds.length) return;
    // @ts-expect-error — ThreeEvent has stopPropagation
    e.stopPropagation();
    const clusterId = clusterIds[instanceId];
    const members = clusterMeta.memberIds.get(clusterId);
    if (members && members.length > 0) {
      // Deactivate collapse and frame the cluster's members
      setClusterCollapsed(false);
      sendCamera('frameSet', members);
    }
  };

  if (!clusterCollapsed) return null;

  return (
    <group>
      {/* Super-node spheres */}
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, MAX_CLUSTERS]}
        frustumCulled={false}
        onClick={handleClick}
      >
        <sphereGeometry args={[1, 32, 24]} />
        <meshPhongMaterial specular="#6a6a82" shininess={58} />
      </instancedMesh>

      {/* Halo */}
      <instancedMesh
        ref={haloRef}
        args={[undefined, undefined, MAX_CLUSTERS]}
        frustumCulled={false}
        raycast={() => {}}
      >
        <sphereGeometry args={[1, 24, 18]} />
        <meshBasicMaterial
          transparent
          opacity={0.15}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>

      {/* Inter-cluster edges */}
      <InterClusterEdges clusterIds={clusterIds} centroids={centroidsRef.current} />

      {/* Cluster name labels */}
      {clusterIds.map((c) => {
        const centroid = centroidsRef.current.get(c);
        if (!centroid) return null;
        const name = clusterNames[c] ?? `Cluster ${c}`;
        const memberN = clusterMeta.memberCount.get(c) ?? 1;
        const scale = SUPER_NODE_BASE * (1 + 0.6 * Math.log2(memberN));
        return (
          <Text
            key={c}
            position={[centroid.x, centroid.y + scale + 2.5, centroid.z]}
            fontSize={2.2}
            color="white"
            anchorX="center"
            anchorY="bottom"
            outlineWidth={0.08}
            outlineColor="#000000"
            fillOpacity={0.9}
          >
            {name} ({memberN})
          </Text>
        );
      })}
    </group>
  );
}
