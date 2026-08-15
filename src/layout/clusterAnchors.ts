/**
 * Cluster continent anchors for the force layout.
 * 3D: golden-ratio Weyl sequence on a sphere (stable under cluster churn).
 * 2D: the same sequence on a circle so switching dims does not crush the
 * 3D shell into an overlapping disk.
 */

const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function clusterAnchor(
  id: number,
  radius: number,
  dims: 2 | 3,
): [number, number, number] {
  if (dims === 2) {
    const theta = GOLDEN_ANGLE * id;
    return [Math.cos(theta) * radius, Math.sin(theta) * radius, 0];
  }
  const y = 1 - 2 * (((id + 0.5) * GOLDEN_RATIO) % 1);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * id;
  return [Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius];
}
