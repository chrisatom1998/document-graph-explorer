/** Fast scans use at most three non-overlapping sections, never padded repeats. */
export function fastInstrumentStarts(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  if (duration <= 10) return [0];
  if (duration < 20) return [(duration - 10) / 2];
  if (duration < 30) return [0, duration - 10];
  return [0, duration / 2 - 5, duration - 10];
}

export function descriptionStarts(duration: number, mode: 'fast' | 'full'): number[] {
  return mode === 'fast' ? [Math.max(0, duration / 2 - 5)]
    : [...new Set([0, Math.max(0, duration / 2 - 5), Math.max(0, duration - 10)])];
}
