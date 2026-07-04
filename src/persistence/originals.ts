/**
 * Original-file retention: the exact bytes of every ingested file, keyed by
 * content hash (= DocNode.id), so "Open" can hand the user the byte-identical
 * original and the OS default app takes it from there. Local-only like the
 * rest of the cache — originals never leave the browser.
 *
 * Failures degrade like cache.ts: the feature quietly falls back to the text
 * viewer rather than breaking ingest (originals are written fire-and-forget).
 */

import { getDb } from './db';
import type { OriginalFileRecord } from './db';

/** Above this we skip retention (IndexedDB quota safety); Open falls back. */
export const MAX_ORIGINAL_BYTES = 50 * 1024 * 1024;

/**
 * Store the original bytes for a doc unless already present (re-drops of a
 * known file backfill docs cached before this feature existed).
 */
export async function putOriginalIfMissing(
  hash: string,
  name: string,
  blob: Blob,
): Promise<void> {
  if (blob.size === 0 || blob.size > MAX_ORIGINAL_BYTES) return;
  try {
    const db = await getDb();
    const existing = await db.getKey('originals', hash);
    if (existing !== undefined) return;
    const rec: OriginalFileRecord = { hash, name, blob };
    await db.put('originals', rec);
  } catch {
    // quota / private mode: cache.ts already warned once about persistence
  }
}

export async function getOriginal(hash: string): Promise<OriginalFileRecord | undefined> {
  try {
    const db = await getDb();
    return await db.get('originals', hash);
  } catch {
    return undefined;
  }
}

/** Removal path: forget originals together with the doc cache records. */
export async function deleteOriginals(hashes: string[]): Promise<void> {
  if (hashes.length === 0) return;
  try {
    const db = await getDb();
    const tx = db.transaction('originals', 'readwrite');
    await Promise.all([...hashes.map((h) => tx.store.delete(h)), tx.done]);
  } catch {
    // cache unavailable — nothing to delete
  }
}
