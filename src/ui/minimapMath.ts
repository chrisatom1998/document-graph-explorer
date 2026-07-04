/**
 * Pure geometry for the Minimap's camera indicator — kept out of the
 * component so the world→map projection, viewport-box fit, and arrow
 * placement are unit-testable without a canvas.
 *
 * Map convention: u is world x; v is world z in 3D (top-down compass) and
 * world -y in 2D (layout plane, +y up on screen = up on map).
 */

export interface CameraPoseLike {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
  fov: number; // vertical, degrees
  aspect: number;
}

export type MapDims = 2 | 3;

/** Smallest half-extent (px) the viewport box may shrink to and stay legible. */
const MIN_HALF = 4;

/** Project world position to the map plane: top-down in 3D, layout plane in 2D. */
export function projU(x: number, _y: number, _z: number): number {
  return x;
}
export function projV(y: number, z: number, dims: MapDims): number {
  return dims === 3 ? z : -y;
}

/**
 * Camera view direction (camera→target) projected onto the map plane and
 * normalized. A view straight down the map normal has no projected heading —
 * fall back to map-up, which in 2D matches the screen orientation exactly.
 */
export function headingOnMap(
  pose: CameraPoseLike,
  dims: MapDims,
): { hu: number; hv: number } {
  const hu = pose.tx - pose.px;
  const hv = dims === 3 ? pose.tz - pose.pz : -(pose.ty - pose.py);
  const len = Math.hypot(hu, hv);
  if (len > 1e-3) return { hu: hu / len, hv: hv / len };
  return { hu: 0, hv: -1 };
}

/**
 * Half-extents (map px) of the viewport box: halfV runs along the heading,
 * halfU along screen-right. Sized from the frustum at the orbit-target
 * distance, then clamped with a SINGLE factor so the box always keeps the
 * camera's aspect ratio — floored to stay visible when zoomed all the way
 * in, capped near the map size when zoomed all the way out.
 */
export function viewportHalfExtents(
  pose: CameraPoseLike,
  scale: number,
  mapW: number,
  mapH: number,
): { halfU: number; halfV: number } {
  const dist = Math.hypot(
    pose.px - pose.tx,
    pose.py - pose.ty,
    pose.pz - pose.tz,
  );
  let halfV = Math.max(
    dist * Math.tan((pose.fov * Math.PI) / 360) * scale,
    1e-6,
  );
  let halfU = halfV * pose.aspect;
  const shrink = Math.min(1, mapW / halfU, mapH / halfV);
  halfU *= shrink;
  halfV *= shrink;
  const grow = Math.max(1, MIN_HALF / Math.min(halfU, halfV));
  return { halfU: halfU * grow, halfV: halfV * grow };
}

/**
 * Corners of the heading-aligned viewport box, in draw order:
 * center ± screen-right·halfU ± heading·halfV, right = (-hv, hu).
 */
export function boxCorners(
  cx: number,
  cy: number,
  hu: number,
  hv: number,
  halfU: number,
  halfV: number,
): Array<[number, number]> {
  const rx = -hv;
  const ry = hu;
  return [
    [cx - rx * halfU + hu * halfV, cy - ry * halfU + hv * halfV],
    [cx + rx * halfU + hu * halfV, cy + ry * halfU + hv * halfV],
    [cx + rx * halfU - hu * halfV, cy + ry * halfU - hv * halfV],
    [cx - rx * halfU - hu * halfV, cy - ry * halfU - hv * halfV],
  ];
}

/** Clamp a point into a rect, reporting whether it was outside. */
export function clampToRect(
  x: number,
  y: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): { x: number; y: number; clamped: boolean } {
  const cx = Math.min(Math.max(x, minX), maxX);
  const cy = Math.min(Math.max(y, minY), maxY);
  return { x: cx, y: cy, clamped: cx !== x || cy !== y };
}

/**
 * Triangle for the "you are here" arrow: anchored at (x, y), tip one size
 * ahead along the (normalized) heading, base corners half a size behind.
 */
export function arrowVertices(
  x: number,
  y: number,
  hu: number,
  hv: number,
  size: number,
): Array<[number, number]> {
  const rx = -hv;
  const ry = hu;
  const back = 0.5 * size;
  const halfW = 0.6 * size;
  return [
    [x + hu * size, y + hv * size],
    [x - hu * back + rx * halfW, y - hv * back + ry * halfW],
    [x - hu * back - rx * halfW, y - hv * back - ry * halfW],
  ];
}
