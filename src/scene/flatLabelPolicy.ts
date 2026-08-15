import type { QualityTier } from '../store/uiStore';

/** Number of ordinary document labels shown at the current map zoom. */
export function flatLabelBudget(
  cameraDistance: number,
  nodeCount: number,
  qualityTier: QualityTier,
  maximum: number,
): number {
  if (nodeCount <= 0 || maximum <= 0) return 0;
  const qualityCap = qualityTier >= 3 ? 12 : maximum;
  const zoomCap =
    cameraDistance >= 420 ? 12
      : cameraDistance >= 280 ? 18
        : cameraDistance >= 170 ? 28
          : maximum;
  return Math.min(nodeCount, qualityCap, zoomCap, maximum);
}

/**
 * Lower scores win the existing nearest-label insertion pool. Degree reduces
 * the score, so overview labels favor useful hubs instead of arbitrary dots
 * that happen to be a few units closer to the camera.
 */
export function flatLabelPriority(distanceSquared: number, degree: number): number {
  const importance = 1 + Math.log2(1 + Math.max(0, degree)) * 1.7;
  return distanceSquared / (importance * importance);
}

/** Keep the smaller overview label set readable without making close labels huge. */
export function flatLabelScale(cameraDistance: number): number {
  return Math.min(1.7, Math.max(1.05, cameraDistance / 285));
}

export function flatLabelOpacity(cameraDistance: number): number {
  if (cameraDistance <= 180) return 0.92;
  if (cameraDistance >= 520) return 0.62;
  return 0.92 - ((cameraDistance - 180) / 340) * 0.3;
}
