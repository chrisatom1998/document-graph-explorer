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
