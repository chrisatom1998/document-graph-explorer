/**
 * One-draw cluster atmosphere. Each community becomes a camera-facing,
 * procedurally feathered light volume that follows its live layout centroid.
 * The layer sits below nodes and links visually: low additive energy supplies
 * spatial grouping without drawing a hard boundary around fuzzy communities.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { prefersReducedMotion } from '../util/motion';
import { computeClusterFields, type ClusterPoint } from './clusterFields';
import { clusterColor } from './palette';
import { positionBuffer, slotOfId } from './positionBuffer';

const MAX_FIELDS = 48;
const UPDATE_INTERVAL_SECONDS = 0.1;
const FIELD_DIAMETER_MULTIPLIER = 2.35;

const fieldMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  depthTest: true,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uIntensity: { value: 0.105 },
  },
  vertexShader: /* glsl */ `
    attribute vec3 aColor;
    attribute float aSeed;
    varying vec2 vUv;
    varying vec3 vColor;
    varying float vSeed;

    void main() {
      vUv = uv;
      vColor = aColor;
      vSeed = aSeed;

      vec3 center = vec3(instanceMatrix[3]);
      float width = length(instanceMatrix[0].xyz);
      float height = length(instanceMatrix[1].xyz);
      vec4 viewCenter = modelViewMatrix * vec4(center, 1.0);
      viewCenter.xy += position.xy * vec2(width, height);
      gl_Position = projectionMatrix * viewCenter;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uIntensity;
    varying vec2 vUv;
    varying vec3 vColor;
    varying float vSeed;

    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      float radius = length(p);
      if (radius >= 1.0) discard;

      float body = pow(max(0.0, 1.0 - radius * radius), 2.1);
      float drift = uTime * 0.085;
      float filamentA = sin((p.x * 3.4 + p.y * 2.1 + vSeed) * 5.0 + drift);
      float filamentB = sin((p.x * -1.7 + p.y * 3.8 - vSeed) * 4.0 - drift * 0.7);
      float filaments = 0.72 + 0.14 * filamentA + 0.14 * filamentB;
      float outerShell = exp(-pow((radius - 0.7) * 5.2, 2.0)) * 0.24;
      float energy = uIntensity * (body * filaments + outerShell);

      gl_FragColor = vec4(vColor * energy, 1.0);
    }
  `,
});
fieldMaterial.toneMapped = false;

const dummy = new THREE.Object3D();
const tempColor = new THREE.Color();
const atmosphereMix = new THREE.Color('#9ebdff');

export default function ClusterAtmosphere() {
  const nodes = useGraphStore((state) => state.nodes);
  const visible = useUiStore((state) => state.dims === 3 && state.qualityTier < 3);
  const qualityTier = useUiStore((state) => state.qualityTier);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const colorRef = useRef<THREE.InstancedBufferAttribute>(null);
  const lastVersion = useRef(-1);
  const lastUpdate = useRef(-Infinity);

  const seeds = useMemo(
    () => Float32Array.from({ length: MAX_FIELDS }, (_, index) => (index * 0.61803398875) % 1),
    [],
  );
  const colors = useMemo(() => new Float32Array(MAX_FIELDS * 3), []);

  // Tier 3 unmounts the draw entirely. Force a rebuild when it comes back
  // even if the force layout has already settled and stopped bumping version.
  useEffect(() => {
    if (visible) lastVersion.current = -1;
  }, [visible]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh || !visible) return;

    fieldMaterial.uniforms.uIntensity.value = qualityTier >= 2 ? 0.072 : 0.105;
    fieldMaterial.uniforms.uTime.value = prefersReducedMotion() ? 0 : clock.elapsedTime;

    if (
      positionBuffer.version === lastVersion.current ||
      clock.elapsedTime - lastUpdate.current < UPDATE_INTERVAL_SECONDS
    ) {
      return;
    }
    lastVersion.current = positionBuffer.version;
    lastUpdate.current = clock.elapsedTime;

    const samples: ClusterPoint[] = [];
    const positions = positionBuffer.array;
    for (const node of nodes) {
      if (node.kind === 'topic') continue;
      const slot = slotOfId.get(node.id);
      if (slot === undefined || slot >= positionBuffer.count) continue;
      const offset = slot * 3;
      samples.push({
        cluster: node.cluster,
        x: positions[offset],
        y: positions[offset + 1],
        z: positions[offset + 2],
      });
    }

    const fields = computeClusterFields(samples, MAX_FIELDS);
    mesh.count = fields.length;
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];
      dummy.position.set(field.x, field.y, field.z);
      const diameter = field.radius * FIELD_DIAMETER_MULTIPLIER;
      dummy.scale.set(diameter, diameter, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);

      tempColor.copy(clusterColor(field.cluster)).lerp(atmosphereMix, 0.18);
      colors[index * 3] = tempColor.r;
      colors[index * 3 + 1] = tempColor.g;
      colors[index * 3 + 2] = tempColor.b;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (colorRef.current) colorRef.current.needsUpdate = true;
  });

  if (!visible || nodes.length < 2) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, MAX_FIELDS]}
      count={0}
      frustumCulled={false}
      raycast={() => {}}
    >
      <planeGeometry args={[1, 1]}>
        <instancedBufferAttribute
          ref={colorRef}
          attach="attributes-aColor"
          args={[colors, 3]}
        />
        <instancedBufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
      </planeGeometry>
      <primitive object={fieldMaterial} attach="material" />
    </instancedMesh>
  );
}
