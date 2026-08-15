import type { EdgeKind } from '../model/types';

export const DOCUMENT_EDGE_KINDS: EdgeKind[] = [
  'reference',
  'semantic',
  'keyword',
  'entity',
];

export const MAX_COMPARE_DOCS = 4;
export const EDGE_SPARSITY_MAX = 0.7;

export type ReadabilityPresetId = 'quiet' | 'balanced' | 'focus';

export interface ReadabilityPreset {
  id: ReadabilityPresetId;
  label: string;
  minEdgeWeight: number;
  labelDensity: number;
  clusterAtmosphere: number;
}

export const READABILITY_PRESETS: Record<ReadabilityPresetId, ReadabilityPreset> = {
  quiet: {
    id: 'quiet',
    label: 'Quiet',
    minEdgeWeight: 0.4,
    labelDensity: 0.3,
    clusterAtmosphere: 0.2,
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    minEdgeWeight: 0,
    labelDensity: 1,
    clusterAtmosphere: 1,
  },
  focus: {
    id: 'focus',
    label: 'Focus',
    minEdgeWeight: 0.25,
    labelDensity: 0.55,
    clusterAtmosphere: 0.45,
  },
};

/** Visible document edge kinds. `null` means every kind is on. */
export function visibleEdgeKinds(edgeKinds: EdgeKind[] | null): EdgeKind[] {
  return edgeKinds ?? DOCUMENT_EDGE_KINDS;
}

/**
 * Legend-style visibility toggle: start from “all on”, hide/show one kind.
 * Selecting every kind stores `null` so filters stay identity-stable.
 */
export function toggleEdgeKindVisibility(
  current: EdgeKind[] | null,
  kind: EdgeKind,
): EdgeKind[] | null {
  if (kind === 'topic') return current;
  const visible = visibleEdgeKinds(current);
  const next = visible.includes(kind)
    ? visible.filter((item) => item !== kind)
    : [...visible, kind];
  if (next.length === 0) return [];
  if (next.length === DOCUMENT_EDGE_KINDS.length) return null;
  return DOCUMENT_EDGE_KINDS.filter((item) => next.includes(item));
}

export function edgeDensityFromWeight(minEdgeWeight: number): number {
  return Math.max(0, Math.min(1, 1 - minEdgeWeight / EDGE_SPARSITY_MAX));
}

export function weightFromEdgeDensity(density: number): number {
  const clamped = Math.max(0, Math.min(1, density));
  return Number(((1 - clamped) * EDGE_SPARSITY_MAX).toFixed(2));
}

export function estimateRemainingMs(
  done: number,
  total: number,
  elapsedMs: number,
): number | null {
  if (done <= 0 || total <= done || elapsedMs < 400) return null;
  const rate = done / elapsedMs;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return (total - done) / rate;
}

export function formatEta(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `~${seconds}s left`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? '~1m left' : `~${minutes}m left`;
}

export function matchingPreset(
  minEdgeWeight: number,
  labelDensity: number,
  clusterAtmosphere: number,
): ReadabilityPresetId | null {
  for (const preset of Object.values(READABILITY_PRESETS)) {
    if (
      Math.abs(preset.minEdgeWeight - minEdgeWeight) < 0.02 &&
      Math.abs(preset.labelDensity - labelDensity) < 0.02 &&
      Math.abs(preset.clusterAtmosphere - clusterAtmosphere) < 0.02
    ) {
      return preset.id;
    }
  }
  return null;
}
