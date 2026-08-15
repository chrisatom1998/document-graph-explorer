/**
 * Cluster continent anchors for the force layout.
 * 3D: golden-ratio Weyl sequence on a sphere (stable under cluster churn).
 * 2D: a sunflower distribution over a disk, giving clusters distinct map
 * regions instead of preserving the 3D shell's front-facing projection.
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
    // The fractional part keeps an arbitrary Louvain cluster id stable while
    // spreading anchors through the disk instead of onto its outer rim.
    const t = ((id + 0.5) * GOLDEN_RATIO) % 1;
    const r = Math.sqrt(t) * radius * 0.72;
    return [Math.cos(theta) * r, Math.sin(theta) * r, 0];
  }
  const y = 1 - 2 * (((id + 0.5) * GOLDEN_RATIO) % 1);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * id;
  return [Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius];
}
