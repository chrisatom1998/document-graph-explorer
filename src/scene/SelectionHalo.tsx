/**
 * Pulsing selection ring: a single additive billboard that tracks the
 * selected node's slot in positionBuffer, scaled to the node's radius. The
 * ring is authored bright (toneMapped-free ShaderMaterial) so it feeds the
 * bloom pass — selection reads as the node being lit up, complementing the
 * emphasis dimming and the tier-0 DoF rather than replacing them.
 *
 * Under prefers-reduced-motion the ring holds at its mid size, no pulse.
 * Unmounted entirely while nothing is selected.
 */

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useUiStore } from '../store/uiStore';
import { positionBuffer, scaleOfSlot, slotOfId } from './positionBuffer';
import { prefersReducedMotion } from '../util/motion';

const RING_SCALE = 3.2; // ring diameter relative to node radius (mid-pulse)
const PULSE_AMPLITUDE = 0.12;
const PULSE_HZ = 0.6;

const ringMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uColor: { value: new THREE.Color('#a996ff') },
    uIntensity: { value: 1.0 },
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
      float d = length(vUv - 0.5) * 2.0; // 0 at center, 1 at plane edge
      // thin bright ring with a soft inner haze so it hugs the marble
      float ring = smoothstep(0.16, 0.0, abs(d - 0.72));
      float haze = smoothstep(0.72, 0.2, d) * 0.12;
      vec3 glow = uColor * uIntensity * (1.6 * ring + haze);
      gl_FragColor = vec4(glow, 1.0);
    }
  `,
});

export default function SelectionHalo() {
  const selectedId = useUiStore((s) => s.selectedId);
  const meshRef = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  useFrame(({ camera, clock }) => {
    const mesh = meshRef.current;
    const id = useUiStore.getState().selectedId;
    if (!mesh || !id) return;
    const slot = slotOfId.get(id);
    if (slot === undefined || slot >= positionBuffer.count) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const o = slot * 3;
    const arr = positionBuffer.array;
    mesh.position.set(arr[o], arr[o + 1], arr[o + 2]);
    mesh.quaternion.copy(camera.quaternion); // billboard
    const radius = scaleOfSlot[slot] || 1.1;
    const pulse = prefersReducedMotion()
      ? 0
      : Math.sin(clock.elapsedTime * PULSE_HZ * Math.PI * 2) * PULSE_AMPLITUDE;
    mesh.scale.setScalar(radius * RING_SCALE * (1 + pulse));
    ringMaterial.uniforms.uIntensity.value = 1 + 0.5 * pulse;
  });

  if (!selectedId) return null;

  return (
    <mesh ref={meshRef} geometry={geometry} frustumCulled={false} raycast={() => {}}>
      <primitive object={ringMaterial} attach="material" />
    </mesh>
  );
}
