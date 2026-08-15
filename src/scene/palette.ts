/**
 * Deep-space observatory palette (spec §7.1).
 * Cluster hues walk the golden angle from a blue anchor so neighboring
 * community ids land on visually distant hues; lightness is equalized in
 * OKLab so no hue band blazes (raw HSL greens/cyans read twice as bright as
 * blues at equal L, and additive halos amplify the imbalance). Consecutive
 * ids alternate between two lightness targets — a colorblind-safety delta on
 * top of the hue distance — except yellows (35–95°), which always take the
 * bright target because a dark yellow reads as mud, not gold. Validated
 * against the dark surface: lightness band, chroma floor, CVD adjacent-pair
 * separation, contrast (see palette.test.ts for the regression floors).
 *
 * NOTE: `clusterColor` returns cached THREE.Color instances — treat them as
 * read-only (`.copy()` before mutating).
 */

import * as THREE from 'three';
import type { EdgeKind } from '../model/types';

const GOLDEN_ANGLE = 137.508;
const HUE_ANCHOR = 210; // start in the blue band; the nebula reads "cold" by default
const SATURATION = 0.82; // vivid jewel tones, not pastels
const TARGET_L_EVEN = 0.6; // OKLab lightness targets; alternation guarantees
const TARGET_L_ODD = 0.66; //   a ΔL between consecutive community ids
const YELLOW_BAND: readonly [number, number] = [35, 95]; // hue range forced bright

/** Unclustered / unknown community: desaturated blue-violet neutral. */
const NEUTRAL = new THREE.Color('#8f9bff');

const cache = new Map<number, THREE.Color>();

/** OKLab L of a THREE.Color (r/g/b are linear in the working color space). */
export function oklabLightness(c: THREE.Color): number {
  const l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  const m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  const s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  return (
    0.2104542553 * Math.cbrt(l) + 0.793617785 * Math.cbrt(m) - 0.0040720468 * Math.cbrt(s)
  );
}

/** Binary-search the HSL lightness that lands the hue on the OKLab target. */
function equalizedColor(hue: number, targetL: number): THREE.Color {
  const color = new THREE.Color();
  let lo = 0.25;
  let hi = 0.8;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    color.setHSL(hue / 360, SATURATION, mid, THREE.SRGBColorSpace);
    if (oklabLightness(color) < targetL) lo = mid;
    else hi = mid;
  }
  return color.setHSL(hue / 360, SATURATION, (lo + hi) / 2, THREE.SRGBColorSpace);
}

/** Community id -> stable hue (golden-angle spacing). cluster < 0 -> neutral. */
export function clusterColor(cluster: number): THREE.Color {
  if (cluster < 0) return NEUTRAL;
  let color = cache.get(cluster);
  if (!color) {
    const hue = (HUE_ANCHOR + cluster * GOLDEN_ANGLE) % 360;
    let target = cluster % 2 === 0 ? TARGET_L_EVEN : TARGET_L_ODD;
    if (hue >= YELLOW_BAND[0] && hue <= YELLOW_BAND[1]) target = TARGET_L_ODD;
    color = equalizedColor(hue, target);
    cache.set(cluster, color);
  }
  return color;
}

/** CSS hex string for the UI legend (FilterBar imports this). */
export function hexFor(cluster: number): string {
  return `#${clusterColor(cluster).getHexString()}`;
}

/**
 * Edge tints by kind — the single source of truth for edge-kind color.
 * `reference` edges get the distinct warm amber the spec calls for; `entity`
 * edges (shared code identifiers) get a rose so they read apart from the
 * cool keyword/semantic band; the rest stay cool so references pop. UI panels
 * use the hex map; the scene uses the derived THREE.Color instances
 * (read-only — `.copy()` before mutating).
 */
export const EDGE_KIND_HEX: Record<EdgeKind, string> = {
  reference: '#ffb36b',
  semantic: '#7fb4ff',
  keyword: '#6f86e8',
  entity: '#ff9bb3',
  topic: '#7ee8c4',
};

export const EDGE_TINTS: Record<EdgeKind, THREE.Color> = {
  reference: new THREE.Color(EDGE_KIND_HEX.reference),
  semantic: new THREE.Color(EDGE_KIND_HEX.semantic),
  keyword: new THREE.Color(EDGE_KIND_HEX.keyword),
  entity: new THREE.Color(EDGE_KIND_HEX.entity),
  topic: new THREE.Color(EDGE_KIND_HEX.topic),
};

/**
 * 2D constellation theme (dims === 2): the flat star-chart restyle. The
 * nebula's jewel tones collapse to a single pale cyan — a whisper of the
 * cluster hue (FLAT_NODE_CLUSTER_BLEND) keeps the FilterBar legend and
 * cluster filters legible — and all edge kinds share one slate hairline
 * tint (kind stays encoded in the popover/legend and in the pulse colors).
 * The THREE.Color instances are shared read-only (`.copy()` before mutating).
 *
 * FLAT_GRID_FADE is the backdrop's center tone (NebulaCanvas draws a lineless
 * radial gradient from it out to FLAT_BG). There is deliberately no grid/ring
 * token: backdrop LINES read as edges and backdrop CIRCLES read as node rings,
 * so the 2D map gets its depth cue from tone alone, never from marks.
 */
export const FLAT_BG = '#06101a';
export const FLAT_GRID_FADE = '#0b1825';
export const FLAT_PANEL = '#0c1620';
export const FLAT_NODE = new THREE.Color('#f1fbff');
export const FLAT_NODE_CLUSTER_BLEND = 0.62;
export const FLAT_NODE_OUTER = new THREE.Color('#12344d');
export const FLAT_NODE_RING = '#effaff';
export const FLAT_EDGE = new THREE.Color('#5d89a8');
export const FLAT_EDGE_FAINT = '#274358';
export const FLAT_EDGE_FOCUS = '#d8f3ff';
export const FLAT_LABEL = '#edf7ff';
export const FLAT_LABEL_MUTED = '#95afc2';
export const FLAT_SELECTION = '#7fd4ff';

/** Human-readable edge-kind labels for the UI (badges, connection tags). */
export const EDGE_KIND_LABEL: Record<EdgeKind, string> = {
  reference: 'reference',
  semantic: 'similar',
  keyword: 'keyword',
  entity: 'entity',
  topic: 'topic',
};
