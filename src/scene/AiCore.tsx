/**
 * The AI singularity at the center of the graph. A physical inner crystal,
 * fresnel energy shell, and three orbital traces give the core real volume;
 * the restrained sprite behind them supplies the soft atmospheric glow.
 *
 * Streaming still drives the existing energy ramp, but now it brightens and
 * accelerates the whole assembly. Reduced-motion mode keeps every geometry
 * layer static while retaining the steady brightness cue.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useChatStore } from '../store/chatStore';
import { useUiStore } from '../store/uiStore';
import { prefersReducedMotion } from '../util/motion';
import { computeAiCoreVisuals } from './aiCoreVisuals';
import { makeSoftSprite } from './proceduralTextures';

const CORE_COLOR = new THREE.Color('#26e6cf');
const SHELL_COLOR = new THREE.Color('#66fff0');
const RING_COLOR = '#7affef';

const NO_RAYCAST = (): void => {
  /* the core is decoration, never pickable */
};

const shellMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uColor: { value: SHELL_COLOR },
    uIntensity: { value: 0.28 },
  },
  vertexShader: /* glsl */ `
    varying float vRim;
    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vec3 viewNormal = normalize(normalMatrix * normal);
      float facing = abs(dot(viewNormal, normalize(-mvPosition.xyz)));
      vRim = pow(1.0 - facing, 2.4);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uIntensity;
    varying float vRim;
    void main() {
      float energy = 0.02 + 0.9 * vRim;
      gl_FragColor = vec4(uColor * uIntensity * energy, 1.0);
    }
  `,
});
shellMaterial.toneMapped = false;

export default function AiCore() {
  const sprite = useMemo(makeSoftSprite, []);
  const visible = useUiStore((s) => s.dims === 3);
  const glowRef = useRef<THREE.Sprite>(null);
  const glowMatRef = useRef<THREE.SpriteMaterial>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const ringsRef = useRef<THREE.Group>(null);
  const ringMaterials = useRef<THREE.MeshBasicMaterial[]>([]);

  const streamingRef = useRef(useChatStore.getState().isStreaming);
  useEffect(() => {
    streamingRef.current = useChatStore.getState().isStreaming;
    return useChatStore.subscribe((state) => {
      streamingRef.current = state.isStreaming;
    });
  }, []);

  const energy = useRef(0);
  const phase = useRef(0);

  useFrame((_, delta) => {
    const glow = glowRef.current;
    const glowMat = glowMatRef.current;
    const core = coreRef.current;
    const shell = shellRef.current;
    const wire = wireRef.current;
    const rings = ringsRef.current;
    if (!glow || !glowMat || !core || !shell || !wire || !rings) return;

    const target = streamingRef.current ? 1 : 0;
    energy.current = THREE.MathUtils.damp(energy.current, target, 4, delta);
    const reduced = prefersReducedMotion();
    phase.current += delta * (1.15 + energy.current * 2.4);
    const visual = computeAiCoreVisuals(energy.current, phase.current, reduced);

    glow.scale.set(visual.glowScale, visual.glowScale, 1);
    glowMat.opacity = visual.glowOpacity;
    glowMat.color.copy(CORE_COLOR).multiplyScalar(1 + energy.current * 0.35);
    core.scale.setScalar(visual.coreScale);
    shell.scale.setScalar(visual.shellScale);
    shellMaterial.uniforms.uIntensity.value = visual.shellIntensity;
    for (const material of ringMaterials.current) material.opacity = visual.ringOpacity;

    if (visual.angularSpeed > 0) {
      rings.rotation.y += visual.angularSpeed * delta;
      rings.rotation.z += visual.angularSpeed * delta * 0.37;
      wire.rotation.x -= visual.angularSpeed * delta * 0.42;
      wire.rotation.y += visual.angularSpeed * delta * 0.68;
    }
  });

  const rememberRingMaterial = (material: THREE.MeshBasicMaterial | null): void => {
    if (material && !ringMaterials.current.includes(material)) {
      ringMaterials.current.push(material);
    }
  };

  return (
    <group visible={visible}>
      <pointLight color={CORE_COLOR} intensity={5} distance={42} decay={2} />

      <sprite ref={glowRef} scale={[14, 14, 1]} raycast={NO_RAYCAST}>
        <spriteMaterial
          ref={glowMatRef}
          map={sprite}
          color={CORE_COLOR}
          transparent
          opacity={0.12}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>

      <mesh ref={coreRef} raycast={NO_RAYCAST}>
        <icosahedronGeometry args={[2.45, 4]} />
        <meshPhysicalMaterial
          color="#07322f"
          emissive={CORE_COLOR}
          emissiveIntensity={0.42}
          metalness={0.24}
          roughness={0.14}
          clearcoat={1}
          clearcoatRoughness={0.08}
          envMapIntensity={1.8}
        />
      </mesh>

      <mesh ref={wireRef} raycast={NO_RAYCAST} rotation={[0.4, 0.2, 0.1]}>
        <icosahedronGeometry args={[3.05, 2]} />
        <meshBasicMaterial
          color="#a4fff6"
          wireframe
          transparent
          opacity={0.34}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <mesh ref={shellRef} raycast={NO_RAYCAST}>
        <sphereGeometry args={[3.55, 32, 24]} />
        <primitive object={shellMaterial} attach="material" />
      </mesh>

      <group ref={ringsRef} rotation={[0.3, 0.15, -0.2]}>
        <mesh raycast={NO_RAYCAST} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[5.4, 0.07, 6, 96]} />
          <meshBasicMaterial
            ref={rememberRingMaterial}
            color={RING_COLOR}
            transparent
            opacity={0.46}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh raycast={NO_RAYCAST} rotation={[0.65, 0.2, 0.9]}>
          <torusGeometry args={[6.25, 0.06, 6, 96]} />
          <meshBasicMaterial
            ref={rememberRingMaterial}
            color="#70bfff"
            transparent
            opacity={0.46}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh raycast={NO_RAYCAST} rotation={[1.15, -0.75, 0.25]}>
          <torusGeometry args={[7.1, 0.05, 6, 96]} />
          <meshBasicMaterial
            ref={rememberRingMaterial}
            color="#b39aff"
            transparent
            opacity={0.46}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}
