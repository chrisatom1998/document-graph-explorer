/**
 * Shared edge-curve math: edges render as quadratic beziers that bow gently
 * AWAY from the nebula's core instead of cutting straight through it. Long
 * chords arcing around the dense center is a cheap, stable stand-in for edge
 * bundling — crossings migrate out of the middle where the nodes live, and
 * the graph reads as filaments wrapping a volume rather than a wire ball.
 *
 * The layout worker keeps the graph centered on the origin (see the shell
 * radius / centering pass there), so "away from the core" is simply the
 * component of the chord midpoint perpendicular to the chord. Both Edges
 * (polyline geometry) and EdgePulses (packets travelling the same path) call
 * into here so the two can never disagree about where an edge actually is.
 *
 * Everything is plain scalar math on out-params — this runs per edge per
 * layout tick, so no THREE.Vector3 allocations.
 */

/** Polyline segments per curved edge (points per edge = SEGMENTS + 1). */
export const EDGE_SEGMENTS = 8;
/** Cheaper curves once auto-quality has degraded past tier 2. */
export const EDGE_SEGMENTS_DEGRADED = 4;

/** Bow height as a fraction of chord length ... */
const CURVE_RATIO = 0.18;
/** ... capped so the longest cross-nebula chords don't balloon outward. */
const CURVE_MAX = 12;
/** Below this sagitta the bow direction is numerically meaningless. */
const EPS_SQ = 1e-8;

/**
 * Control point of the quadratic bezier for the edge A→B, written into
 * `out[o..o+2]`. Symmetric in A/B (an edge and its reverse bow identically),
 * which EdgePulses relies on: pulses travel outward from the focus node, so
 * they often walk the edge against its stored source→target order.
 */
export function edgeControlPoint(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  out: Float32Array,
  o: number,
): void {
  const mx = (ax + bx) * 0.5;
  const my = (ay + by) * 0.5;
  const mz = (az + bz) * 0.5;
  const cx = bx - ax;
  const cy = by - ay;
  const cz = bz - az;
  const chordSq = cx * cx + cy * cy + cz * cz;
  if (chordSq < EPS_SQ) {
    // degenerate chord (endpoints coincide mid-layout): no bow
    out[o] = mx;
    out[o + 1] = my;
    out[o + 2] = mz;
    return;
  }

  // Radial component of the midpoint: mid minus its projection on the chord.
  // This is the outward bow direction, and it's symmetric under A<->B (the
  // projection term is quadratic in the chord direction's sign).
  const t = (mx * cx + my * cy + mz * cz) / chordSq;
  let dx = mx - t * cx;
  let dy = my - t * cy;
  let dz = mz - t * cz;
  let dSq = dx * dx + dy * dy + dz * dz;

  if (dSq < EPS_SQ) {
    // Edge passes (nearly) through the origin: any perpendicular will do,
    // but it must not flip when A and B swap — canonicalize the sign below.
    // cross(chord, Y) unless the chord IS the Y axis, then cross(chord, X).
    dx = cz; // cross(c, [0,1,0]) = (cz, 0, -cx)
    dy = 0;
    dz = -cx;
    dSq = dx * dx + dz * dz;
    if (dSq < EPS_SQ) {
      dx = 0; // chord ~ Y axis: cross(c, [1,0,0]) = (0, cz, -cy)
      dy = cz;
      dz = -cy;
      dSq = dy * dy + dz * dz;
    }
    // canonical sign: first significant component non-negative
    const flip =
      dx < -1e-6 || (dx <= 1e-6 && (dy < -1e-6 || (dy <= 1e-6 && dz < 0)));
    if (flip) {
      dx = -dx;
      dy = -dy;
      dz = -dz;
    }
  }

  const chord = Math.sqrt(chordSq);
  const bow = Math.min(CURVE_RATIO * chord, CURVE_MAX) / Math.sqrt(dSq);
  out[o] = mx + dx * bow;
  out[o + 1] = my + dy * bow;
  out[o + 2] = mz + dz * bow;
}

/**
 * Evaluate the quadratic bezier (A, ctrl, B) at t, writing into `out[o..o+2]`.
 */
export function evalEdgePoint(
  ax: number,
  ay: number,
  az: number,
  ctrlX: number,
  ctrlY: number,
  ctrlZ: number,
  bx: number,
  by: number,
  bz: number,
  t: number,
  out: Float32Array,
  o: number,
): void {
  const u = 1 - t;
  const w0 = u * u;
  const w1 = 2 * u * t;
  const w2 = t * t;
  out[o] = w0 * ax + w1 * ctrlX + w2 * bx;
  out[o + 1] = w0 * ay + w1 * ctrlY + w2 * by;
  out[o + 2] = w0 * az + w1 * ctrlZ + w2 * bz;
}
