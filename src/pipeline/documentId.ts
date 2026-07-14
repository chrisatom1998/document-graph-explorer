import { sha256Hex } from './hash';

/** Document identity is stable for the same relative path and exact bytes. */
export async function documentContentId(path: string, bytes: ArrayBuffer): Promise<string> {
  const pathBytes = new TextEncoder().encode(`${path}\0`);
  const combined = new Uint8Array(pathBytes.byteLength + bytes.byteLength);
  combined.set(pathBytes, 0);
  combined.set(new Uint8Array(bytes), pathBytes.byteLength);
  return sha256Hex(combined.buffer);
}
