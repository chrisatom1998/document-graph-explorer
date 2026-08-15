/**
 * Dedicated path-route overlay. PathPanel still dims the rest of the graph
 * via searchResults; this draws the hop filaments, traveling packets, and
 * endpoint rings so a route reads as a route — not as another search hit.
 *
 * Fat ribbons + pulses at quality tiers 0–1; hairlines + static rings after
 * that. prefers-reduced-motion keeps the highlight but drops traveling packets.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { useFrame } from '@react-three/fiber';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { prefersReducedMotion } from '../util/motion';
import { EDGE_SEGMENTS, EDGE_SEGMENTS_DEGRADED, edgeControlPoint, evalEdgePoint } from './edgeCurve';
import { positionBuffer, scaleOfSlot, slotOfId } from './positionBuffer';
import { isPathHop, pathHopSet } from './pathHops';

const PATH_SRC = new THREE.Color('#77e5ff');
const PATH_DST = new THREE.Color('#b4a8ff');
const START_RING = new THREE.Color('#7ee8c4');
const END_RING = new THREE.Color('#77e5ff');
const MAX_HOPS = 48;
const PULSE_CAP = MAX_HOPS * 2;

const dummy = new THREE.Object3D();
const ctrl = new Float32Array(3);
const pt = new Float32Array(3);
const tmpColor = new THREE.Color();

const NO_RAYCAST = (): void => {
  /* decoration */
};

const fatMaterial = new LineMaterial({
  color: 0xffffff,
  linewidth: 3.2,
  vertexColors: true,
  transparent: true,
  opacity: 0.92,
  dashed: false,
  alphaToCoverage: false,
  worldUnits: false,
  toneMapped: false,
});
fatMaterial.resolution.set(1, 1);

const hairMaterial = new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
});

const ringMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uColor: { value: new THREE.Color('#77e5ff') },
    uIntensity: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uIntensity;
    varying vec2 vUv;
    void main() {
      float d = length(vUv - 0.5) * 2.0;
      float ring = smoothstep(0.16, 0.0, abs(d - 0.72));
      float haze = smoothstep(0.72, 0.2, d) * 0.12;
      gl_FragColor = vec4(uColor * uIntensity * (1.6 * ring + haze), 1.0);
    }
  `,
});

const startRingMat = ringMaterial.clone();
startRingMat.uniforms.uColor.value = START_RING;
const endRingMat = ringMaterial.clone();
endRingMat.uniforms.uColor.value = END_RING;

function activePathIds(): string[] | null {
  const ui = useUiStore.getState();
  if (ui.highlightOwner !== 'path' || !ui.searchResults || ui.searchResults.length < 2) {
    return null;
  }
  return ui.searchResults;
}

export default function PathRoute() {
  const highlightOwner = useUiStore((s) => s.highlightOwner);
  const searchResults = useUiStore((s) => s.searchResults);
  const qualityTier = useUiStore((s) => s.qualityTier);
  const pathIds = highlightOwner === 'path' && searchResults && searchResults.length >= 2
    ? searchResults
    : null;

  const groupRef = useRef<THREE.Group>(null);
  const hopSlots = useRef<{ from: number; to: number }[]>([]);
  const pulseRef = useRef<THREE.InstancedMesh>(null);
  const startRef = useRef<THREE.Mesh>(null);
  const endRef = useRef<THREE.Mesh>(null);
  const hairRef = useRef<THREE.LineSegments>(null);
  const fatGeomRef = useRef<LineSegmentsGeometry | null>(null);
  const fatLineRef = useRef<LineSegments2 | null>(null);
  const positions = useRef(new Float32Array(0));
  const colors = useRef(new Float32Array(0));
  const rebuild = useRef(true);

  const segments = qualityTier >= 2 ? EDGE_SEGMENTS_DEGRADED : EDGE_SEGMENTS;
  const fat = qualityTier < 2;
  const ringGeom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  useEffect(() => {
    rebuild.current = true;
  }, [pathIds, segments, fat]);

  useEffect(() => {
    const offUi = useUiStore.subscribe((s, prev) => {
      if (
        s.searchResults !== prev.searchResults ||
        s.highlightOwner !== prev.highlightOwner ||
        s.qualityTier !== prev.qualityTier ||
        s.dims !== prev.dims
      ) {
        rebuild.current = true;
      }
    });
    const offGraph = useGraphStore.subscribe((s, prev) => {
      if (s.edges !== prev.edges) rebuild.current = true;
    });
    return () => {
      offUi();
      offGraph();
    };
  }, []);

  useEffect(() => {
    const mesh = pulseRef.current;
    if (mesh && !mesh.instanceColor) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(PULSE_CAP * 3).fill(1), 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = attr;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    return () => {
      fatGeomRef.current?.dispose();
      fatLineRef.current?.removeFromParent();
    };
  }, []);

  useFrame(({ camera, clock, size }) => {
    fatMaterial.resolution.set(size.width, size.height);
    const ids = activePathIds();
    const start = startRef.current;
    const end = endRef.current;
    const pulse = pulseRef.current;
    if (!ids) {
      if (start) start.visible = false;
      if (end) end.visible = false;
      if (pulse) pulse.count = 0;
      if (hairRef.current) hairRef.current.visible = false;
      if (fatLineRef.current) fatLineRef.current.visible = false;
      return;
    }

    const hops = pathHopSet(ids);
    const { edges } = useGraphStore.getState();
    const flat = useUiStore.getState().dims === 2;
    const segs = useUiStore.getState().qualityTier >= 2 ? EDGE_SEGMENTS_DEGRADED : EDGE_SEGMENTS;
    const useFat = useUiStore.getState().qualityTier < 2 && !flat;

    if (rebuild.current) {
      const pairs: { from: number; to: number }[] = [];
      for (const e of edges) {
        if (!isPathHop(e.source, e.target, hops)) continue;
        const a = slotOfId.get(e.source);
        const b = slotOfId.get(e.target);
        if (a === undefined || b === undefined) continue;
        pairs.push({ from: a, to: b });
        if (pairs.length >= MAX_HOPS) break;
      }
      hopSlots.current = pairs;
      const verts = pairs.length * segs * 2;
      positions.current = new Float32Array(verts * 3);
      colors.current = new Float32Array(verts * 3);
      rebuild.current = false;
    }

    const pairs = hopSlots.current;
    const arr = positionBuffer.array;
    const pos = positions.current;
    const col = colors.current;
    const time = clock.elapsedTime;
    const reduced = prefersReducedMotion();
    let write = 0;
    for (let i = 0; i < pairs.length; i++) {
      const sa = pairs[i].from;
      const sb = pairs[i].to;
      const ao = sa * 3;
      const bo = sb * 3;
      // Guard: the position array can be swapped/detached mid-frame (see
      // ingestBirth's writeSlotTravelPosition) — collapse the hop to nothing
      // rather than read out of range.
      if (ao + 2 >= arr.length || bo + 2 >= arr.length) {
        pos.fill(0, write, write + segs * 6);
        col.fill(0, write, write + segs * 6);
        write += segs * 6;
        continue;
      }
      if (flat) {
        ctrl[0] = (arr[ao] + arr[bo]) * 0.5;
        ctrl[1] = (arr[ao + 1] + arr[bo + 1]) * 0.5;
        ctrl[2] = (arr[ao + 2] + arr[bo + 2]) * 0.5;
      } else {
        edgeControlPoint(arr[ao], arr[ao + 1], arr[ao + 2], arr[bo], arr[bo + 1], arr[bo + 2], ctrl, 0);
      }
      const flow = reduced ? 0 : (time * 0.35) % 1;
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs;
        const t1 = (s + 1) / segs;
        evalEdgePoint(arr[ao], arr[ao + 1], arr[ao + 2], ctrl[0], ctrl[1], ctrl[2], arr[bo], arr[bo + 1], arr[bo + 2], t0, pt, 0);
        pos[write] = pt[0];
        pos[write + 1] = pt[1];
        pos[write + 2] = pt[2];
        evalEdgePoint(arr[ao], arr[ao + 1], arr[ao + 2], ctrl[0], ctrl[1], ctrl[2], arr[bo], arr[bo + 1], arr[bo + 2], t1, pt, 0);
        pos[write + 3] = pt[0];
        pos[write + 4] = pt[1];
        pos[write + 5] = pt[2];
        const wave0 = 0.72 + 0.38 * Math.sin((t0 + flow) * Math.PI * 2);
        const wave1 = 0.72 + 0.38 * Math.sin((t1 + flow) * Math.PI * 2);
        tmpColor.copy(PATH_SRC).lerp(PATH_DST, t0).multiplyScalar(wave0);
        col[write] = tmpColor.r;
        col[write + 1] = tmpColor.g;
        col[write + 2] = tmpColor.b;
        tmpColor.copy(PATH_SRC).lerp(PATH_DST, t1).multiplyScalar(wave1);
        col[write + 3] = tmpColor.r;
        col[write + 4] = tmpColor.g;
        col[write + 5] = tmpColor.b;
        write += 6;
      }
    }

    if (useFat && pairs.length > 0) {
      // Bind the CPU arrays into GPU buffers ONCE per rebuild (setPositions/
      // setColors allocate fresh InstancedInterleavedBuffers every call —
      // per-frame that orphans GPU buffers). Steady state writes into the
      // same arrays above, so flipping needsUpdate is enough — the pattern
      // Edges.tsx uses.
      let geom = fatGeomRef.current;
      const bound =
        geom &&
        (geom.attributes.instanceStart as THREE.InterleavedBufferAttribute | undefined)
          ?.data.array === pos;
      if (!geom || !bound) {
        geom?.dispose(); // release the previous rebuild's GPU buffers
        geom = new LineSegmentsGeometry();
        geom.setPositions(pos);
        geom.setColors(col);
        (geom.attributes.instanceStart as THREE.InterleavedBufferAttribute).data.setUsage(
          THREE.DynamicDrawUsage,
        );
        (
          geom.attributes.instanceColorStart as THREE.InterleavedBufferAttribute
        ).data.setUsage(THREE.DynamicDrawUsage);
        fatGeomRef.current = geom;
        if (fatLineRef.current) fatLineRef.current.geometry = geom;
      } else {
        (geom.attributes.instanceStart as THREE.InterleavedBufferAttribute).data.needsUpdate =
          true;
        (
          geom.attributes.instanceColorStart as THREE.InterleavedBufferAttribute
        ).data.needsUpdate = true;
      }
      if (!fatLineRef.current) {
        fatLineRef.current = new LineSegments2(geom, fatMaterial);
        fatLineRef.current.frustumCulled = false;
        fatLineRef.current.raycast = NO_RAYCAST;
      }
      const group = groupRef.current;
      if (group && fatLineRef.current.parent !== group) group.add(fatLineRef.current);
      fatLineRef.current.visible = true;
      if (hairRef.current) hairRef.current.visible = false;
    } else if (hairRef.current) {
      const geom = hairRef.current.geometry;
      const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!posAttr || posAttr.array !== pos) {
        // New arrays from a rebuild: swap the attributes once, releasing the
        // superseded pair's GPU buffers (same reasoning as Edges.tsx).
        geom.dispose();
        const p = new THREE.BufferAttribute(pos, 3);
        p.setUsage(THREE.DynamicDrawUsage);
        const c = new THREE.BufferAttribute(col, 3);
        c.setUsage(THREE.DynamicDrawUsage);
        geom.setAttribute('position', p);
        geom.setAttribute('color', c);
      } else {
        posAttr.needsUpdate = true;
        (geom.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      }
      hairRef.current.visible = pairs.length > 0;
      if (fatLineRef.current) fatLineRef.current.visible = false;
    }

    const placeRing = (mesh: THREE.Mesh | null, id: string | undefined, intensity: number) => {
      if (!mesh || !id) {
        if (mesh) mesh.visible = false;
        return;
      }
      const slot = slotOfId.get(id);
      if (slot === undefined || slot >= positionBuffer.count || slot * 3 + 2 >= arr.length) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      mesh.position.set(arr[slot * 3], arr[slot * 3 + 1], arr[slot * 3 + 2]);
      mesh.quaternion.copy(camera.quaternion);
      const radius = scaleOfSlot[slot] || 1.1;
      const pulse = reduced ? 0 : Math.sin(clock.elapsedTime * 0.7 * Math.PI * 2) * 0.08;
      mesh.scale.setScalar(radius * 3.6 * (1 + pulse));
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uIntensity.value = intensity + pulse;
    };
    placeRing(start, ids[0], 1.15);
    placeRing(end, ids[ids.length - 1], 1.05);

    if (pulse) {
      if (reduced || useUiStore.getState().qualityTier >= 2) {
        pulse.count = 0;
      } else {
        pulse.count = pairs.length * 2;
        for (let i = 0; i < pairs.length; i++) {
          const sa = pairs[i].from;
          const sb = pairs[i].to;
          const ao = sa * 3;
          const bo = sb * 3;
          if (ao + 2 >= arr.length || bo + 2 >= arr.length) {
            // out-of-range slot (buffer swapped mid-frame): zero-scale packets
            for (let p = 0; p < 2; p++) {
              dummy.position.set(0, 0, 0);
              dummy.scale.setScalar(0);
              dummy.updateMatrix();
              pulse.setMatrixAt(i * 2 + p, dummy.matrix);
            }
            continue;
          }
          if (flat) {
            ctrl[0] = (arr[ao] + arr[bo]) * 0.5;
            ctrl[1] = (arr[ao + 1] + arr[bo + 1]) * 0.5;
            ctrl[2] = (arr[ao + 2] + arr[bo + 2]) * 0.5;
          } else {
            edgeControlPoint(arr[ao], arr[ao + 1], arr[ao + 2], arr[bo], arr[bo + 1], arr[bo + 2], ctrl, 0);
          }
          for (let p = 0; p < 2; p++) {
            const t = (time * 0.45 + p * 0.5) % 1;
            evalEdgePoint(arr[ao], arr[ao + 1], arr[ao + 2], ctrl[0], ctrl[1], ctrl[2], arr[bo], arr[bo + 1], arr[bo + 2], t, pt, 0);
            dummy.position.set(pt[0], pt[1], pt[2]);
            dummy.scale.setScalar(0.55 + 0.45 * Math.sin(Math.PI * t));
            dummy.updateMatrix();
            pulse.setMatrixAt(i * 2 + p, dummy.matrix);
            tmpColor.copy(PATH_SRC).lerp(PATH_DST, t).multiplyScalar(1.9);
            if (pulse.instanceColor) pulse.setColorAt(i * 2 + p, tmpColor);
          }
        }
        pulse.instanceMatrix.needsUpdate = true;
        if (pulse.instanceColor) pulse.instanceColor.needsUpdate = true;
      }
    }
  });

  if (!pathIds) return null;

  return (
    <group ref={groupRef}>
      <lineSegments ref={hairRef} frustumCulled={false} raycast={NO_RAYCAST}>
        <bufferGeometry />
        <primitive object={hairMaterial} attach="material" />
      </lineSegments>
      <instancedMesh
        ref={pulseRef}
        args={[undefined, undefined, PULSE_CAP]}
        frustumCulled={false}
        raycast={NO_RAYCAST}
      >
        <sphereGeometry args={[0.42, 8, 8]} />
        <meshBasicMaterial
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      <mesh ref={startRef} geometry={ringGeom} frustumCulled={false} raycast={NO_RAYCAST}>
        <primitive object={startRingMat} attach="material" />
      </mesh>
      <mesh ref={endRef} geometry={ringGeom} frustumCulled={false} raycast={NO_RAYCAST}>
        <primitive object={endRingMat} attach="material" />
      </mesh>
    </group>
  );
}
