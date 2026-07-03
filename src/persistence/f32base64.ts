/**
 * Float32Array <-> base64 for GraphExport embeddings. Kept in its own module
 * (free of the export/import module graph) so the round-trip is unit-testable
 * in isolation — these are data-integrity-critical and easy to get subtly wrong.
 */

/** Chunk size keeps String.fromCharCode argument counts under stack limits. */
const B64_CHUNK = 0x8000;

export function f32ToBase64(a: Float32Array): string {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + B64_CHUNK)));
  }
  return btoa(binary);
}

export function base64ToF32(s: string): Float32Array {
  const binary = atob(s);
  // Float32Array requires a byte length that is a multiple of 4; drop any
  // trailing partial float rather than throwing on a corrupt/truncated string.
  const usable = binary.length - (binary.length % 4);
  const bytes = new Uint8Array(usable);
  for (let i = 0; i < usable; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
