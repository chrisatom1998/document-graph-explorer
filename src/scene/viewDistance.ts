/** Same aerial band Edges.tsx uses for GPU filament fade (150 → 600). */
export const NODE_FADE_NEAR = 150;
export const NODE_FADE_FAR = 600;
export const NODE_FADE_MIN = 0.45;

/** Brightness multiplier for a node at Euclidean camera distance `dist`. */
export function viewDistanceFade(dist: number): number {
  if (dist <= NODE_FADE_NEAR) return 1;
  if (dist >= NODE_FADE_FAR) return NODE_FADE_MIN;
  const t = (dist - NODE_FADE_NEAR) / (NODE_FADE_FAR - NODE_FADE_NEAR);
  return 1 - t * (1 - NODE_FADE_MIN);
}
