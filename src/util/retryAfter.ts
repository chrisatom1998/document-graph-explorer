/**
 * Parse a Retry-After response header value into a millisecond delay. Accepts
 * both a delay in seconds ("30") and an HTTP-date
 * ("Wed, 21 Oct 2015 07:28:00 GMT"). Returns null when the header is absent
 * or malformed so callers can fall back to their own backoff strategy.
 *
 * The return value is capped at 60 000 ms (60 s) so a misbehaving server
 * cannot stall retries indefinitely.
 */
export function parseRetryAfter(value: string): number | null {
  const seconds = Number(value);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.min(seconds, 60) * 1000;
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    const delta = date.getTime() - Date.now();
    return Math.min(Math.max(delta, 0), 60_000);
  }
  return null;
}
