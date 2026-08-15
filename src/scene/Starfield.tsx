/**
 * Photographic background starfield (spec §7.1, realism pass 2026-07-04):
 * one points draw of blackbody-colored stars on a far shell — per-star size
 * and brightness follow a dim-heavy power law (thousands of faint specks, a
 * handful of bright ones) the way a long exposure actually looks — plus a few
 * "hero" stars with diffraction-spike sprites. Entirely static — all geometry
 * is built once and there is zero per-frame work (the size uniform updates
 * only on canvas resize).
 *
 * PointsMaterial has a single `size`, so per-star sizes come from a small
 * ShaderMaterial with an aSize attribute; it reuses three's fog chunks so the
 * far shell keeps the same fogExp2 depth falloff the old material had.
 */

import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useGraphStore } from '../store/graphStore';
import {
  blackbodyColor,
  sampleStarBrightness,
  sampleStarTemperature,
} from './starColors';
import { makeSoftSprite, makeStarSprite } from './proceduralTextures';
import { VISUAL_DENSITY_SOFTEN_FULL, VISUAL_DENSITY_SOFTEN_START } from '../config';

const STAR_COUNT = 4200;
// Must stay OUTSIDE the layout's node shell (layout.worker.ts grows it as
// 11·√n, so ~700u at the 4096-node cap) — the nebula must never poke through
// its own backdrop.
const SHELL_MIN = 600;
const SHELL_MAX = 1150;

// Bright foreground stars with diffraction spikes. Kept to a handful — in a
// photograph only the brightest few stars flare.
const HERO_COUNT = 14;
const HERO_SHELL_MIN = 600;
const HERO_SHELL_MAX = 850;

interface StarBuffers {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
}

/** Uniform direction on the sphere at radius r, written into arr at slot i. */
function shellPoint(arr: Float32Array, i: number, r: number): void {
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  arr[i * 3] = r * s * Math.cos(theta);
  arr[i * 3 + 1] = r * u;
  arr[i * 3 + 2] = r * s * Math.sin(theta);
}

function buildStars(count: number): StarBuffers {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    shellPoint(positions, i, SHELL_MIN + Math.random() * (SHELL_MAX - SHELL_MIN));
    const [r, g, b] = blackbodyColor(sampleStarTemperature(Math.random));
    const bright = sampleStarBrightness(Math.random);
    // brightness shows up in both luminance and disc size, like a photo
    const lum = 0.25 + 0.75 * bright;
    colors[i * 3] = r * lum;
    colors[i * 3 + 1] = g * lum;
    colors[i * 3 + 2] = b * lum;
    sizes[i] = 1.1 + 3.7 * Math.pow(bright, 1.2);
  }
  return { positions, colors, sizes };
}

// Hand-picked hero temperatures: a couple of blue giants, solar whites, and
// warm orange/red giants, so the flares show the full blackbody range.
const HERO_TEMPS = [
  22000, 15000, 11000, 9500, 8200, 7200, 6600, 6100, 5500, 4900, 4300, 3800, 3300, 2900,
];

function buildHeroes(): StarBuffers {
  const count = HERO_COUNT;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    shellPoint(
      positions,
      i,
      HERO_SHELL_MIN + Math.random() * (HERO_SHELL_MAX - HERO_SHELL_MIN),
    );
    const [r, g, b] = blackbodyColor(HERO_TEMPS[i % HERO_TEMPS.length]);
    // overbright: heroes are meant to cross the bloom threshold and bleed
    const lum = 1.05 + 0.35 * Math.random();
    colors[i * 3] = r * lum;
    colors[i * 3 + 1] = g * lum;
    colors[i * 3 + 2] = b * lum;
    sizes[i] = 26 + 30 * Math.random();
  }
  return { positions, colors, sizes };
}

/**
 * Points material with a per-vertex size attribute. Additive — stars are
 * emitters — with the standard fog chunks so the far shell keeps its depth
 * falloff. uScale mirrors PointsMaterial's size-attenuation factor (half the
 * drawing-buffer height), set from the resize effect below.
 */
function makeStarMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      // uDim: global brightness multiplier so flat (2D ambient) mode can
      // calm the field down to a faint backdrop without rebuilding buffers.
      { uMap: { value: null }, uScale: { value: 540 }, uDim: { value: 1 } },
    ]),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
    vertexShader: /* glsl */ `
      uniform float uScale;
      attribute float aSize;
      varying vec3 vColor;
      #include <fog_pars_vertex>
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (uScale / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uDim;
      varying vec3 vColor;
      #include <fog_pars_fragment>
      void main() {
        float alpha = texture2D(uMap, gl_PointCoord).a;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(vColor * uDim, alpha);
        #include <fog_fragment>
      }
    `,
  });
  material.uniforms.uMap.value = map; // after merge — merge deep-clones values
  return material;
}

/**
 * Built once for the lifetime of the tab, not per mount.
 *
 * NebulaCanvas unmounts this component in 2D mode, and these materials and
 * canvas textures are attached via `<primitive>`/props, which R3F does not
 * dispose — so a per-mount build leaked two shader programs and two textures on
 * every 2D/3D toggle. Sharing them also stops the sky re-randomizing each time.
 * Lazily built so importing this module never touches `document`.
 */
let starfieldAssets: {
  stars: ReturnType<typeof buildStars>;
  heroes: ReturnType<typeof buildHeroes>;
  fieldMaterial: ReturnType<typeof makeStarMaterial>;
  heroMaterial: ReturnType<typeof makeStarMaterial>;
} | null = null;

function getStarfieldAssets(): NonNullable<typeof starfieldAssets> {
  if (!starfieldAssets) {
    const softSprite = makeSoftSprite();
    starfieldAssets = {
      stars: buildStars(STAR_COUNT),
      heroes: buildHeroes(),
      fieldMaterial: makeStarMaterial(softSprite),
      heroMaterial: makeStarMaterial(makeStarSprite()),
    };
  }
  return starfieldAssets;
}

export default function Starfield() {
  const nodeCount = useGraphStore((s) => s.nodes.length);

  const { stars, heroes, fieldMaterial, heroMaterial } = getStarfieldAssets();
  const densitySoftening = Math.min(
    1,
    Math.max(0, (nodeCount - VISUAL_DENSITY_SOFTEN_START) /
      (VISUAL_DENSITY_SOFTEN_FULL - VISUAL_DENSITY_SOFTEN_START)),
  );
  // Keep uScale matched to the drawing buffer (device px) so star discs stay
  // the same physical size across resizes and DPR changes.
  const height = useThree((s) => s.size.height);
  const dpr = useThree((s) => s.viewport.dpr);
  useEffect(() => {
    const scale = (height * dpr) / 2;
    fieldMaterial.uniforms.uScale.value = scale;
    heroMaterial.uniforms.uScale.value = scale;
  }, [height, dpr, fieldMaterial, heroMaterial]);

  useEffect(() => {
    fieldMaterial.uniforms.uDim.value = 0.9 - densitySoftening * 0.18;
    heroMaterial.uniforms.uDim.value = 0.9 - densitySoftening * 0.14;
  }, [densitySoftening, fieldMaterial, heroMaterial]);

  return (
    <group>
      {/* main field: blackbody colors, power-law sizes, one draw call */}
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[stars.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[stars.colors, 3]} />
          <bufferAttribute attach="attributes-aSize" args={[stars.sizes, 1]} />
        </bufferGeometry>
        <primitive object={fieldMaterial} attach="material" />
      </points>

      {/* hero stars: diffraction-spike sprites, overbright to feed bloom */}
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[heroes.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[heroes.colors, 3]} />
          <bufferAttribute attach="attributes-aSize" args={[heroes.sizes, 1]} />
        </bufferGeometry>
        <primitive object={heroMaterial} attach="material" />
      </points>
    </group>
  );
}
