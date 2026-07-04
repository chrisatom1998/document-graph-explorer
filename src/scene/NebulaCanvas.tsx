/**
 * Root 3D canvas — the deep-space observatory (spec §7.1).
 *
 * preserveDrawingBuffer is REQUIRED: the toolbar's "Export PNG" reads the
 * canvas back after the frame. dpr caps at 2 so retina displays don't melt
 * the bloom pass.
 *
 * Lighting: the node cores are lit (glossy physical material) so they read
 * as 3D marbles with a specular hotspot. A single strong key light from the upper-left puts
 * that highlight in the same screen-relative spot on every sphere; a dim cool
 * fill keeps shadowed sides from going black. The halo/edge/starfield
 * materials stay unlit (basic/additive) and ignore these lights entirely.
 */

import { Canvas } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { useUiStore } from '../store/uiStore';
import CameraRig from './CameraRig';
import Starfield from './Starfield';
import NebulaClouds from './NebulaClouds';
import AiCore from './AiCore';
import Nodes from './Nodes';
import Edges from './Edges';
import EdgePulses from './EdgePulses';
import Labels from './Labels';
import Effects from './Effects';
import AutoQuality from './AutoQuality';
import ClusterCollapse from './ClusterCollapse';
import SelectionHalo from './SelectionHalo';

export default function NebulaCanvas() {
  return (
    <Canvas
      className="nebula-canvas"
      style={{ position: 'fixed', inset: 0 }}
      dpr={[1, 2]}
      camera={{ fov: 55, near: 0.1, far: 4000, position: [0, 0, 160] }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onPointerMissed={() => {
        // Clicking empty space dismisses whatever is selected, mirroring the
        // Escape-key ladder in App.tsx (edge popover first, then node panel).
        const ui = useUiStore.getState();
        if (ui.selectedEdgeId) ui.setSelectedEdge(null);
        else if (ui.selectedId) ui.setSelected(null);
      }}
    >
      <color attach="background" args={['#050510']} />
      {/* density tracks the layout shell radius — the wider spacing would
          otherwise fog out the nebula's far side */}
      <fogExp2 attach="fog" args={['#050510', 0.001]} />
      {/* base fill so shadowed sides keep their hue */}
      <ambientLight intensity={0.55} />
      {/* key light (upper-left): drives the glossy specular highlight */}
      <directionalLight position={[-70, 95, 130]} intensity={1.8} />
      {/* cool rim/fill from the opposite side for a little depth */}
      <pointLight position={[60, -40, 40]} intensity={0.45} color="#7fa8ff" distance={0} />

      {/* procedural reflection environment for the glassy node cores — three
          soft Lightformer sheets rendered once to a PMREM at startup. Fully
          local: the CSP forbids the HDR presets' CDN, and the sheets echo the
          scene lights (violet key upper-left, cool blue fill, faint warm
          floor) so reflections agree with the shading. */}
      <Environment resolution={64} frames={1}>
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
      </Environment>

      <CameraRig />
      <Starfield />
      <NebulaClouds />
      <AiCore />
      <Nodes />
      <Edges />
      <EdgePulses />
      <Labels />
      <SelectionHalo />
      <ClusterCollapse />
      <Effects />
      <AutoQuality />
    </Canvas>
  );
}
