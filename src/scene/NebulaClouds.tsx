/**
 * Volumetric-look nebula clouds (realism pass 2026-07-04): large, soft fbm
 * puff sprites that give the nebula the cloud *structure* real ones have —
 * the dust points supply fine grain, these supply the wisps and the
 * large-scale backdrop.
 *
 * - Interior wisps float in the graph volume (denser toward the core, same
 *   distribution as the dust and inside the same fit-all camera bound).
 * - Backdrop clouds sit on a far shell behind the whole graph, in front of
 *   the star shell — additive blending, so stars still read through them.
 * - Tints are astronomical (reflection-nebula blue, H-alpha pink/magenta, a
 *   hint of OIII teal) and stay in the app's violet/blue identity.
 * - Everything is static and order-independent (additive): built once, no
 *   per-frame work, no sorting. Brightness is authored below the bloom
 *   threshold so clouds glow but never bloom-wash the graph.
 * - Pure fill-rate cost, so the group hides at qualityTier >= 3, joining the
 *   existing tier-3 degradations (label cap, pulses off).
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { useUiStore } from '../store/uiStore';
import { makeCloudTexture } from './proceduralTextures';

const NO_RAYCAST = (): void => {
  /* decoration — must never intercept node picking */
};

// weighted toward blue/violet so the pink reads as accent, not bubblegum
const CLOUD_TINTS: ReadonlyArray<readonly [string, number]> = [
  ['#5f7fdf', 0.3], // reflection blue
  ['#7d6bdf', 0.28], // violet
  ['#c95f9e', 0.22], // H-alpha magenta
  ['#df6b8a', 0.12], // H-alpha pink
  ['#4fae9e', 0.08], // OIII teal
];

function pickTint(): string {
  let r = Math.random();
  for (const [hex, w] of CLOUD_TINTS) {
    if (r < w) return hex;
    r -= w;
  }
  return CLOUD_TINTS[0][0];
}

const WISP_COUNT = 18;
const WISP_MIN_R = 20;
const WISP_MAX_R = 95; // inside the fit-all camera distance, like the dust

const BACKDROP_COUNT = 8;
const BACKDROP_MIN_R = 460;
const BACKDROP_MAX_R = 560; // behind the graph, in front of the star shell

interface CloudSpec {
  position: [number, number, number];
  scale: number;
  material: THREE.SpriteMaterial;
}

function buildClouds(
  textures: THREE.Texture[],
  count: number,
  minR: number,
  maxR: number,
  minScale: number,
  maxScale: number,
  minOpacity: number,
  maxOpacity: number,
  fillBall: boolean,
): CloudSpec[] {
  const specs: CloudSpec[] = [];
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const radial = fillBall ? Math.cbrt(Math.random()) : Math.random();
    const r = minR + (maxR - minR) * radial;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    specs.push({
      position: [r * s * Math.cos(theta), r * u, r * s * Math.sin(theta)],
      scale: minScale + Math.random() * (maxScale - minScale),
      material: new THREE.SpriteMaterial({
        map: textures[i % textures.length],
        color: new THREE.Color(pickTint()),
        opacity: minOpacity + Math.random() * (maxOpacity - minOpacity),
        rotation: Math.random() * Math.PI * 2,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    });
  }
  return specs;
}

export default function NebulaClouds() {
  // hidden (not unmounted) on degraded tiers so recovery doesn't rebuild
  const visible = useUiStore((s) => s.qualityTier < 3);

  const clouds = useMemo(() => {
    const textures = [makeCloudTexture(11), makeCloudTexture(23), makeCloudTexture(47)];
    return [
      ...buildClouds(textures, WISP_COUNT, WISP_MIN_R, WISP_MAX_R, 25, 70, 0.05, 0.12, true),
      ...buildClouds(
        textures,
        BACKDROP_COUNT,
        BACKDROP_MIN_R,
        BACKDROP_MAX_R,
        260,
        440,
        0.03,
        0.07,
        false,
      ),
    ];
  }, []);

  return (
    <group visible={visible}>
      {clouds.map((cloud, i) => (
        <sprite
          key={i}
          position={cloud.position}
          scale={[cloud.scale, cloud.scale, 1]}
          raycast={NO_RAYCAST}
          frustumCulled={false}
        >
          <primitive object={cloud.material} attach="material" />
        </sprite>
      ))}
    </group>
  );
}
