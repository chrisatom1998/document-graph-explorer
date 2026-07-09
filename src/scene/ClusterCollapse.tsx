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
 *
 * Centroids are recomputed every frame (inside useFrame, from the live
 * position buffer) and mutate a plain ref — ref mutations never trigger a
 * React re-render, so the cluster-name labels and inter-cluster edges below
 * MUST be driven imperatively from that same useFrame callback rather than
 * read from the ref during render (reading a mutated-in-place ref at render
 * time would see stale/empty data forever, since nothing ever asks React to
 * render again). Labels use the same fixed-pool + imperative
 * position/text/visible pattern as Labels.tsx; the inter-cluster edge
 * geometry is built once per inter-edge-set identity and has its position
 * attribute streamed in place each frame, the same split Edges.tsx uses for
 * the main edge buffer.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { positionBuffer, slotOfId } from './positionBuffer';
import { clusterColor } from './palette';

const MAX_CLUSTERS = 64;
const SUPER_NODE_BASE = 4.0;
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();
// Bundled locally, same reasoning as Labels.tsx: troika's default font is a
// CDN fetch that the privacy CSP blocks and offline use can't reach.
const LABEL_FONT = '/fonts/Inter-Regular.woff';

interface InterEdge {
  from: number;
  to: number;
  weight: number;
  count: number;
}

/** troika text mesh surface we mutate imperatively (see Labels.tsx). */
interface TroikaLabel extends THREE.Mesh {
  text: string;
  sync: (onSync?: () => void) => void;
}

export default function ClusterCollapse() {
  const clusterCollapsed = useUiStore((s) => s.clusterCollapsed);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const clusterNames = useGraphStore((s) => s.clusterNames);
  const localClusterNames = useGraphStore((s) => s.localClusterNames);
  const setClusterCollapsed = useUiStore((s) => s.setClusterCollapsed);
  const sendCamera = useUiStore((s) => s.sendCamera);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);
  const labelRefs = useRef<(TroikaLabel | null)[]>(Array(MAX_CLUSTERS).fill(null));
  const edgeGeomRef = useRef<THREE.BufferGeometry>(null);

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

  // Cluster of each node ID for fast lookup, feeding the inter-cluster edge
  // aggregation below.
  const nodeCluster = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) m.set(n.id, n.cluster);
    return m;
  }, [nodes]);

  // Aggregate inter-cluster edge weights. Structural (from/to/weight), not
  // positional — positions are streamed into edgeAttrs.positions per frame
  // below, so this only needs to be recomputed when the edge/cluster
  // structure itself changes.
  const interEdges = useMemo<InterEdge[]>(() => {
    const map = new Map<string, InterEdge>();
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

  // Attribute pair sized for the current inter-edge set. Colors are static
  // (weight doesn't change per frame) so they're filled once here; positions
  // start at zero and are streamed in place every frame from the live
  // centroids below.
  const edgeAttrs = useMemo(() => {
    const positions = new Float32Array(interEdges.length * 6);
    const colors = new Float32Array(interEdges.length * 6);
    for (let i = 0; i < interEdges.length; i++) {
      const ie = interEdges[i];
      const alpha = 0.2 + 0.6 * ie.weight;
      const o = i * 6;
      colors[o] = colors[o + 3] = 0.5 * alpha;
      colors[o + 1] = colors[o + 4] = 0.6 * alpha;
      colors[o + 2] = colors[o + 5] = 0.9 * alpha;
    }
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const colorAttr = new THREE.BufferAttribute(colors, 3);
    return { positions: posAttr, colors: colorAttr };
  }, [interEdges]);

  // The <bufferGeometry> instance below persists across `edgeAttrs` changes
  // (same ref, attributes swapped via `primitive`/`attach`) — dispose it
  // whenever the attribute pair is replaced so the renderer drops its old
  // GPU buffers instead of leaking them on every edge-set change.
  useEffect(() => {
    const geom = edgeGeomRef.current;
    if (geom) {
      geom.dispose();
      geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    }
  }, [edgeAttrs]);

  // Centroids recomputed each frame from position buffer
  const centroidsRef = useRef(new Map<number, THREE.Vector3>());
  // Persistent per-frame scratch — reused (not reallocated) each frame so the
  // collapsed view runs at a zero-GC steady state. `sumsRef` holds the running
  // per-cluster accumulators; `centroidPoolRef` holds a reusable Vector3 per
  // cluster id so we never `new THREE.Vector3()` inside the frame loop.
  const sumsRef = useRef(new Map<number, { x: number; y: number; z: number; n: number }>());
  const centroidPoolRef = useRef(new Map<number, THREE.Vector3>());

  // Dirty heuristic (same pattern as Nodes/Edges): skip the per-frame
  // centroid recompute when the simulation hasn't ticked since last frame.
  const lastVersionRef = useRef(-1);
  useEffect(() => {
    lastVersionRef.current = -1; // membership changed — matrices are stale
  }, [nodes]);

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

  // Per-frame: recompute centroids, update instance matrices, and drive the
  // label pool + inter-cluster edge positions imperatively (see header note
  // on why this can't be done from render).
  useFrame(() => {
    const mesh = meshRef.current;
    const halo = haloRef.current;
    if (!mesh || !halo || !clusterCollapsed) {
      if (mesh) mesh.count = 0;
      if (halo) halo.count = 0;
      lastVersionRef.current = -1; // force a recompute when collapse re-activates
      for (const label of labelRefs.current) {
        if (label) label.visible = false;
      }
      return;
    }
    if (positionBuffer.version === lastVersionRef.current) return;
    lastVersionRef.current = positionBuffer.version;

    const count = positionBuffer.count;
    const arr = positionBuffer.array;
    const centroids = centroidsRef.current;
    const centroidPool = centroidPoolRef.current;
    centroids.clear();

    // Accumulate positions per cluster into reused accumulators (reset in place)
    const sums = sumsRef.current;
    for (const s of sums.values()) {
      s.x = 0; s.y = 0; s.z = 0; s.n = 0;
    }
    for (const n of nodes) {
      if (n.cluster < 0) continue;
      const slot = slotOfId.get(n.id);
      if (slot === undefined || slot >= count) continue;
      const o = slot * 3;
      let s = sums.get(n.cluster);
      if (!s) {
        s = { x: 0, y: 0, z: 0, n: 0 };
        sums.set(n.cluster, s);
      }
      s.x += arr[o]; s.y += arr[o + 1]; s.z += arr[o + 2]; s.n++;
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
        // Reuse a pooled Vector3 per cluster id instead of allocating one each frame
        let v = centroidPool.get(c);
        if (!v) {
          v = new THREE.Vector3();
          centroidPool.set(c, v);
        }
        v.set(cx, cy, cz);
        centroids.set(c, v);
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

    // Cluster-name labels: fixed pool, positioned/texted imperatively (same
    // pattern as Labels.tsx) since they depend on the just-recomputed
    // centroids above.
    for (let i = 0; i < MAX_CLUSTERS; i++) {
      const label = labelRefs.current[i];
      if (!label) continue;
      if (i >= numClusters) {
        label.visible = false;
        continue;
      }
      const c = clusterIds[i];
      const centroid = centroids.get(c);
      if (!centroid) {
        label.visible = false;
        continue;
      }
      const memberN = clusterMeta.memberCount.get(c) ?? 1;
      const scale = SUPER_NODE_BASE * (1 + 0.6 * Math.log2(memberN));
      const name = clusterNames[c] ?? localClusterNames[c] ?? `Cluster ${c}`;
      const text = `${name} (${memberN})`;
      if (label.text !== text) {
        label.text = text;
        label.sync();
      }
      label.position.set(centroid.x, centroid.y + scale + 2.5, centroid.z);
      label.visible = true;
    }

    // Inter-cluster edge endpoints follow the same evolving centroids —
    // stream them into the geometry's position attribute in place.
    if (interEdges.length > 0) {
      const pos = edgeAttrs.positions.array as Float32Array;
      for (let i = 0; i < interEdges.length; i++) {
        const ie = interEdges[i];
        const cFrom = centroids.get(ie.from);
        const cTo = centroids.get(ie.to);
        if (!cFrom || !cTo) continue;
        const o = i * 6;
        pos[o] = cFrom.x;
        pos[o + 1] = cFrom.y;
        pos[o + 2] = cFrom.z;
        pos[o + 3] = cTo.x;
        pos[o + 4] = cTo.y;
        pos[o + 5] = cTo.z;
      }
      edgeAttrs.positions.needsUpdate = true;
    }
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

  // Super-nodes are clickable (expand + frame the cluster) — signal it on hover.
  const handlePointerOver = (): void => {
    document.body.style.cursor = 'pointer';
  };
  const handlePointerOut = (): void => {
    document.body.style.cursor = '';
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
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
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

      {/* Inter-cluster edges — geometry mounted once per interEdges identity;
          positions are streamed imperatively in the useFrame above. */}
      {interEdges.length > 0 && (
        <lineSegments frustumCulled={false}>
          <bufferGeometry ref={edgeGeomRef}>
            <primitive object={edgeAttrs.positions} attach="attributes-position" />
            <primitive object={edgeAttrs.colors} attach="attributes-color" />
          </bufferGeometry>
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
      )}

      {/* Cluster name labels — fixed pool, mounted once; position/text/
          visibility are all set imperatively in the useFrame above (mirrors
          Labels.tsx's pool pattern). */}
      {Array.from({ length: MAX_CLUSTERS }, (_, i) => (
        <Text
          key={i}
          ref={(t: TroikaLabel | null) => {
            labelRefs.current[i] = t;
          }}
          font={LABEL_FONT}
          fontSize={2.2}
          color="white"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.08}
          outlineColor="#000000"
          fillOpacity={0.9}
          visible={false}
        >
          {''}
        </Text>
      ))}
    </group>
  );
}
