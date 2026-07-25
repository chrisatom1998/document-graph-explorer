export interface AiCoreVisualState {
  coreScale: number;
  glowOpacity: number;
  glowScale: number;
  ringOpacity: number;
  shellIntensity: number;
  shellScale: number;
  angularSpeed: number;
}

/**
 * Matches the layout worker's orbit shell:
 *   r = max(SHELL_MIN_RADIUS, NODE_COLLIDE_RADIUS * 2.2 * sqrt(n))
 * so the center orb grows with corpus size and stays in proportion to the
 * nebula. Small corpora stay at the baseline size of 1.
 */
const SHELL_MIN_RADIUS = 72;
const SHELL_RADIUS_PER_SQRT_NODE = 5 * 2.2;

/**
 * Corpus-driven scale for the AI core. At ~2,000 documents this is ~6.8× so
 * the singularity remains a readable anchor against the expanded shell.
 */
export function computeAiCoreCorpusScale(documentCount: number): number {
  const n = Math.max(0, documentCount);
  const shellRadius = Math.max(
    SHELL_MIN_RADIUS,
    SHELL_RADIUS_PER_SQRT_NODE * Math.sqrt(n),
  );
  return shellRadius / SHELL_MIN_RADIUS;
}

/**
 * Pure visual-state calculation for the AI core. Keeping this independent of
 * three.js makes the motion contract testable and ensures reduced-motion mode
 * cannot accidentally inherit a phase-driven pulse.
 */
export function computeAiCoreVisuals(
  energy: number,
  phase: number,
  reducedMotion: boolean,
): AiCoreVisualState {
  const e = Math.min(1, Math.max(0, energy));
  const oscillation = reducedMotion ? 0 : Math.sin(phase);
  const pulse = 1 + (0.07 + e * 0.16) * oscillation;

  return {
    coreScale: pulse * (1 + e * 0.06),
    glowOpacity: Math.min(0.3, (0.12 + e * 0.1) * pulse),
    glowScale: 14 * pulse * (1 + e * 0.22),
    ringOpacity: 0.46 + e * 0.14,
    shellIntensity: (0.28 + e * 0.3) * pulse,
    shellScale: pulse * (1 + e * 0.08),
    angularSpeed: reducedMotion ? 0 : 0.12 + e * 0.34,
  };
}
