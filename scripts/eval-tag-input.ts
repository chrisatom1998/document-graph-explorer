import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';

/** Identify audio bytes and their interpretation independently of current target labels. */
export function inputCacheIdentity(paths: string[], interpretation: unknown): string {
  const hash = createHash('sha256').update('eval-tag-cache-v2').update(JSON.stringify(interpretation));
  for (const path of paths) {
    hash.update(resolve(path));
    const fd = openSync(path, 'r'), bytes = Buffer.alloc(1024 * 1024);
    try { let n: number; while ((n = readSync(fd, bytes, 0, bytes.length, null)) > 0) hash.update(bytes.subarray(0, n)); }
    finally { closeSync(fd); }
  }
  return hash.digest('hex');
}
