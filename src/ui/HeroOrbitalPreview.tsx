import { OrbitControls, Sparkles, Line } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { prefersReducedMotion } from '../util/motion';

type Vec3 = readonly [number, number, number];

type Satellite = {
  position: Vec3;
  color: string;
  size: number;
};

// A small, intentional constellation: it reads as a real knowledge graph at
// a glance without competing with the copy or creating a second full scene.
const SATELLITES: Satellite[] = [
  { position: [-2.2, 1.15, 0.25], color: '#a99bff', size: 0.16 },
  { position: [1.95, 1.65, -0.3], color: '#6fe8ff', size: 0.12 },
  { position: [2.4, -0.95, 0.45], color: '#b8a7ff', size: 0.18 },
  { position: [-1.35, -1.65, 0.4], color: '#6fe8ff', size: 0.1 },
  { position: [-2.8, -0.25, -0.65], color: '#c7baff', size: 0.11 },
  { position: [0.35, 2.15, 0.75], color: '#b8a7ff', size: 0.09 },
];

const NO_RAYCAST = (): void => {
  /* The preview is decorative; the surrounding card owns the actions. */
};

function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function ConstellationFallback() {
  return (
    <svg className="empty-state__visual-fallback" viewBox="0 0 360 272" fill="none" aria-hidden="true">
      <circle className="empty-state__orbit empty-state__orbit--outer" cx="180" cy="136" r="114" />
      <ellipse className="empty-state__orbit" cx="180" cy="136" rx="74" ry="126" />
      <path className="empty-state__link" d="M75 178 130 90l64 56 75-94 31 132-105-38-120 32Z" />
      <circle className="empty-state__node empty-state__node--core" cx="194" cy="146" r="15" />
      <circle className="empty-state__node" cx="75" cy="178" r="5" />
      <circle className="empty-state__node" cx="130" cy="90" r="7" />
      <circle className="empty-state__node empty-state__node--cyan" cx="269" cy="52" r="5" />
      <circle className="empty-state__node" cx="300" cy="184" r="6" />
      <circle className="empty-state__node empty-state__node--cyan" cx="155" cy="214" r="4" />
    </svg>
  );
}

function OrbitalScene() {
  const coreRef = useRef<THREE.Group>(null);
  const ringsRef = useRef<THREE.Group>(null);
  const reduced = prefersReducedMotion();

  useFrame((_, delta) => {
    if (reduced) return;
    if (coreRef.current) {
      coreRef.current.rotation.y += delta * 0.42;
      coreRef.current.rotation.x += delta * 0.14;
    }
    if (ringsRef.current) {
      ringsRef.current.rotation.z += delta * 0.11;
      ringsRef.current.rotation.y -= delta * 0.08;
    }
  });

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[-4, 5, 6]} intensity={2.1} color="#d6d1ff" />
      <pointLight position={[3, -2, 3]} intensity={3.2} color="#62eaff" distance={12} />
      <fog attach="fog" args={['#080a1b', 4, 13]} />

      <Sparkles
        count={34}
        scale={[5.6, 4.4, 3.8]}
        size={2.2}
        speed={reduced ? 0 : 0.18}
        opacity={0.58}
        noise={1.2}
        color="#b8c1ff"
      />

      <group ref={ringsRef} rotation={[0.44, -0.28, -0.2]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
          <torusGeometry args={[2.25, 0.025, 6, 96]} />
          <meshBasicMaterial color="#79eaff" transparent opacity={0.68} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh rotation={[0.74, 0.18, 0.9]} raycast={NO_RAYCAST}>
          <torusGeometry args={[2.72, 0.019, 6, 96]} />
          <meshBasicMaterial color="#9d8bff" transparent opacity={0.56} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh rotation={[1.18, -0.75, 0.22]} raycast={NO_RAYCAST}>
          <torusGeometry args={[3.18, 0.014, 6, 96]} />
          <meshBasicMaterial color="#b8a7ff" transparent opacity={0.42} blending={THREE.AdditiveBlending} />
        </mesh>
      </group>

      {SATELLITES.map((satellite) => (
        <group key={satellite.position.join(':')}>
          <Line
            points={[[0, 0, 0], satellite.position]}
            color={satellite.color}
            transparent
            opacity={0.28}
            lineWidth={0.7}
            depthWrite={false}
          />
          <mesh position={satellite.position} raycast={NO_RAYCAST}>
            <sphereGeometry args={[satellite.size, 16, 12]} />
            <meshStandardMaterial
              color={satellite.color}
              emissive={satellite.color}
              emissiveIntensity={1.3}
              roughness={0.28}
              metalness={0.18}
            />
          </mesh>
        </group>
      ))}

      <group ref={coreRef} raycast={NO_RAYCAST}>
        <mesh>
          <icosahedronGeometry args={[0.78, 3]} />
          <meshPhysicalMaterial
            color="#43307e"
            emissive="#9b89ff"
            emissiveIntensity={1.5}
            metalness={0.42}
            roughness={0.16}
            clearcoat={1}
            clearcoatRoughness={0.08}
          />
        </mesh>
        <mesh scale={1.17}>
          <icosahedronGeometry args={[0.78, 2]} />
          <meshBasicMaterial
            color="#c0b5ff"
            wireframe
            transparent
            opacity={0.38}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh scale={1.5}>
          <sphereGeometry args={[0.78, 24, 18]} />
          <meshBasicMaterial
            color="#8d7dff"
            transparent
            opacity={0.09}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>

      <OrbitControls
        enablePan={false}
        enableZoom={false}
        enableDamping
        autoRotate={!reduced}
        autoRotateSpeed={0.52}
        minPolarAngle={Math.PI * 0.28}
        maxPolarAngle={Math.PI * 0.72}
      />
    </>
  );
}

/** A compact 3D preview that makes the empty state feel like the graph itself. */
export default function HeroOrbitalPreview() {
  return (
    <div
      className="empty-state__visual-stage"
      role="img"
      aria-label="Animated 3D constellation preview with a glowing knowledge core"
    >
      {supportsWebGL() ? (
        <Canvas
          className="empty-state__visual-canvas"
          camera={{ fov: 34, near: 0.1, far: 30, position: [0, 0, 8.5] }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.12;
          }}
        >
          <OrbitalScene />
        </Canvas>
      ) : (
        <ConstellationFallback />
      )}
      <span className="empty-state__visual-caption" aria-hidden="true">
        local signal map
      </span>
    </div>
  );
}
