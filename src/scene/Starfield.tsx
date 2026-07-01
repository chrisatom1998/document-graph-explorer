/**
 * Sparse background starfield (spec §7.1): points on a far shell with a
 * slight blue/violet tint variance. Entirely static — geometry is built once
 * and there is zero per-frame work.
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

interface StarLayer {
  positions: Float32Array;
  colors: Float32Array;
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
  const { small, large } = useMemo(
    () => ({
      small: buildLayer(Math.floor(STAR_COUNT * 0.7)),
      large: buildLayer(Math.ceil(STAR_COUNT * 0.3)),
    }),
    [],
  );

  return (
    <group>
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[small.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[small.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={1.1}
          sizeAttenuation
          transparent
          opacity={0.5}
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
          size={2.2}
          sizeAttenuation
          transparent
          opacity={0.5}
          vertexColors
          depthWrite={false}
          toneMapped={false}
        />
      </points>
    </group>
  );
}
