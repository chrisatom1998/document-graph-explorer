/**
 * The welcome screen's 3D hero — a miniature of the real thing.
 *
 * It deliberately borrows from the live scene rather than inventing a look:
 * satellite hues come from the same `clusterColor` walk the graph uses, and
 * the corona is the Fresnel halo from Nodes.tsx. What you see here is what a
 * corpus actually renders as, at a few clustered nodes instead of thousands.
 *
 * Budget: this canvas is a SECOND WebGL context, layered over the (node-less)
 * nebula scene behind the card, so everything is batched — one draw call each
 * for cores, halos, filaments, pulses and ambient dust, against the old per-satellite
 * mesh-and-material approach. It also holds no drei imports, keeping the lazy
 * chunk to three + fiber, which NebulaCanvas has already paid for.
 *
 * Motion stops for `prefers-reduced-motion` (frameloop 'demand' — one composed
 * still) and while the tab is hidden.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { clusterColor } from '../scene/palette';
import { prefersReducedMotion } from '../util/motion';
import ConstellationSvg from './ConstellationSvg';

type Vec3 = readonly [number, number, number];

/**
 * Index 0 is the core; the remaining nodes form three communities at different
 * depths so the graph reads as a miniature world instead of a flat logo.
 *
 * Cluster ids are chosen, not sequential. `clusterColor` walks the golden
 * angle from a blue anchor, so 0..7 spans the whole wheel — authentic to a
 * real corpus, but eight unrelated hues fight the card's violet-and-cyan
 * register. Drawing from four ids in the cool band, with repeats, is both
 * calmer and *more* faithful: real communities hold several nodes each.
 */
const VIOLET = 3;
const BLUE = 0;
const CYAN = 5;
const MAGENTA = 6; // lone warm accent, so the composition isn't monochrome

const NODES: readonly { position: Vec3; size: number; color: THREE.Color }[] = [
  { position: [0, 0, 0.2], size: 0.42, color: new THREE.Color('#eeeaff') },
  { position: [-2.45, 0.95, -0.35], size: 0.17, color: clusterColor(VIOLET).clone() },
  { position: [-1.55, -1.62, 0.55], size: 0.12, color: clusterColor(BLUE).clone() },
  { position: [-2.75, -0.45, 0.3], size: 0.1, color: clusterColor(BLUE).clone() },
  { position: [0.15, 2.05, 0.45], size: 0.15, color: clusterColor(VIOLET).clone() },
  { position: [1.85, 1.35, -0.4], size: 0.11, color: clusterColor(CYAN).clone() },
  { position: [2.65, -0.35, 0.25], size: 0.18, color: clusterColor(CYAN).clone() },
  { position: [1.35, -1.85, 0.6], size: 0.14, color: clusterColor(MAGENTA).clone() },
  { position: [-0.55, 1.35, -0.85], size: 0.095, color: clusterColor(VIOLET).clone() },
  { position: [-3.05, 1.65, -1.15], size: 0.075, color: clusterColor(VIOLET).clone() },
  { position: [-2.2, -2.15, -0.65], size: 0.08, color: clusterColor(BLUE).clone() },
  { position: [2.8, 1.45, -1.25], size: 0.075, color: clusterColor(CYAN).clone() },
  { position: [3.1, -1.25, -0.75], size: 0.09, color: clusterColor(CYAN).clone() },
  { position: [0.45, -2.55, -0.3], size: 0.075, color: clusterColor(MAGENTA).clone() },
  { position: [-0.65, 2.65, -0.4], size: 0.08, color: clusterColor(VIOLET).clone() },
];

/**
 * Spokes, then intra-community links, then bridges. The structure is the
 * point: a pure starburst reads as a logo, whereas dense pockets joined by a
 * few bridges reads as the community layout the graph actually produces.
 */
const EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [0, 2], [0, 4], [0, 5], [0, 6],
  [1, 8], [8, 4], [3, 2], [5, 6],
  [1, 3], [4, 5], [6, 7], [7, 2],
  [1, 9], [9, 8], [2, 10], [10, 3],
  [5, 11], [11, 6], [6, 12], [12, 7],
  [7, 13], [13, 2], [4, 14], [14, 8],
];

const CORE_GLOW = new THREE.Color('#a99bff');
const HALO_SCALE = 2.3;
const EDGE_BRIGHTNESS = 0.42;
const PULSE_SPEED = 0.24; // laps per second along a filament
/** Viewing tilt. Shallow angles collapse the orbit rings to flat lines. */
const TILT_X = 0.3;
const DUST_COUNT = 120;

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

const dustPositions = (() => {
  const random = seededRandom(0x5eedc0de);
  const positions = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i++) {
    const radius = 2.7 + random() * 2.7;
    const angle = random() * Math.PI * 2;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = (random() - 0.5) * 5.8;
    positions[i * 3 + 2] = (random() - 0.5) * 4.2 - 0.8;
  }
  return new THREE.BufferAttribute(positions, 3);
})();

/**
 * Fresnel corona, lifted from the scene's node halos: glow concentrates at the
 * view-grazing limb so a node reads as a bright core inside an atmosphere
 * rather than a flat additive ball. three declares the instancing attributes
 * for ShaderMaterial on an InstancedMesh, so per-instance hue flows through.
 */
const haloMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `
    varying vec3 vColor;
    varying float vRim;
    void main() {
      vColor = vec3(1.0);
      #ifdef USE_INSTANCING_COLOR
        vColor = instanceColor;
      #endif
      vec4 mvPosition = vec4(position, 1.0);
      vec3 nrm = normal;
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        nrm = mat3(instanceMatrix) * nrm;
      #endif
      mvPosition = modelViewMatrix * mvPosition;
      vec3 viewNormal = normalize(normalMatrix * nrm);
      float facing = abs(dot(viewNormal, normalize(-mvPosition.xyz)));
      vRim = pow(1.0 - facing, 2.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vColor;
    varying float vRim;
    void main() {
      // Kept gentler than the live scene's corona: there is no bloom pass on
      // this canvas to soften a hot limb, so a strong rim reads as a hard ring.
      gl_FragColor = vec4(vColor * (0.07 + 1.05 * vRim), 1.0);
    }
  `,
});

/** Round additive sprite for the travelling packets — drawn, not textured, so
 *  nothing has to load past the CSP. */
const pulseMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uSize: { value: 34 } },
  vertexShader: /* glsl */ `
    uniform float uSize;
    attribute vec3 pulseColor;
    attribute float pulseFade;
    varying vec3 vColor;
    varying float vFade;
    void main() {
      vColor = pulseColor;
      vFade = pulseFade;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = uSize / max(-mvPosition.z, 0.001);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vColor;
    varying float vFade;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float falloff = smoothstep(0.5, 0.0, d);
      gl_FragColor = vec4(vColor * falloff * falloff * vFade, 1.0);
    }
  `,
});

/**
 * Fat-line filaments, for the same reason the scene uses them: GL_LINES draws
 * one device pixel whatever `linewidth` says, which on a retina panel is a
 * thread next to the glossy node spheres. Width is in CSS px and stays fixed
 * across the dpr range.
 */
const lineMaterial = new LineMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.5,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  linewidth: 1.4,
  worldUnits: false,
});

const ringMaterial = new THREE.MeshBasicMaterial({
  color: '#8f9bff',
  transparent: true,
  opacity: 0.24,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

const dustMaterial = new THREE.PointsMaterial({
  color: '#9fb6ff',
  size: 0.026,
  transparent: true,
  opacity: 0.42,
  sizeAttenuation: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

function Constellation({ reduced }: { reduced: boolean }) {
  const spinRef = useRef<THREE.Group>(null);
  const dustRef = useRef<THREE.Points>(null);
  const coreShellRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);
  const pulsePosRef = useRef<THREE.BufferAttribute>(null);
  const pulseFadeRef = useRef<THREE.BufferAttribute>(null);
  const pointer = useRef({ x: 0, y: 0 });

  // Static geometry data: filament endpoints coloured by their node, and one
  // packet per edge with a staggered phase so they never march in lockstep.
  const { filaments, fatGeometry, pulsePositions, pulseColors, pulseFades, phases } =
    useMemo(() => {
      const linePos = new Float32Array(EDGES.length * 6);
      const lineCol = new Float32Array(EDGES.length * 6);
      const pulseCol = new Float32Array(EDGES.length * 3);
      for (let i = 0; i < EDGES.length; i++) {
        const [a, b] = EDGES[i];
        const from = NODES[a];
        const to = NODES[b];
        linePos.set(from.position, i * 6);
        linePos.set(to.position, i * 6 + 3);
        tmpColor.copy(from.color).multiplyScalar(EDGE_BRIGHTNESS);
        lineCol.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 6);
        tmpColor.copy(to.color).multiplyScalar(EDGE_BRIGHTNESS);
        lineCol.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 6 + 3);
        // Packets take the hue of the node they left.
        pulseCol.set([from.color.r, from.color.g, from.color.b], i * 3);
      }
      // LineSegmentsGeometry keeps these arrays by reference (no copy); the
      // segment-pair layout is exactly what setPositions/setColors expect.
      const fatGeometry = new LineSegmentsGeometry();
      fatGeometry.setPositions(linePos);
      fatGeometry.setColors(lineCol);
      const filaments = new LineSegments2(fatGeometry, lineMaterial);
      filaments.frustumCulled = false;

      return {
        filaments,
        fatGeometry,
        pulsePositions: new THREE.BufferAttribute(new Float32Array(EDGES.length * 3), 3),
        pulseColors: new THREE.BufferAttribute(pulseCol, 3),
        pulseFades: new THREE.BufferAttribute(new Float32Array(EDGES.length), 1),
        phases: Array.from({ length: EDGES.length }, (_, i) => (i * 0.618) % 1),
      };
    }, []);

  useEffect(() => () => fatGeometry.dispose(), [fatGeometry]);

  // LineMaterial converts px width to clip space against the viewport, so it
  // needs the canvas size — in CSS px, so the width survives dpr changes.
  const size = useThree((s) => s.size);
  useEffect(() => {
    lineMaterial.resolution.set(size.width, size.height);
  }, [size]);

  useLayoutEffect(() => {
    const cores = coreRef.current;
    const halos = haloRef.current;
    if (!cores || !halos) return;
    for (let i = 0; i < NODES.length; i++) {
      const node = NODES[i];
      dummy.position.set(...node.position);
      dummy.scale.setScalar(node.size);
      dummy.updateMatrix();
      cores.setMatrixAt(i, dummy.matrix);
      cores.setColorAt(i, node.color);

      dummy.scale.setScalar(node.size * HALO_SCALE);
      dummy.updateMatrix();
      halos.setMatrixAt(i, dummy.matrix);
      halos.setColorAt(i, i === 0 ? CORE_GLOW : node.color);
    }
    cores.instanceMatrix.needsUpdate = true;
    halos.instanceMatrix.needsUpdate = true;
    if (cores.instanceColor) cores.instanceColor.needsUpdate = true;
    if (halos.instanceColor) halos.instanceColor.needsUpdate = true;
  }, []);

  useEffect(() => {
    if (reduced) return;
    const onMove = (event: PointerEvent) => {
      // Parallax tracks the cursor across the whole card, not just the canvas,
      // so the graphic reacts while you are reading the copy next to it.
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [reduced]);

  useFrame((state, delta) => {
    const spin = spinRef.current;
    const dust = dustRef.current;
    const coreShell = coreShellRef.current;
    if (spin) {
      if (!reduced) spin.rotation.y += delta * 0.16;
      // Damped tilt toward the pointer; the constant keeps it a drift, not a
      // snap, and reduced-motion leaves the composed pose untouched.
      const targetX = reduced ? TILT_X : TILT_X + pointer.current.y * 0.1;
      const targetZ = reduced ? 0 : -pointer.current.x * 0.06;
      spin.rotation.x += (targetX - spin.rotation.x) * Math.min(1, delta * 2.4);
      spin.rotation.z += (targetZ - spin.rotation.z) * Math.min(1, delta * 2.4);
    }
    if (dust && !reduced) {
      dust.rotation.y -= delta * 0.025;
      dust.rotation.z += delta * 0.012;
    }
    if (coreShell && !reduced) {
      coreShell.rotation.x += delta * 0.12;
      coreShell.rotation.y -= delta * 0.18;
    }

    const positions = pulsePosRef.current;
    const fades = pulseFadeRef.current;
    if (!positions || !fades || reduced) return;
    const elapsed = state.clock.elapsedTime;
    const pos = positions.array as Float32Array;
    const fade = fades.array as Float32Array;
    for (let i = 0; i < EDGES.length; i++) {
      const [a, b] = EDGES[i];
      const from = NODES[a].position;
      const to = NODES[b].position;
      const t = (elapsed * PULSE_SPEED + phases[i]) % 1;
      pos[i * 3] = from[0] + (to[0] - from[0]) * t;
      pos[i * 3 + 1] = from[1] + (to[1] - from[1]) * t;
      pos[i * 3 + 2] = from[2] + (to[2] - from[2]) * t;
      // Fade in and out at the endpoints so packets emerge and land rather
      // than popping on top of the node spheres.
      fade[i] = Math.sin(Math.PI * t);
    }
    positions.needsUpdate = true;
    fades.needsUpdate = true;
  });

  return (
    <>
      <points ref={dustRef} rotation={[0.18, 0, -0.08]}>
        <bufferGeometry>
          <primitive object={dustPositions} attach="attributes-position" />
        </bufferGeometry>
        <primitive object={dustMaterial} attach="material" />
      </points>

      <group ref={spinRef} rotation={[TILT_X, 0, 0]}>
      {/* Lit, not unlit: a flat fill reads as a sticker at this size. A single
          key from the upper-left puts the specular hotspot in the same
          screen-relative spot on every sphere — the trick the live scene uses
          to make nodes read as marbles rather than discs. */}
      <ambientLight intensity={0.5} />
      <hemisphereLight color="#c3cdff" groundColor="#1b1140" intensity={0.5} />
      <directionalLight position={[-4, 5, 6]} intensity={2.4} color="#e4dfff" />
      <pointLight position={[4, -2.5, 3]} intensity={1.4} color="#7fa8ff" />

      <instancedMesh ref={coreRef} args={[undefined, undefined, NODES.length]}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshStandardMaterial roughness={0.28} metalness={0.15} />
      </instancedMesh>

      <instancedMesh ref={haloRef} args={[undefined, undefined, NODES.length]}>
        <sphereGeometry args={[1, 20, 14]} />
        <primitive object={haloMaterial} attach="material" />
      </instancedMesh>

      <primitive object={filaments} />

      {/* Faceted shell around the core: gives the brightest object some
          internal structure so it reads as a lit hub rather than a white dot. */}
      <mesh ref={coreShellRef} position={NODES[0].position} scale={NODES[0].size * 1.95}>
        {/* Detail 0 on purpose: subdividing puts more wireframe edges inside a
            ~25px circle than can resolve, and it turns to scribble. */}
        <icosahedronGeometry args={[1, 0]} />
        <meshBasicMaterial
          color="#b9aaff"
          wireframe
          transparent
          opacity={0.34}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      <mesh position={NODES[0].position} scale={NODES[0].size * 2.8}>
        <sphereGeometry args={[1, 24, 18]} />
        <meshBasicMaterial
          color="#8b7cff"
          transparent
          opacity={0.045}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      <points>
        <bufferGeometry>
          <primitive ref={pulsePosRef} object={pulsePositions} attach="attributes-position" />
          <primitive object={pulseColors} attach="attributes-pulseColor" />
          <primitive ref={pulseFadeRef} object={pulseFades} attach="attributes-pulseFade" />
        </bufferGeometry>
        <primitive object={pulseMaterial} attach="material" />
      </points>

      {/* Orbit rings echo the flat mark, so the fallback and the 3D hero read
          as the same drawing. Both lie in the spin plane: a ring tilted out of
          it swings edge-on twice a turn and flashes as a hard line across the
          composition, whereas these are rotationally symmetric about the spin
          axis and hold one steady ellipse — a fixed frame for the moving graph. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[3.05, 0.008, 6, 96]} />
        <primitive object={ringMaterial} attach="material" />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.5, 0.006, 6, 96]} />
        <primitive object={ringMaterial} attach="material" />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0.38]}>
        <torusGeometry args={[3.55, 0.005, 6, 112]} />
        <primitive object={ringMaterial} attach="material" />
      </mesh>
      </group>
    </>
  );
}

function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function HeroConstellation() {
  const reduced = prefersReducedMotion();
  const [hidden, setHidden] = useState(false);
  // Probe once: a failed context is a permanent property of the browser, and
  // re-probing would leak a throwaway context on every render.
  const [webgl] = useState(supportsWebGL);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (!webgl) return <ConstellationSvg />;

  return (
    <Canvas
      className="empty-state__hero-canvas"
      aria-hidden="true"
      camera={{ fov: 36, near: 0.1, far: 40, position: [0, 0, 8.8] }}
      // Capped below the scene's ceiling: this is a ~330px decorative canvas
      // sharing the GPU with the nebula behind the card.
      dpr={[1, 1.75]}
      frameloop={reduced || hidden ? 'demand' : 'always'}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.24;
      }}
    >
      <Constellation reduced={reduced} />
    </Canvas>
  );
}
