/**
 * Root 3D canvas — the deep-space observatory (spec §7.1).
 *
 * preserveDrawingBuffer is REQUIRED: the toolbar's "Export PNG" reads the
 * canvas back after the frame. dpr caps at 2 so retina displays don't melt
 * the bloom pass. Lights are intentionally faint — every nebula material is
 * a basic (unlit) material, so these only matter if a lit material ever
 * joins the scene.
 */

import { Canvas } from '@react-three/fiber';
import CameraRig from './CameraRig';
import Starfield from './Starfield';
import Nodes from './Nodes';
import Edges from './Edges';
import EdgePulses from './EdgePulses';
import Labels from './Labels';
import Effects from './Effects';
import AutoQuality from './AutoQuality';

export default function NebulaCanvas() {
  return (
    <Canvas
      className="nebula-canvas"
      style={{ position: 'fixed', inset: 0 }}
      dpr={[1, 2]}
      camera={{ fov: 55, near: 0.1, far: 4000, position: [0, 0, 160] }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={['#050510']} />
      <fogExp2 attach="fog" args={['#050510', 0.0012]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[80, 120, 60]} intensity={0.4} />

      <CameraRig />
      <Starfield />
      <Nodes />
      <Edges />
      <EdgePulses />
      <Labels />
      <Effects />
      <AutoQuality />
    </Canvas>
  );
}
