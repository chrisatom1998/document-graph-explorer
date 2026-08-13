/**
 * SHA-256 hex digest via WebCrypto. Works on the main thread and inside
 * workers (crypto.subtle exists in both in secure contexts).
 */

export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes: BufferSource =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i += 1) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * 32-bit FNV-1a non-cryptographic fast hash.
 * Synchronous and worker-safe, ideal for quick string keying or fast partitioning.
 */
export function fnv1a32(data: string | Uint8Array): number {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let hash = 0x811c9dc5; // 2166136261 (FNV offset basis)
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193); // 16777619 (FNV prime)
  }
  return hash >>> 0; // Convert to unsigned 32-bit integer
}

/**
 * 32-bit FNV-1a hash formatted as an 8-character hex string.
 */
export function fnv1a32Hex(data: string | Uint8Array): string {
  return fnv1a32(data).toString(16).padStart(8, '0');
}
