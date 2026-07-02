/**
 * Sparse background starfield (spec §7.1): points on a far shell with a
 * slight blue/violet tint variance, plus a near "nebula dust" cloud filling
 * the graph volume so the space between nodes reads as luminous gas rather
 * than empty black. Entirely static — geometry is built once and there is
 * zero per-frame work.
 *
 * PointsMaterial has a single `size`, so the 1–2.4 size range is approximated
 * with two static layers (small/large) instead of a custom shader.
 */

import { useMemo } from 'react';
import * as THREE from 'three';

const STAR_COUNT = 3200;
const SHELL_MIN = 480;
const SHELL_MAX = 950;

const TINTS = [
  new THREE.Color('#9db4ff'),
  new THREE.Color('#c9b8ff'),
  new THREE.Color('#ffffff'),
];

// Near dust that lives in/around the node volume (the layout shell sits at
// ~60–120u). Warmer, more colorful tints than the far stars so the graph
// interior glows faintly like nebula gas.
// Keep the dust shell INSIDE the fit-all camera distance (~130u for the demo)
// so no dust particle ever sits between the camera and the near plane, where
// size-attenuation would balloon it into a giant foreground blob.
const DUST_COUNT = 1300;
const DUST_MIN = 18;
const DUST_MAX = 100;
const DUST_TINTS = [
  new THREE.Color('#ff7bd0'),
  new THREE.Color('#8f7bff'),
  new THREE.Color('#7fb4ff'),
  new THREE.Color('#7ee8c4'),
  new THREE.Color('#ffc36b'),
];

function buildDust(count: number): StarLayer {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // fill the ball (r^(1/3)) so dust is denser toward the core, not a shell
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = DUST_MIN + (DUST_MAX - DUST_MIN) * Math.cbrt(Math.random());
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    positions[i * 3] = r * s * Math.cos(theta);
    positions[i * 3 + 1] = r * u;
    positions[i * 3 + 2] = r * s * Math.sin(theta);

    tmp.copy(DUST_TINTS[Math.floor(Math.random() * DUST_TINTS.length)]);
    tmp.lerp(TINTS[2], Math.random() * 0.35); // nudge some toward white
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  return { positions, colors };
}

interface StarLayer {
  positions: Float32Array;
  colors: Float32Array;
}

/** Soft round sprite so points render as glowing specks, not hard squares. */
function makeSoftSprite(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function buildLayer(count: number): StarLayer {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // uniform direction on the sphere, radius spread across the shell
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = SHELL_MIN + Math.random() * (SHELL_MAX - SHELL_MIN);
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    positions[i * 3] = r * s * Math.cos(theta);
    positions[i * 3 + 1] = r * u;
    positions[i * 3 + 2] = r * s * Math.sin(theta);

    // pick a tint and nudge it toward white for variance
    tmp.copy(TINTS[Math.floor(Math.random() * TINTS.length)]);
    tmp.lerp(TINTS[2], Math.random() * 0.5);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  return { positions, colors };
}

export default function Starfield() {
  const { small, large, dust, sprite } = useMemo(
    () => ({
      small: buildLayer(Math.floor(STAR_COUNT * 0.7)),
      large: buildLayer(Math.ceil(STAR_COUNT * 0.3)),
      dust: buildDust(DUST_COUNT),
      sprite: makeSoftSprite(),
    }),
    [],
  );

  return (
    <group>
      {/* near nebula dust in the graph volume */}
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dust.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[dust.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={sprite}
          size={1.7}
          sizeAttenuation
          transparent
          opacity={0.45}
          vertexColors
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </points>
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[small.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[small.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={sprite}
          size={1.6}
          sizeAttenuation
          transparent
          opacity={0.55}
          vertexColors
          depthWrite={false}
          toneMapped={false}
        />
      </points>
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[large.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[large.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={sprite}
          size={3.2}
          sizeAttenuation
          transparent
          opacity={0.55}
          vertexColors
          depthWrite={false}
          toneMapped={false}
        />
      </points>
    </group>
  );
}
