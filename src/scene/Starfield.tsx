/**
 * Photographic background starfield (spec §7.1, realism pass 2026-07-04):
 * one points draw of blackbody-colored stars on a far shell — per-star size
 * and brightness follow a dim-heavy power law (thousands of faint specks, a
 * handful of bright ones) the way a long exposure actually looks — plus a few
 * "hero" stars with diffraction-spike sprites, and the near "nebula dust"
 * cloud filling the graph volume. Entirely static — all geometry is built
 * once and there is zero per-frame work (the size uniform updates only on
 * canvas resize).
 *
 * PointsMaterial has a single `size`, so per-star sizes come from a small
 * ShaderMaterial with an aSize attribute; it reuses three's fog chunks so the
 * far shell keeps the same fogExp2 depth falloff the old material had.
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useUiStore } from '../store/uiStore';
import {
  blackbodyColor,
  sampleStarBrightness,
  sampleStarTemperature,
} from './starColors';
import { makeSoftSprite, makeStarSprite } from './proceduralTextures';

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

// Near dust that lives in/around the node volume (the layout shell sits at
// ~60–120u). Warmer, more colorful tints than the far stars so the graph
// interior glows faintly like nebula gas. NebulaClouds supplies the
// large-scale structure; this is the fine grain.
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
const WHITE = new THREE.Color('#ffffff');

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

export default function Starfield() {
  // Flat (2D ambient) mode wants a calm, faint backdrop — dim the star field
  // and mute the colorful nebula dust so it doesn't compete with the
  // constellation of nodes.
  const flat = useUiStore((s) => s.dims === 2);

  const { stars, heroes, dust, fieldMaterial, heroMaterial, softSprite } = useMemo(() => {
    const softSprite = makeSoftSprite();
    return {
      stars: buildStars(STAR_COUNT),
      heroes: buildHeroes(),
      dust: buildDust(DUST_COUNT),
      fieldMaterial: makeStarMaterial(softSprite),
      heroMaterial: makeStarMaterial(makeStarSprite()),
      softSprite,
    };
  }, []);

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
    fieldMaterial.uniforms.uDim.value = flat ? 0.55 : 1;
    heroMaterial.uniforms.uDim.value = flat ? 0.2 : 1; // diffraction spikes read as "3D photo"
  }, [flat, fieldMaterial, heroMaterial]);

  return (
    <group>
      {/* near nebula dust in the graph volume */}
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dust.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[dust.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={softSprite}
          size={1.7}
          sizeAttenuation
          transparent
          opacity={flat ? 0.12 : 0.38}
          vertexColors
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </points>

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

function buildDust(count: number): { positions: Float32Array; colors: Float32Array } {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // fill the ball (r^(1/3)) so dust is denser toward the core, not a shell
    const r = DUST_MIN + (DUST_MAX - DUST_MIN) * Math.cbrt(Math.random());
    shellPoint(positions, i, r);
    tmp.copy(DUST_TINTS[Math.floor(Math.random() * DUST_TINTS.length)]);
    tmp.lerp(WHITE, Math.random() * 0.35); // nudge some toward white
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  return { positions, colors };
}
