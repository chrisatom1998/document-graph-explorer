/**
 * 2D map backdrop (dims === 2): a LINELESS radial depth gradient.
 *
 * Earlier revisions drew a grid and concentric rings here. Both were removed on
 * purpose: straight backdrop lines read as edges and backdrop circles read as
 * node rings, so users tried to interpret them as graph data. Backdrop geometry
 * must never be mistakable for the graph — the depth cue comes from tone alone.
 *
 * OCCLUSION CONTRACT (this backdrop covers the whole viewport, so getting it
 * wrong hides the entire graph — it did once, when the material was
 * `transparent: true` + `depthTest: false`: three renders the transparent list
 * AFTER the opaque one, so it painted over every node and `renderOrder` could
 * not save it). Two independent guarantees, either of which suffices:
 *   1. OPAQUE — the shader outputs alpha 1, so the material stays in the opaque
 *      list where BACKDROP_RENDER_ORDER sorts it first.
 *   2. DEPTH-TESTED and genuinely behind — default depthTest/depthWrite with the
 *      plane at BACKDROP_Z, far behind the z=0 layout plane.
 * flatMapBackdrop.test.ts locks both.
 */

import * as THREE from 'three';
import { FLAT_BG, FLAT_GRID_FADE } from './palette';

/** 2D layout sits at z=0 and nodes reach ~1.75 world units of radius. */
export const BACKDROP_Z = -40;
/** Below every other scene object's default 0, so it draws first. */
export const BACKDROP_RENDER_ORDER = -11;
/** Generous enough to cover the viewport at typical 2D camera distances. */
export const BACKDROP_SIZE = 1400;

export const flatBackdropMaterial = new THREE.ShaderMaterial({
  transparent: false,
  toneMapped: false,
  uniforms: {
    uInner: { value: new THREE.Color(FLAT_GRID_FADE) },
    uOuter: { value: new THREE.Color(FLAT_BG) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uInner;
    uniform vec3 uOuter;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv - 0.5;
      float d = length(p * vec2(0.92, 1.08)) * 2.0;
      float verticalLift = smoothstep(-0.34, 0.72, vUv.y);
      float glow = exp(-7.2 * dot(p, p));
      // Still lineless, but with a slightly more authored composition: a soft
      // editorial lift toward the upper viewport and a quiet center glow.
      vec3 base = mix(uInner, uOuter, smoothstep(0.02, 1.04, d));
      vec3 lifted = mix(base, uInner, 0.12 * verticalLift + 0.2 * glow);
      gl_FragColor = vec4(lifted, 1.0);
    }
  `,
});
