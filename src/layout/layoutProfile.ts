export const CLUSTER_PULL_3D = 0.05;
export const CLUSTER_PULL_2D = 0.12;
export const SHELL_STRENGTH_3D = 0.9;

const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const FLAT_ANCHOR_RADIUS_SCALE = 0.72;

export interface FlatDepthSnapshot {
  z: number;
  fz: number | null;
}

export function clusterPullForDims(dims: 2 | 3): number {
  return dims === 2 ? CLUSTER_PULL_2D : CLUSTER_PULL_3D;
}

export function shellStrengthForDims(dims: 2 | 3): number {
  // A strong radial force makes sense for the 3D planet-like shell, but in
  // 2D it produces a hollow wheel. Planar cluster anchors + link/charge forces
  // supply the map's structure instead.
  return dims === 2 ? 0 : SHELL_STRENGTH_3D;
}

/** Restore depth while honoring pin/unpin changes made on the flat map. */
export function restoredFlatPinDepth(
  snapshot: FlatDepthSnapshot,
  currentFz: number | null,
): number | null {
  if (currentFz == null) return null;
  return snapshot.fz ?? snapshot.z;
}

/** Identity-stable community anchor: keyed on cluster ID, not list index. */
export function clusterAnchor(
  id: number,
  radius: number,
  dims: 2 | 3,
): [number, number, number] {
  if (dims === 2) {
    // Weyl phyllotaxis fills a disc without a special central cluster or a
    // hollow perimeter. The fractional part is a function of the raw ID so
    // adding or removing a community never moves the others.
    const t = ((id + 0.5) * GOLDEN_RATIO) % 1;
    const r = Math.sqrt(t) * radius * FLAT_ANCHOR_RADIUS_SCALE;
    const theta = GOLDEN_ANGLE * id;
    return [Math.cos(theta) * r, Math.sin(theta) * r, 0];
  }

  const y = 1 - 2 * (((id + 0.5) * GOLDEN_RATIO) % 1);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * id;
  return [
    Math.cos(theta) * r * radius,
    y * radius,
    Math.sin(theta) * r * radius,
  ];
}
