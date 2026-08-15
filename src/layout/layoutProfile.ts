export const CLUSTER_PULL_3D = 0.05;
export const CLUSTER_PULL_2D = 0.12;
export const SHELL_STRENGTH_3D = 0.9;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const FLAT_ANCHOR_RADIUS_SCALE = 0.72;

export function clusterPullForDims(dims: 2 | 3): number {
  return dims === 2 ? CLUSTER_PULL_2D : CLUSTER_PULL_3D;
}

export function shellStrengthForDims(dims: 2 | 3): number {
  // A strong radial force makes sense for the 3D planet-like shell, but in
  // 2D it produces a hollow wheel. Planar cluster anchors + link/charge forces
  // supply the map's structure instead.
  return dims === 2 ? 0 : SHELL_STRENGTH_3D;
}

/** Stable community anchor for the active layout profile. */
export function clusterAnchor(
  index: number,
  count: number,
  radius: number,
  dims: 2 | 3,
): [number, number, number] {
  const safeCount = Math.max(count, 2);
  if (dims === 2) {
    // Phyllotaxis fills a disc without a special central cluster or a hollow
    // perimeter. sqrt(t) keeps roughly equal area between neighboring anchors.
    const t = (index + 0.5) / safeCount;
    const r = Math.sqrt(t) * radius * FLAT_ANCHOR_RADIUS_SCALE;
    const theta = GOLDEN_ANGLE * index;
    return [Math.cos(theta) * r, Math.sin(theta) * r, 0];
  }

  // Preserve the existing Fibonacci-sphere profile exactly in 3D.
  const y = 1 - (2 * (index + 0.5)) / safeCount;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * index;
  return [
    Math.cos(theta) * r * radius,
    y * radius,
    Math.sin(theta) * r * radius,
  ];
}
