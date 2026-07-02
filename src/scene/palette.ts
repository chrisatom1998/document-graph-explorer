/**
 * Deep-space observatory palette (spec §7.1).
 * Cluster hues walk the golden angle from a blue anchor so neighboring
 * community ids land on visually distant hues.
 *
 * NOTE: `clusterColor` returns cached THREE.Color instances — treat them as
 * read-only (`.copy()` before mutating).
 */

import * as THREE from 'three';
import type { EdgeKind } from '../model/types';

const GOLDEN_ANGLE = 137.508;
const HUE_ANCHOR = 210; // start in the blue band; the nebula reads "cold" by default

/** Unclustered / unknown community: desaturated blue-violet neutral. */
const NEUTRAL = new THREE.Color('#8f9bff');

const cache = new Map<number, THREE.Color>();

/** Community id -> stable hue (golden-angle spacing). cluster < 0 -> neutral. */
export function clusterColor(cluster: number): THREE.Color {
  if (cluster < 0) return NEUTRAL;
  let color = cache.get(cluster);
  if (!color) {
    const hue = (HUE_ANCHOR + cluster * GOLDEN_ANGLE) % 360;
    // Author the HSL values in sRGB so they match how the hex tints are read.
    // Saturated + mid-bright so the lit marbles read as vivid jewel tones
    // (magenta / violet / blue / gold / teal) rather than pastels.
    color = new THREE.Color().setHSL(hue / 360, 0.82, 0.56, THREE.SRGBColorSpace);
    cache.set(cluster, color);
  }
  return color;
}

/** CSS hex string for the UI legend (FilterBar imports this). */
export function hexFor(cluster: number): string {
  return `#${clusterColor(cluster).getHexString()}`;
}

/**
 * Edge tints by kind. `reference` edges get the distinct warm amber the spec
 * calls for; the rest stay in the cool band so references pop.
 * Read-only instances — `.copy()` before mutating.
 */
export const EDGE_TINTS: Record<EdgeKind, THREE.Color> = {
  reference: new THREE.Color('#ffb36b'),
  semantic: new THREE.Color('#7fb4ff'),
  keyword: new THREE.Color('#6f86e8'),
  topic: new THREE.Color('#7ee8c4'),
};
