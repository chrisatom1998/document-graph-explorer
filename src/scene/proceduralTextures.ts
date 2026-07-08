/**
 * Procedural canvas textures for the scene. Everything visual in the nebula
 * is generated locally — the production CSP forbids fetching image assets
 * from anywhere but same-origin, so there are no texture files to load.
 *
 * All generators run once at startup (memoized by their callers); none of
 * these are per-frame costs. DOM canvas is required, so this module has no
 * unit tests (the suite runs in Node) — the pure math lives in starColors.ts.
 */

import * as THREE from 'three';

/** Soft round sprite so points/sprites render as glowing specks, not squares. */
export function makeSoftSprite(size = 64): THREE.Texture {
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

/**
 * Bright star with four diffraction spikes — the cross flare a real telescope's
 * spider vanes put on every bright star. Used only by the few "hero" stars;
 * the rank-and-file field uses the plain soft sprite.
 */
export function makeStarSprite(size = 128): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  const c = size / 2;
  g.globalCompositeOperation = 'lighter';

  // hot core with a wide soft skirt
  const core = g.createRadialGradient(c, c, 0, c, c, c * 0.55);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  core.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, size, size);

  // spikes: three stacked bars per axis (thin/bright to wide/faint) fake a
  // gaussian cross-section; the lengthwise gradient tapers them to nothing
  const drawSpike = (vertical: boolean): void => {
    const grad = vertical
      ? g.createLinearGradient(0, 0, 0, size)
      : g.createLinearGradient(0, 0, size, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    for (const [half, alpha] of [
      [0.6, 0.9],
      [1.4, 0.35],
      [2.6, 0.12],
    ] as const) {
      g.globalAlpha = alpha;
      if (vertical) g.fillRect(c - half, 0, half * 2, size);
      else g.fillRect(0, c - half, size, half * 2);
    }
    g.globalAlpha = 1;
  };
  drawSpike(false);
  drawSpike(true);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Deterministic RNG so each cloud seed always yields the same texture. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Wispy nebula puff: fractal value noise under a radial falloff, so the
 * silhouette feathers to nothing and the interior has cloud structure instead
 * of a flat radial-gradient blob. White luminance in the alpha channel — the
 * sprite material's color supplies the tint.
 */
export function makeCloudTexture(seed: number, size = 256): THREE.Texture {
  const rand = mulberry32(seed);

  // value-noise lattice (power-of-two so octaves wrap cleanly)
  const LATTICE = 64;
  const lattice = new Float32Array(LATTICE * LATTICE);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const latticeAt = (x: number, y: number): number =>
    lattice[((y & (LATTICE - 1)) * LATTICE + (x & (LATTICE - 1))) | 0];

  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const noise2 = (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = smooth(x - xi);
    const ty = smooth(y - yi);
    const a = latticeAt(xi, yi);
    const b = latticeAt(xi + 1, yi);
    const cc = latticeAt(xi, yi + 1);
    const d = latticeAt(xi + 1, yi + 1);
    return a + (b - a) * tx + (cc - a) * ty + (a - b - cc + d) * tx * ty;
  };
  const fbm = (x: number, y: number): number => {
    let v = 0;
    let amp = 0.5;
    let freq = 1;
    for (let o = 0; o < 5; o++) {
      v += amp * noise2(x * freq, y * freq);
      amp *= 0.5;
      freq *= 2;
    }
    return v; // ~[0, 0.97]
  };

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(size, size);
  const data = img.data;

  const baseFreq = 4; // lattice cells across the sprite at octave 0
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = (px / size) * baseFreq;
      const ny = (py / size) * baseFreq;
      // radial falloff to fully transparent well inside the sprite edge
      const dx = px / size - 0.5;
      const dy = py / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2; // 0 center, 1 at edge midpoint
      const falloff = Math.max(0, 1 - r * r);
      const n = fbm(nx, ny);
      // noise gates the falloff: irregular wisps, not a uniform blob
      const a = Math.pow(Math.max(0, n * 1.35 - 0.28), 1.6) * falloff * falloff;
      const o = (py * size + px) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = Math.min(255, Math.round(a * 340));
    }
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
