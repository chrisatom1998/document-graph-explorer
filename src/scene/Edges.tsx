/**
 * All edges in a single LineSegments buffer (spec §7.1).
 *
 * - Geometry attributes are rebuilt when the edge list changes; endpoint
 *   positions are streamed from positionBuffer each layout tick.
 * - Vertex colors encode kind tint x weight, dim to 8% when a hover/search/
 *   filter emphasis is active, and brighten x1.6 on edges incident to the
 *   hovered/selected node.
 * - Clicking an edge selects it for the evidence popover (uiStore
 *   .setSelectedEdge). Node spheres naturally win overlapping picks: they
 *   intersect closer and stop propagation.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { positionBuffer, slotOfId } from './positionBuffer';
import { EDGE_TINTS } from './palette';
import { computeEmphasis } from './Nodes';

const DIM_FACTOR = 0.08;
const FOCUS_BOOST = 1.6;

const tmpColor = new THREE.Color();

export default function Edges() {
  const edges = useGraphStore((s) => s.edges);
  const raycaster = useThree((s) => s.raycaster);

  const colorsDirty = useRef(true);
  const forcePositions = useRef(true);
  const lastVersion = useRef(-1);

  // Line picking tolerance (world units). Points threshold is irrelevant here.
  useEffect(() => {
    raycaster.params.Line.threshold = 1.2;
  }, [raycaster]);

  // Fresh attribute pair per edge-list identity. positions fill per frame;
  // colors fill on edges/hover/search/filter changes.
  const attrs = useMemo(() => {
    const positions = new THREE.BufferAttribute(new Float32Array(edges.length * 6), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    const colors = new THREE.BufferAttribute(new Float32Array(edges.length * 6), 3);
    colors.setUsage(THREE.DynamicDrawUsage);
    return { positions, colors };
  }, [edges]);

  // The default bounding sphere would be computed from the initial all-zero
  // positions and then never track the moving layout, which breaks raycast
  // culling — make it permissive instead (we already skip frustum culling).
  const geomRef = useRef<THREE.BufferGeometry>(null);
  useEffect(() => {
    forcePositions.current = true;
    colorsDirty.current = true;
    const geom = geomRef.current;
    if (geom) geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  }, [attrs]);

  useEffect(() => {
    const offUi = useUiStore.subscribe((s, prev) => {
      if (
        s.hoveredId !== prev.hoveredId ||
        s.selectedId !== prev.selectedId ||
        s.searchResults !== prev.searchResults ||
        s.filter !== prev.filter
      ) {
        colorsDirty.current = true;
      }
    });
    return offUi;
  }, []);

  const recomputeColors = (): void => {
    const { nodes } = useGraphStore.getState();
    const { hoveredId, selectedId, searchResults, filter } = useUiStore.getState();
    const emphasis = computeEmphasis(nodes, edges, hoveredId, searchResults, filter);
    const focusId = hoveredId ?? selectedId;
    const col = attrs.colors.array as Float32Array;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      // base: kind tint scaled by weight (opacity/brightness = weight, §7.1);
      // kept delicate so links read as fine filaments, not bright spokes
      tmpColor.copy(EDGE_TINTS[e.kind]).multiplyScalar(0.16 + 0.55 * e.weight);
      if (emphasis && !(emphasis.has(e.source) && emphasis.has(e.target))) {
        tmpColor.multiplyScalar(DIM_FACTOR);
      }
      if (focusId && (e.source === focusId || e.target === focusId)) {
        tmpColor.multiplyScalar(FOCUS_BOOST);
        tmpColor.r = Math.min(tmpColor.r, 1);
        tmpColor.g = Math.min(tmpColor.g, 1);
        tmpColor.b = Math.min(tmpColor.b, 1);
      }
      const o = i * 6;
      col[o] = tmpColor.r;
      col[o + 1] = tmpColor.g;
      col[o + 2] = tmpColor.b;
      col[o + 3] = tmpColor.r;
      col[o + 4] = tmpColor.g;
      col[o + 5] = tmpColor.b;
    }
    attrs.colors.needsUpdate = true;
  };

  useFrame(() => {
    if (edges.length === 0) return;
    if (colorsDirty.current) {
      recomputeColors();
      colorsDirty.current = false;
    }
    const version = positionBuffer.version;
    if (version === lastVersion.current && !forcePositions.current) return;
    lastVersion.current = version;
    forcePositions.current = false;

    const arr = positionBuffer.array;
    const count = positionBuffer.count;
    const pos = attrs.positions.array as Float32Array;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const s = slotOfId.get(e.source);
      const t = slotOfId.get(e.target);
      if (s === undefined || t === undefined || s >= count || t >= count) {
        continue; // endpoint not placed yet: keep previous (zeros collapse to a point)
      }
      const o = i * 6;
      const so = s * 3;
      const to = t * 3;
      pos[o] = arr[so];
      pos[o + 1] = arr[so + 1];
      pos[o + 2] = arr[so + 2];
      pos[o + 3] = arr[to];
      pos[o + 4] = arr[to + 1];
      pos[o + 5] = arr[to + 2];
    }
    attrs.positions.needsUpdate = true;
  });

  const handleClick = (e: ThreeEvent<MouseEvent>): void => {
    if (e.index === undefined) return;
    const edge = edges[Math.floor(e.index / 2)]; // index = first vertex of the segment
    if (!edge) return;
    e.stopPropagation();
    useUiStore.getState().setSelectedEdge(edge.id);
  };

  if (edges.length === 0) return null;

  return (
    <lineSegments frustumCulled={false} onClick={handleClick}>
      <bufferGeometry ref={geomRef}>
        <primitive object={attrs.positions} attach="attributes-position" />
        <primitive object={attrs.colors} attach="attributes-color" />
      </bufferGeometry>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={0.32}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}
