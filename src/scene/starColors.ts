/**
 * Physical star colors and population statistics for the starfield.
 *
 * Pure math, no THREE/DOM — the vertex-building code in Starfield.tsx packs
 * these into buffer attributes. Both samplers take the RNG as a parameter so
 * tests can drive them deterministically (see starColors.test.ts).
 */

/** sRGB [r,g,b] in 0..1 for a blackbody at tempK (Tanner Helland fit). */
export function blackbodyColor(tempK: number): [number, number, number] {
  const t = Math.min(400, Math.max(10, tempK / 100));

  let r: number;
  let g: number;
  let b: number;

  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }

  const clamp = (v: number): number => Math.min(255, Math.max(0, v)) / 255;
  return [clamp(r), clamp(g), clamp(b)];
}

/**
 * Naked-eye sky temperature mix: not the true stellar population (which is
 * overwhelmingly red dwarfs too faint to see) but what a long exposure shows —
 * mostly yellow-white through white, a warm tail, a short hot blue tail.
 * Weights sum to 1; each band is sampled uniformly.
 */
const TEMP_BANDS: ReadonlyArray<readonly [number, number, number]> = [
  // [weight, tMin, tMax]
  [0.13, 2600, 3800], // red giants / carbon stars
  [0.22, 3800, 5000], // orange (K)
  [0.3, 5000, 6500], // yellow-white (G, solar)
  [0.2, 6500, 8500], // white (F/A)
  [0.11, 8500, 15000], // blue-white (B)
  [0.04, 15000, 28000], // blue (O/B giants)
];

/** Sample a star temperature (K) from the visible-sky mix. */
export function sampleStarTemperature(rand: () => number): number {
  let pick = rand();
  for (const [weight, tMin, tMax] of TEMP_BANDS) {
    if (pick < weight) return tMin + (tMax - tMin) * rand();
    pick -= weight;
  }
  const last = TEMP_BANDS[TEMP_BANDS.length - 1];
  return last[1] + (last[2] - last[1]) * rand();
}

const BRIGHTNESS_FLOOR = 0.1;

/**
 * Apparent brightness in (0,1]: a steep power law so the field is thousands
 * of faint stars with a handful of bright ones (photographic magnitude
 * distribution), never a wall of equal dots.
 */
export function sampleStarBrightness(rand: () => number): number {
  const r = rand();
  return BRIGHTNESS_FLOOR + (1 - BRIGHTNESS_FLOOR) * r * r * r;
}
