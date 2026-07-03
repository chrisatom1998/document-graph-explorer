/**
 * Truncate a string to at most maxBytes of UTF-8 without splitting a code
 * point. String#slice(0, n) counts UTF-16 code units, not bytes, so it can
 * overshoot a byte budget by up to 3× on multibyte text — use this wherever
 * a limit is genuinely about bytes.
 */
export function truncateToBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  // A UTF-16 code unit encodes to at most 3 UTF-8 bytes (astral chars are
  // 2 units / 4 bytes), so short-enough strings can skip encoding entirely.
  if (text.length * 3 <= maxBytes) return text;
  // encodeInto fills the buffer up to the last whole code point that fits
  // and reports how many UTF-16 units it consumed.
  const { read } = new TextEncoder().encodeInto(text, new Uint8Array(maxBytes));
  return text.slice(0, read);
}
