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
