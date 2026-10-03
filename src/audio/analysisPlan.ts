/** Fast scans use at most three non-overlapping sections, never padded repeats. */
export function fastInstrumentStarts(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  if (duration <= 10) return [0];
  if (duration < 20) return [(duration - 10) / 2];
  if (duration < 30) return [0, duration - 10];
  return [0, duration / 2 - 5, duration - 10];
}

export function descriptionStarts(duration: number, mode: 'fast' | 'full'): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  return mode === 'fast' ? [Math.max(0, duration / 2 - 5)]
    : Array.from({length: Math.ceil(Math.min(duration, 86400) / 10)}, (_, i) => i * 10);
}

/** Bounded song overview: up to twelve ten-second excerpts across the recording. */
export function songReviewStarts(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const count = Math.min(12, Math.max(1, Math.floor(duration / 10)));
  return Array.from({length: count}, (_, i) => count === 1 ? 0 : i * (duration - 10) / (count - 1));
}
