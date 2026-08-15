/**
 * Root 3D canvas — the deep-space observatory (spec §7.1).
 *
 * No preserveDrawingBuffer: keeping the backbuffer alive after every swap is
 * a per-frame tax (worst on tiled GPUs). "Export PNG" instead goes through
 * sceneCapture.ts — SceneCapture below renders one frame synchronously right
 * before the pixels are read. Canvas antialias is OFF on purpose: the
 * EffectComposer renders the scene into its own framebuffer, so context MSAA
 * would only smooth the final fullscreen blit — geometry AA lives on the
 * composer's multisampling (Effects.tsx). dpr starts capped at 2 (retina
 * won't melt the bloom pass); AutoQuality owns dpr at runtime.
 *
 * Lighting: the node cores are lit (glossy physical material) so they read
 * as 3D marbles with a specular hotspot. A single strong key light from the upper-left puts
 * that highlight in the same screen-relative spot on every sphere; a dim cool
 * fill keeps shadowed sides from going black. The halo/edge/starfield
 * materials stay unlit (basic/additive) and ignore these lights entirely.
 */

import { useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { useUiStore } from '../store/uiStore';
import { dismissGraphFocus } from './cameraFocusPolicy';
import { registerSceneCapture } from './sceneCapture';
import { FLAT_BG, VOID } from './palette';
import {
  BACKDROP_RENDER_ORDER,
  BACKDROP_SIZE,
  BACKDROP_Z,
  flatBackdropMaterial,
} from './flatMapBackdrop';
import CameraRig from './CameraRig';
import Starfield from './Starfield';
import NebulaClouds from './NebulaClouds';
import ClusterAtmosphere from './ClusterAtmosphere';
import AiCore from './AiCore';
import FocusLight from './FocusLight';
import Nodes from './Nodes';
import Edges from './Edges';
import ClusterBridges from './ClusterBridges';
import EdgePulses from './EdgePulses';
import Labels from './Labels';
import Effects from './Effects';
import AutoQuality from './AutoQuality';
import ClusterCollapse from './ClusterCollapse';
import SelectionHalo from './SelectionHalo';
import PeerPresence from './PeerPresence';
import PathRoute from './PathRoute';

const COARSE_POINTER =
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
// Initial value only — AutoQuality owns dpr at runtime (quality ladder).
// Module-level so the prop identity is stable and Canvas re-renders never
// clobber the ladder's setDpr.
const INITIAL_DPR: number | [number, number] = COARSE_POINTER ? 1 : [1, 2];

/** Registers the Export-PNG capture hook: render a frame now, hand back the canvas. */
function SceneCapture() {
  const gl = useThree((s) => s.gl);
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    registerSceneCapture(() => {
      advance(performance.now(), true);
      return gl.domElement;
    });
    return () => registerSceneCapture(null);
  }, [gl, advance]);
  return null;
}

function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    // Release the probe: browsers cap live contexts per page and evict the
    // OLDEST once over the cap — which would be the scene canvas itself,
    // showing up as the graph blanking out and coming back.
    ctx?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(ctx);
  } catch {
    return false;
  }
}

/* Fully local reflection environment (the CSP forbids the HDR presets' CDN);
   the sheets echo the scene lights so reflections agree with the shading.
   Module-level: drei's Environment re-bakes (and briefly clears
   scene.environment) whenever its children identity changes, and inline JSX
   would hand it a fresh tree on every NebulaCanvas render. */
const ENVIRONMENT_SHEETS = (
  <>
    <Lightformer
      form="rect"
      intensity={4}
      color="#b9a8ff"
      position={[-6, 8, 10]}
      scale={[8, 6, 1]}
      target={[0, 0, 0]}
    />
    <Lightformer
      form="rect"
      intensity={2}
      color="#7fa8ff"
      position={[8, -3, 6]}
      scale={[6, 4, 1]}
      target={[0, 0, 0]}
    />
    <Lightformer
      form="rect"
      intensity={1.2}
      color="#ff9bd6"
      position={[0, -8, -6]}
      scale={[10, 4, 1]}
      target={[0, 0, 0]}
    />
  </>
);

// The 2D backdrop's material/placement constants (and the occlusion contract
// that keeps it from hiding the graph) live in ./flatMapBackdrop.
function FlatMapBackdrop() {
  return (
    <mesh
      position={[0, 0, BACKDROP_Z]}
      renderOrder={BACKDROP_RENDER_ORDER}
      frustumCulled={false}
    >
      <planeGeometry args={[BACKDROP_SIZE, BACKDROP_SIZE]} />
      <primitive object={flatBackdropMaterial} attach="material" />
    </mesh>
  );
}

function WebGLFallback() {
  return (
    <section className="webgl-fallback" role="status" aria-live="polite">
      <span className="webgl-fallback__mark" aria-hidden="true">✦</span>
      <h1>Interactive graph unavailable</h1>
      <p>
        This browser or graphics setting cannot start WebGL. Your local files stay private;
        try enabling hardware acceleration or opening this workspace in a supported browser.
      </p>
    </section>
  );
}

export default function NebulaCanvas() {
  // 2D constellation mode: flat ink background, no starfield/clouds/core —
  // the graph reads as a star chart, not a nebula (see palette FLAT_* tokens).
  const flat = useUiStore((s) => s.dims === 2);
  const bg = flat ? FLAT_BG : VOID;
  // Probe once — a failed context is a permanent property of the browser,
  // and probing in the render body would create a context per render.
  const [webgl] = useState(supportsWebGL);

  if (!webgl) return <WebGLFallback />;

  return (
    <Canvas
      className="nebula-canvas"
      role="application"
      tabIndex={-1}
      aria-label="Interactive document graph. Drag to orbit, use toolbar buttons for search, filtering, path finding and view controls."
      style={{ position: 'fixed', inset: 0 }}
      dpr={INITIAL_DPR}
      camera={{ fov: 55, near: 0.1, far: 4000, position: [0, 0, 160] }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.08;
      }}
      onPointerMissed={() => {
        // Clicking empty space dismisses the open panel and any in-flight
        // camera-then-panel focus so a later arrival cannot reopen it.
        dismissGraphFocus();
      }}
    >
      <color attach="background" args={[bg]} />
      {/* density tracks the layout shell radius — the wider spacing would
          otherwise fog out the nebula's far side */}
      <fogExp2 attach="fog" args={[bg, 0.001]} />
      {flat ? <FlatMapBackdrop /> : null}
      {/* base fill so shadowed sides keep their hue */}
      <ambientLight intensity={0.38} />
      <hemisphereLight color="#b7c9ff" groundColor="#130a2c" intensity={0.34} />
      {/* key light (upper-left): drives the glossy specular highlight */}
      <directionalLight position={[-70, 95, 130]} intensity={2.1} />
      {/* cool rim/fill from the opposite side for a little depth */}
      <pointLight position={[60, -40, 40]} intensity={0.62} color="#7fa8ff" distance={0} />

      {/* procedural reflection environment for the glassy node cores — three
          soft Lightformer sheets rendered once to a PMREM at startup. */}
      <Environment resolution={64} frames={1}>{ENVIRONMENT_SHEETS}</Environment>

      <SceneCapture />
      <CameraRig />
      {!flat && <Starfield />}
      {!flat && <NebulaClouds />}
      {!flat && <ClusterAtmosphere />}
      {!flat && <AiCore />}
      <FocusLight />
      <Nodes />
      <Edges />
      {/* 3D only: the 2D star chart keeps its delicate hairline aesthetic */}
      {!flat && <ClusterBridges />}
      <EdgePulses />
      <PathRoute />
      <Labels />
      <SelectionHalo />
      <PeerPresence />
      <ClusterCollapse />
      <Effects />
      <AutoQuality />
    </Canvas>
  );
}
