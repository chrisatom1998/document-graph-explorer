/** Coarse human-readable age for document mtimes ("3 months ago"). */

const UNITS: { ms: number; label: string }[] = [
  { ms: 365 * 24 * 3_600_000, label: 'year' },
  { ms: 30 * 24 * 3_600_000, label: 'month' },
  { ms: 7 * 24 * 3_600_000, label: 'week' },
  { ms: 24 * 3_600_000, label: 'day' },
  { ms: 3_600_000, label: 'hour' },
];

export function timeAgo(ts: number, now = Date.now()): string {
  const delta = now - ts;
  if (delta < 3_600_000) return 'just now';
  for (const { ms, label } of UNITS) {
    if (delta >= ms) {
      const n = Math.floor(delta / ms);
      return `${n} ${label}${n === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}
